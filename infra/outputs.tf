output "s3_bucket" {
  description = "Nome do bucket S3 do site."
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  description = "ID da distribuição CloudFront."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain" {
  description = "URL temporária do CloudFront (para testar antes do cutover de DNS)."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "api_base_url" {
  description = "Base pública da API (via CloudFront, mesmo domínio do site)."
  value       = "${local.site_url}/api"
}

output "whatsapp_webhook_url" {
  description = "URL para cadastrar no painel da Meta (WhatsApp Cloud API → Webhook)."
  value       = "${local.site_url}/api/whatsapp-webhook"
}

output "github_role_arn" {
  description = "ARN da role que o GitHub Actions assume."
  value       = aws_iam_role.github_deploy.arn
}

# Cole estes 4 valores nos Secrets do GitHub (Settings > Secrets and variables > Actions).
output "github_secrets_para_configurar" {
  description = "Valores prontos para os Secrets do GitHub."
  value       = <<-EOT

    ┌─────────────────────────────────────────────────────────────
    │ Configure no GitHub: Settings > Secrets and variables > Actions
    ├─────────────────────────────────────────────────────────────
    │ AWS_ROLE_ARN        = ${aws_iam_role.github_deploy.arn}
    │ AWS_REGION          = ${var.aws_region}
    │ S3_BUCKET           = ${aws_s3_bucket.site.bucket}
    │ CF_DISTRIBUTION_ID  = ${aws_cloudfront_distribution.site.id}
    └─────────────────────────────────────────────────────────────
    Faltam ainda (chaves públicas de cliente, usadas no build.js):
      FIREBASE_API_KEY, FIREBASE_VAPID_KEY, EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY
  EOT
}
