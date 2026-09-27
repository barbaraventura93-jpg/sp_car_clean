variable "aws_region" {
  description = "Região principal da infraestrutura."
  type        = string
  default     = "sa-east-1"
}

variable "domain_name" {
  description = "Domínio raiz do site (sem www, sem https)."
  type        = string
  default     = "spcarclean.com.br"
}

variable "site_aliases" {
  description = "Domínios servidos pelo CloudFront. Precisam ser o domínio raiz ou um subdomínio de primeiro nível (cobertos pelo certificado de certificate.tf)."
  type        = list(string)
  default     = ["spcarclean.com.br", "www.spcarclean.com.br"]
}

variable "cloudfront_price_class" {
  description = "PriceClass_All inclui edges na América do Sul (melhor latência para o público no Brasil). Troque para PriceClass_100 se quiser economizar abrindo mão do edge BR."
  type        = string
  default     = "PriceClass_All"
}

variable "site_url" {
  description = "URL pública canônica do site (links em e-mails/WhatsApp e URL de retorno dos webhooks de pagamento). Vazio = https://<primeiro item de site_aliases>."
  type        = string
  default     = ""
}

variable "ssm_param_path" {
  description = "Prefixo no SSM Parameter Store onde ficam os segredos das funções (ex.: /sp-car-clean/ANTHROPIC_API_KEY)."
  type        = string
  default     = "/sp-car-clean/"
}

variable "schedules_enabled" {
  description = "Liga os crons na AWS (ai-dispatcher, birthday-check, reminder-check). Use false só para pausar temporariamente."
  type        = bool
  default     = true
}

variable "github_owner" {
  description = "Dono do repositório no GitHub."
  type        = string
  default     = "barbaraventura93-jpg"
}

variable "github_repo" {
  description = "Nome do repositório no GitHub."
  type        = string
  default     = "sp_car_clean"
}

variable "github_branch" {
  description = "Branch autorizada a publicar (deploy)."
  type        = string
  default     = "main"
}
