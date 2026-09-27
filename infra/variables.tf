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

variable "cloudfront_price_class" {
  description = "PriceClass_All inclui edges na América do Sul (melhor latência para o público no Brasil). Troque para PriceClass_100 se quiser economizar abrindo mão do edge BR."
  type        = string
  default     = "PriceClass_All"
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
