# =====================================================================
# Mídia (fotos de check-in, galeria e portfólio): bucket próprio, servido pelo
# CloudFront em /media/*. Separado do bucket do site porque o deploy do site
# faz `s3 sync --delete`, que apagaria a mídia. O painel envia direto ao S3
# com URL pré-assinada (função media-upload).
# =====================================================================
resource "aws_s3_bucket" "media" {
  bucket = "sp-car-clean-media-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Versões substituídas ou apagadas ficam 30 dias (para desfazer engano).
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expira-versoes-antigas"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# O navegador do admin envia o arquivo direto ao S3 (PUT pré-assinado).
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = [for a in local.aliases : "https://${a}"]
    allowed_headers = ["content-type"]
    max_age_seconds = 3000
  }
}

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

# A URL pré-assinada usa as credenciais da Lambda: ela precisa poder gravar.
data "aws_iam_policy_document" "lambda_media" {
  statement {
    sid       = "MediaUpload"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
}

resource "aws_iam_role_policy" "lambda_media" {
  name   = "media-upload"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_media.json
}
