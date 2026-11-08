# =====================================================================
# Banco de dados do site na AWS — tabela única DynamoDB.
#
# Substitui o Firebase Realtime Database, cujo projeto Google ficou
# inacessível em 08/11/2026 (ver docs/migracao-aws.md). Nada aponta para esta
# tabela até a Fase 1: na Fase 0 ela só recebe a importação e é conferida
# contra a cópia do Firebase.
#
# Modelo (mapeamento completo em docs/migracao-aws.md):
#   pk = CATALOG | AVAIL#<ano> | BOOKING | CLIENT#<sub> | COUPON | GIFTCARD
#        | STOCK | FEEDBACK | WAITLIST | AI | ADMIN
#   sk = discriminador dentro da partição (SERVICE#<slug>, BOOKING#<código>…)
#
# Sob demanda (PAY_PER_REQUEST): no volume do site — ~390 visitas/dia — isso
# fica na casa de centavos e escala a zero, sem capacidade provisionada para
# dimensionar errado.
# =====================================================================

resource "aws_dynamodb_table" "data" {
  name         = "sp-car-clean-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # GSI1 — agenda por mês. Responde "agendamentos de novembro" sem varrer a
  # tabela: gsi1pk = BOOKING#2026-11, gsi1sk = 2026-11-18#SPC-ABC123.
  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  # GSI2 — cliente por e-mail canônico. É o que preserva o histórico quando um
  # cliente se recadastra: o vínculo é o e-mail, não o uid do Firebase (que não
  # pode ser exportado sem acesso ao projeto). gsi2pk = EMAIL#<canônico>.
  attribute {
    name = "gsi2pk"
    type = "S"
  }

  attribute {
    name = "gsi2sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1-agenda"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "gsi2-cliente-email"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }

  # Expiração automática dos registros efêmeros: aiLogs e aiRateLimit entram
  # com `expiresAt` (epoch em segundos) de 90 dias. O DynamoDB apaga sozinho —
  # sem cron de limpeza para manter.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Recuperação ponto-a-ponto: 35 dias de histórico, restaura em qualquer
  # segundo. É o que protege contra escrita errada da aplicação, que backup
  # diário não cobre. Custa US$ 0,30/GB-mês — com 276 KB, frações de centavo.
  point_in_time_recovery {
    enabled = true
  }

  # Os dados do negócio vivem aqui. Um `terraform destroy` acidental não pode
  # levá-los. Para destruir de propósito, mude a variável e aplique antes.
  deletion_protection_enabled = var.data_deletion_protection

  tags = { Name = "sp-car-clean-data" }
}
