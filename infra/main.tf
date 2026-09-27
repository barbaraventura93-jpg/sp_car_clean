data "aws_caller_identity" "current" {}

# A Hosted Zone já foi criada manualmente no console (Bloco 3).
data "aws_route53_zone" "primary" {
  name         = "${var.domain_name}."
  private_zone = false
}

locals {
  aliases     = var.site_aliases
  bucket_name = "sp-car-clean-site-${data.aws_caller_identity.current.account_id}"
}

# =====================================================================
# S3 — bucket privado que guarda os arquivos do site (servido via CloudFront)
# =====================================================================
resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Só o CloudFront (via OAC) pode ler os objetos do bucket.
data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "AllowCloudFrontOAC"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

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

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json
}

# =====================================================================
# CloudFront — CDN + HTTPS na frente do bucket
# =====================================================================
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "sp-car-clean-oac"
  description                       = "OAC para o bucket do site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Políticas de cache gerenciadas pela AWS.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "SP Car Clean - site"
  default_root_object = "index.html"
  aliases             = local.aliases
  price_class         = var.cloudfront_price_class

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Estáticos (assets, css, js): cache otimizado.
  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  # index.html sempre revalida (equivalente à regra do netlify.toml):
  # após um deploy ninguém fica preso a uma versão antiga do app.
  ordered_cache_behavior {
    path_pattern           = "/index.html"
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id
  }

  # PWA/SPA: rota desconhecida cai no index.html.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# =====================================================================
# Route 53 — registros do domínio apontando para o CloudFront
# (ficam DORMENTES até o cutover: os nameservers ainda são do Netlify)
# =====================================================================
resource "aws_route53_record" "ipv4" {
  for_each = toset(local.aliases)

  zone_id = data.aws_route53_zone.primary.zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = "Z2FDTNDATAQYW2" # hosted zone fixa do CloudFront
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "ipv6" {
  for_each = toset(local.aliases)

  zone_id = data.aws_route53_zone.primary.zone_id
  name    = each.value
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

# Registro de validação do certificado ACM. Mantido no Route 53 para que
# a RENOVAÇÃO AUTOMÁTICA do certificado continue funcionando depois do cutover
# (quando o Route 53 passa a ser o DNS oficial do domínio). É determinístico
# por domínio, então é o mesmo par name/value usado na emissão manual.
resource "aws_route53_record" "acm_validation" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "_60a28eb510a2ba6389a0227d4c061c35.spcarclean.com.br"
  type    = "CNAME"
  ttl     = 300
  records = ["_0f76893929e8f48bc948d57dd14fe89c.wzccmgtwzk.acm-validations.aws."]
}

# =====================================================================
# GitHub OIDC — deixa o GitHub Actions publicar sem chave estática
# (cria o Identity Provider E a Role; não precisa fazer nada manual)
# =====================================================================
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Só esta branch deste repo pode assumir a role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "sp-car-clean-github-deploy"
  description        = "Role assumida pelo GitHub Actions para publicar o site"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "deploy_permissions" {
  statement {
    sid       = "S3List"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid       = "S3Objects"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "CloudFrontInvalidation"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:ListInvalidations"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-permissions"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.deploy_permissions.json
}
