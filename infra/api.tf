# =====================================================================
# Backend: as funções de functions/ rodando em AWS Lambda,
# expostas por um API Gateway (HTTP API) atrás do mesmo CloudFront do site.
# =====================================================================

locals {
  site_url = var.site_url != "" ? var.site_url : "https://${var.site_aliases[0]}"

  # Chamadas pelo site / webhooks externos → rota /api/<nome>.
  http_functions = [
    "ai",
    "booking-status",
    "create-gift-payment",
    "create-payment",
    "create-referral",
    "infinitepay-webhook",
    "notify-booking",
    "push-subscription",
  ]

  # Horários em UTC (08h, 09h e 10h em Brasília).
  scheduled_functions = {
    "ai-dispatcher"  = "cron(0 11 * * ? *)"
    "birthday-check" = "cron(0 12 * * ? *)"
    "reminder-check" = "cron(0 13 * * ? *)"
  }

  all_functions = concat(local.http_functions, keys(local.scheduled_functions))
  ssm_path_arn  = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${trimsuffix(var.ssm_param_path, "/")}"
}

# Pacote inicial. Depois do primeiro apply, quem publica código novo é o
# GitHub Actions (deploy-aws.yml) — por isso o Terraform ignora o código.
data "archive_file" "functions" {
  type        = "zip"
  source_dir  = "${path.module}/../functions"
  output_path = "${path.module}/.build/functions.zip"
}

# Segredo que só o CloudFront envia ao API Gateway: requisições diretas ao
# endpoint execute-api (sem passar pelo CloudFront) são recusadas com 403.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------
# IAM das funções
# ---------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "sp-car-clean-functions"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_ssm" {
  statement {
    sid       = "ReadSecrets"
    actions   = ["ssm:GetParametersByPath"]
    resources = [local.ssm_path_arn, "${local.ssm_path_arn}/*"]
  }

  statement {
    sid       = "DecryptSecureStrings"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "lambda_ssm" {
  name   = "read-ssm-secrets"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_ssm.json
}

# ---------------------------------------------------------------------
# Funções
# ---------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "fn" {
  for_each          = toset(local.all_functions)
  name              = "/aws/lambda/sp-car-clean-${each.key}"
  retention_in_days = 14
}

resource "aws_lambda_function" "fn" {
  for_each = toset(local.all_functions)

  function_name    = "sp-car-clean-${each.key}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "lib/aws-adapter.handler"
  filename         = data.archive_file.functions.output_path
  source_code_hash = data.archive_file.functions.output_base64sha256
  memory_size      = 256
  # HTTP: abaixo do teto de 30 s do API Gateway. Crons: folga para lotes.
  timeout = contains(local.http_functions, each.key) ? 29 : 120

  environment {
    variables = {
      FN_NAME              = each.key
      SSM_PARAM_PATH       = var.ssm_param_path
      URL                  = local.site_url
      ORIGIN_VERIFY_SECRET = random_password.origin_verify.result
      PUSH_TABLE           = aws_dynamodb_table.push.name
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [
    aws_cloudwatch_log_group.fn,
    aws_iam_role_policy_attachment.lambda_logs,
    aws_iam_role_policy.lambda_ssm,
    aws_iam_role_policy.lambda_push,
    aws_ssm_parameter.vapid_private_key,
  ]
}

# ---------------------------------------------------------------------
# API Gateway (HTTP API) — payload 1.0 (httpMethod/headers/body, formato que as funções usam)
# ---------------------------------------------------------------------
resource "aws_apigatewayv2_api" "api" {
  name          = "sp-car-clean-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # Teto de custo/abuso para a API inteira (além do rate-limit por IP das funções).
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = toset(local.http_functions)
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "fn" {
  for_each  = toset(local.http_functions)
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /api/${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.fn[each.key].id}"
}

resource "aws_lambda_permission" "api" {
  for_each      = toset(local.http_functions)
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*/api/${each.key}"
}

# ---------------------------------------------------------------------
# Crons — EventBridge Scheduler
# ---------------------------------------------------------------------
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "sp-car-clean-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [for name in keys(local.scheduled_functions) : aws_lambda_function.fn[name].arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "invoke-scheduled-functions"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "cron" {
  for_each = local.scheduled_functions

  name                         = "sp-car-clean-${each.key}"
  schedule_expression          = each.value
  schedule_expression_timezone = "UTC"
  state                        = var.schedules_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.fn[each.key].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ source = "eventbridge-scheduler" })

    # Sem retentativa: um cron repetido reenviaria lembretes/cupons.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
