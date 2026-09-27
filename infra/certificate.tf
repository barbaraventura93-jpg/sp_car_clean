# =====================================================================
# Certificado HTTPS do site — criado e validado pelo Terraform.
# Um curinga (*.dominio) NÃO cobre o domínio raiz, por isso os dois nomes.
# =====================================================================
resource "aws_acm_certificate" "site" {
  provider                  = aws.us_east_1
  domain_name               = local.cert_names[0]
  subject_alternative_names = [local.cert_names[1]]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# O raiz e o curinga usam o mesmo registro de validação: allow_overwrite evita
# conflito entre as duas entradas.
locals {
  cert_names = [var.domain_name, "*.${var.domain_name}"]
  cert_dvo   = { for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => dvo }
}

resource "aws_route53_record" "cert_validation" {
  for_each = toset(local.cert_names)

  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = local.cert_dvo[each.key].resource_record_name
  type            = local.cert_dvo[each.key].resource_record_type
  records         = [local.cert_dvo[each.key].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# Espera o certificado ficar ISSUED antes de o CloudFront usá-lo.
resource "aws_acm_certificate_validation" "site" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
