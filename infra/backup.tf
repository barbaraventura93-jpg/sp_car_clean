# =====================================================================
# Backup diário do Firebase Realtime Database nesta conta AWS.
#
# O banco do site vive num projeto Firebase (Google), fora desta conta. Em
# 08/11/2026 a chave de API desse projeto foi apagada e o acesso ao console
# foi perdido: o banco continuou servindo, mas sem console não há como
# exportar pelo painel. O `FIREBASE_DATABASE_SECRET` (no SSM) ainda dá leitura
# total, e é isso que a função functions/firebase-backup.js usa.
#
# Enquanto o banco estiver fora daqui, este bucket é a única cópia sob o seu
# controle. Ele é privado: nenhum CloudFront aponta para ele, ao contrário do
# bucket de mídia, cuja policy libera leitura para a distribuição.
# =====================================================================

locals {
  backups_bucket_name = "sp-car-clean-backups-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "backups" {
  bucket = local.backups_bucket_name
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Só HTTPS. Sem isso, um GET em HTTP sairia em texto claro com dados de cliente.
data "aws_iam_policy_document" "backups_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "backups" {
  bucket     = aws_s3_bucket.backups.id
  policy     = data.aws_iam_policy_document.backups_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.backups]
}

# Um backup por dia de ~70 KB comprimidos: 180 dias custam fração de centavo.
# A transição para IA/Glacier não compensa em objeto pequeno (mínimo de 128 KB
# cobrado por objeto nas classes frias), então só expira.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expira-backups-antigos"
    status = "Enabled"

    filter {
      prefix = "firebase/"
    }

    expiration {
      days = 180
    }
  }

  rule {
    id     = "limpa-multipart-abandonado"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "lambda_backup" {
  statement {
    sid       = "GravaBackupDoFirebase"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/firebase/*"]
  }
}

resource "aws_iam_role_policy" "lambda_backup" {
  name   = "firebase-backup-write"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_backup.json
}
