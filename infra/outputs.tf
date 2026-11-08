output "s3_bucket" {
  description = "Nome do bucket S3 do site."
  value       = aws_s3_bucket.site.bucket
}

output "media_bucket" {
  description = "Bucket S3 das fotos/vídeos (servido em /media/*). Usado pelo scripts/migrate-media.js."
  value       = aws_s3_bucket.media.bucket
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
      FIREBASE_API_KEY, EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY
  EOT
}

output "waf_web_acl_arn" {
  description = "ARN do web ACL do site. Vazio se enable_waf=false. Necessário para assinar o plano de tarifa fixa do CloudFront (ver infra/README.md)."
  value       = var.enable_waf ? aws_wafv2_web_acl.site[0].arn : ""
}

output "cloudfront_distribution_arn" {
  description = "ARN da distribuição CloudFront. Necessário, junto do waf_web_acl_arn, para assinar o plano de tarifa fixa."
  value       = aws_cloudfront_distribution.site.arn
}

output "data_table" {
  description = "Nome da tabela DynamoDB que substitui o Firebase (ver docs/migracao-aws.md)."
  value       = aws_dynamodb_table.data.name
}

output "cognito_user_pool_id" {
  description = "ID do User Pool do Cognito."
  value       = aws_cognito_user_pool.users.id
}

output "cognito_web_client_id" {
  description = "ID do app client do navegador. Público por natureza — vai no frontend, como a chave do Firebase ia."
  value       = aws_cognito_user_pool_client.web.id
}

output "migracao_proximos_passos" {
  description = "O que fazer depois do apply da Fase 0."
  value       = <<-EOT

    ┌─────────────────────────────────────────────────────────────
    │ FASE 0 aplicada. Nada em produção aponta para isso ainda.
    ├─────────────────────────────────────────────────────────────
    │ Tabela ............: ${aws_dynamodb_table.data.name}
    │ User Pool .........: ${aws_cognito_user_pool.users.id}
    │ App client (web) ..: ${aws_cognito_user_pool_client.web.id}
    │ Admin(s) ..........: ${join(", ", var.admin_emails)}
    └─────────────────────────────────────────────────────────────
    1. O Cognito enviou senha temporária para: ${join(", ", var.admin_emails)}.
       Ela expira em 7 dias e a troca é obrigatória no primeiro acesso.
    2. Importar os dados:  node scripts/migrate-firebase-to-dynamo.js
    3. Conferir a importação item a item contra a cópia do Firebase.
    O site continua no Firebase até a Fase 1.
  EOT
}
