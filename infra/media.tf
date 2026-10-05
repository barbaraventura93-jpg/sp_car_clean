# =====================================================================
# Mídia (substitui o Firebase Storage): fotos da galeria/carrossel, vídeos e
# fotos do check-in. Bucket privado, servido pelo mesmo CloudFront do site em
# https://<site>/media/... (as chaves no bucket começam com "media/").
#
# É um bucket separado do site de propósito: o deploy faz "aws s3 sync --delete"
# no bucket do site, o que apagaria as fotos.
#
# Upload: o painel admin pede uma URL pré-assinada à função upload-url e envia
# o arquivo direto ao bucket (PUT). Migração do que estava no Firebase:
# scripts/migrate-media.js.
# =====================================================================
locals {
  media_bucket_name = "sp-car-clean-media-${data.aws_caller_identity.current.account_id}"
  media_base_url    = "${local.site_url}/media"
  site_origins      = [for a in var.site_aliases : "https://${a}"]
}

resource "aws_s3_bucket" "media" {
  bucket = local.media_bucket_name
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versionado: uma foto apagada ou sobrescrita por engano pode ser recuperada.
resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "versoes-antigas"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# O navegador do admin envia o arquivo direto ao bucket (URL pré-assinada).
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = concat(local.site_origins, ["http://localhost:3000"])
    allowed_headers = ["Content-Type", "Cache-Control"]
    max_age_seconds = 3600
  }
}

# Leitura só pelo CloudFront (OAC). Sem ListBucket: ninguém lista as fotos.
data "aws_iam_policy_document" "media_bucket" {
  statement {
    sid       = "AllowCloudFrontOAC"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket.json
}

# A função upload-url assina os PUTs com a role das funções.
data "aws_iam_policy_document" "lambda_media" {
  statement {
    sid       = "UploadMedia"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
}

resource "aws_iam_role_policy" "lambda_media" {
  name   = "media-upload"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_media.json
}
