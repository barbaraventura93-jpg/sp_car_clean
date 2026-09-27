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

variable "acm_certificate_arn" {
  description = "ARN do certificado ACM emitido em us-east-1 (obrigatório para o CloudFront). Preencha após o certificado ficar 'Issued'."
  type        = string
}

variable "site_aliases" {
  description = "Domínios servidos pelo CloudFront. TODOS precisam estar cobertos pelo certificado ACM. Ex.: [\"spcarclean.com.br\"] se o certificado cobrir só o domínio raiz."
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
  description = "Liga os crons na AWS (ai-dispatcher, birthday-check, reminder-check). Deixe false enquanto os crons do Netlify estiverem ativos, senão os envios (lembretes, cupons de aniversário) saem em dobro."
  type        = bool
  default     = false
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
