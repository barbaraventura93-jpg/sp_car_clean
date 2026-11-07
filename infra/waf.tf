# =====================================================================
# AWS WAF do site — escopo CLOUDFRONT, portanto criado em us-east-1
# (mesmo provider alternativo do certificado em certificate.tf).
#
# Existe por dois motivos:
#
# 1. PROTEÇÃO. Entre 1 e 7/nov/2026 a distribuição saiu de ~390 para
#    ~99.500 requisições/dia, com 96,7% de respostas 4xx — varredura de bot
#    sondando caminhos que não existem (5xx ficou em 0%, nada caiu). O app já
#    tem rate-limit por IP (x-viewer-ip) e throttling no API Gateway, mas nada
#    filtrava o tráfego ANTES de chegar ao CloudFront e ao S3.
#
# 2. PRÉ-REQUISITO DO PLANO DE TARIFA FIXA. Um plano do CloudFront exige um
#    web ACL associado à distribuição; enquanto o plano estiver ativo a
#    associação não pode ser removida (um apply com enable_waf=false falha).
#    Em troca, o tier Free cobre o web ACL, as regras gerenciadas gratuitas e
#    a zona do Route 53. Ver "WAF e plano de tarifa fixa" no infra/README.md.
#
# ⚠️ A ORDEM IMPORTA: sem plano, um web ACL custa ~US$5/mês + ~US$1 por regra.
# Aplique e assine o plano em seguida (comando no README), ou mantenha
# enable_waf=false até querer assinar.
#
# O tier Free permite 5 regras; usamos 3.
# =====================================================================

resource "aws_wafv2_web_acl" "site" {
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1

  name        = "sp-car-clean-site"
  description = "Protecao do site SP Car Clean (reputacao de IP, exploracoes comuns, teto por IP)"
  scope       = "CLOUDFRONT"

  # Site público: libera por padrão e bloqueia só o que as regras pegarem.
  default_action {
    allow {}
  }

  # Prioridade 0 — IPs com histórico de ataque/DDoS, pela inteligência da
  # Amazon. Primeiro na fila de propósito: descarta o bot antes das inspeções
  # mais caras. Grupo gerenciado gratuito, coberto pelo plano.
  rule {
    name     = "ip-reputation"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # Prioridade 1 — padrões comuns de exploração (/.env, /wp-admin, path
  # traversal, injeção). É a regra que efetivamente pega uma varredura de
  # caminhos como a de novembro.
  #
  # O scope_down tira /api/* e /.netlify/functions/* da inspeção, de propósito:
  # a Central de IA manda prompts longos e com texto livre, que disparariam
  # falso positivo em SizeRestrictions_BODY (corpo > 8 KB) e nas regras de
  # XSS/RFI sobre o corpo — quebrando a IA em produção. Os dois prefixos
  # aparecem porque o caminho legado do Netlify é reescrito pela CloudFront
  # Function, e assim a exceção vale independente da ordem de avaliação.
  # A API não fica descoberta: ela mantém x-origin-verify, o throttling do
  # API Gateway (25 req/s) e o rate-limit por IP da própria aplicação.
  rule {
    name     = "common-rules"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        scope_down_statement {
          not_statement {
            statement {
              or_statement {
                statement {
                  byte_match_statement {
                    search_string         = "/api/"
                    positional_constraint = "STARTS_WITH"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

                statement {
                  byte_match_statement {
                    search_string         = "/.netlify/functions/"
                    positional_constraint = "STARTS_WITH"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common-rules"
      sampled_requests_enabled   = true
    }
  }

  # Prioridade 2 — teto de requisições por IP numa janela de 5 minutos.
  # É rede de segurança contra pico/DDoS de origem única, NÃO o remédio da
  # varredura atual: diluída em 24h ela fica abaixo deste teto, e quem a pega
  # são as duas regras acima. O tráfego normal do site era ~390 req/DIA no
  # total, então 2.000 por IP a cada 5 min sobra com folga para gente real.
  rule {
    name     = "rate-limit"
    priority = 2

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "sp-car-clean-site"
    sampled_requests_enabled   = true
  }

  tags = { Name = "sp-car-clean-site" }
}
