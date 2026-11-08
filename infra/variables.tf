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

variable "enable_waf" {
  description = "Cria o AWS WAF de infra/waf.tf e o associa ao CloudFront. Obrigatório para assinar um plano de tarifa fixa do CloudFront — e, com o plano ativo, não dá para voltar para false sem cancelar o plano antes. Sem plano, um web ACL custa ~US$5/mês + ~US$1 por regra; com o tier Free, US$ 0."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Teto de requisições por IP a cada 5 minutos antes de bloquear (regra rate-limit do web ACL). O tráfego normal do site é ~390 req/dia no total, então 2.000 por IP sobra para uso real e ainda barra pico de origem única."
  type        = number
  default     = 2000
}

variable "admin_emails" {
  description = "E-mails com acesso admin no Cognito. Cada um recebe uma senha temporária por e-mail, com troca obrigatória — então cada endereço tem de ser uma caixa realmente acessível. O admin histórico do código é spcarclean0@gmail.com (app.js:9). Manter um segundo endereço aqui é proposital enquanto o primeiro não for testado: em 08/11/2026 o acesso ao painel foi perdido por depender de um único caminho, e remover a credencial que funciona antes de validar a substituta repetiria isso."
  type        = list(string)

  validation {
    condition     = length(var.admin_emails) > 0
    error_message = "Precisa de ao menos um e-mail admin — sem isso ninguém administra o site."
  }

  validation {
    condition     = alltrue([for e in var.admin_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))])
    error_message = "Todos os valores de admin_emails precisam ser endereços de e-mail válidos."
  }
}

variable "data_deletion_protection" {
  description = "Proteção contra exclusão da tabela sp-car-clean-data. Deixe true: os dados do negócio vivem lá. Para um destroy proposital, mude para false e aplique antes."
  type        = bool
  default     = true
}

variable "auth_deletion_protection" {
  description = "Proteção contra exclusão do User Pool do Cognito. Deixe true: apagá-lo elimina as contas de todos os clientes, e elas não têm como ser recriadas a partir de backup."
  type        = bool
  default     = true
}
