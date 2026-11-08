# =====================================================================
# Autenticação na AWS — Cognito User Pool.
#
# Substitui o Firebase Auth, que parou de funcionar em 08/11/2026: a chave de
# API do projeto Google foi apagada e o login quebrou para todos
# (`auth/api-key-not-valid`). Ver docs/migracao-aws.md.
#
# Duas diferenças de desenho em relação ao que existia:
#
# 1. **Admin é grupo, não string.** Antes, `isAdmin()` comparava o e-mail
#    logado com uma constante no JS do cliente (app.js:254). Agora é o grupo
#    `admin` no token, verificado na Lambda — o cliente não tem como se
#    declarar admin.
#
# 2. **As senhas do Firebase não vêm.** Não é possível exportá-las sem acesso
#    ao projeto. Os 2 clientes se recadastram; o histórico deles é preservado
#    pelo vínculo de e-mail canônico (GSI2 em data.tf), não pelo uid.
#
# A senha do admin NÃO passa por aqui nem pelo state: o Cognito envia uma
# temporária por e-mail para `var.admin_email`, e a troca é obrigatória no
# primeiro acesso.
# =====================================================================

resource "aws_cognito_user_pool" "users" {
  name = "sp-car-clean-users"

  # Login por e-mail. `username_attributes` não pode mudar depois de criado.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_numbers                  = true
    require_uppercase                = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # Só o próprio e-mail recupera a conta. SMS exigiria configurar SNS e custaria
  # por mensagem, sem ganho aqui.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # O e-mail padrão do Cognito tem limite baixo (dezenas por dia), o que é
  # suficiente para 3 usuários e a recuperação de senha. Se o cadastro de
  # clientes crescer, trocar por SES — aí é só mudar este bloco.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Protege contra credencial vazada e força bruta. Sem custo extra no tier
  # padrão de proteção.
  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 5
      max_length = 256
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 128
    }
  }

  # O cadastro dos clientes é o próprio site; sem isso eles não conseguiriam
  # criar conta depois da migração.
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # Os usuários são as contas dos clientes e a sua. Um destroy acidental
  # apagaria todas.
  deletion_protection = var.auth_deletion_protection ? "ACTIVE" : "INACTIVE"

  tags = { Name = "sp-car-clean-users" }
}

# Cliente de app para o navegador: sem secret (o código é público, um secret
# ali não seria secreto) e sem fluxos legados de senha em texto.
resource "aws_cognito_user_pool_client" "web" {
  name         = "sp-car-clean-web"
  user_pool_id = aws_cognito_user_pool.users.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",      # login sem a senha trafegar
    "ALLOW_REFRESH_TOKEN_AUTH", # renovação de sessão
    "ALLOW_USER_AUTH",          # escolha de fluxo pelo cliente
  ]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Não revela se um e-mail existe quando o login falha.
  prevent_user_existence_errors = "ENABLED"

  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["email", "name"]
}

# Grupo que define quem é admin. Entra no token como `cognito:groups`, e a
# Lambda confere — não o navegador.
resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.users.id
  description  = "Acesso ao painel administrativo e às rotas /api/admin/*"
  precedence   = 1
}

# Usuário admin. O Cognito envia a senha temporária por e-mail para
# `var.admin_email` — ela não passa pelo Terraform state nem por log.
resource "aws_cognito_user" "admin" {
  user_pool_id = aws_cognito_user_pool.users.id
  username     = var.admin_email

  attributes = {
    email          = var.admin_email
    email_verified = true
  }

  desired_delivery_mediums = ["EMAIL"]

  # Mudar o e-mail aqui criaria outro usuário em vez de renomear este; a troca
  # de e-mail do admin é feita no console do Cognito, de propósito.
  lifecycle {
    ignore_changes = [attributes]
  }
}

resource "aws_cognito_user_in_group" "admin" {
  user_pool_id = aws_cognito_user_pool.users.id
  group_name   = aws_cognito_user_group.admin.name
  username     = aws_cognito_user.admin.username
}
