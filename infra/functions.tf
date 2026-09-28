# =====================================================================
# FASE 2 — Funções (Netlify Functions → AWS Lambda + API Gateway)
# =====================================================================
# As funções não têm dependências externas (só fetch nativo + crypto) e já
# estão no formato de handler da AWS. Empacotamos a pasta netlify/functions
# inteira e apontamos cada Lambda para o entry.js (que carrega os segredos do
# SSM e delega para a função-alvo via FN_TARGET).

locals {
  # Funções HTTP (chamadas pelo front ou por webhooks externos).
  http_functions = {
    "ai"                  = {}
    "notify-booking"      = {}
    "booking-status"      = {}
    "create-payment"      = {}
    "create-gift-payment" = {}
    "create-referral"     = {}
    "infinitepay-webhook" = {}
    "whatsapp-webhook"    = {}
  }

  # Funções agendadas (cron). Horários iguais aos do netlify.toml (UTC).
  scheduled_functions = {
    "ai-dispatcher"  = { schedule = "cron(0 11 * * ? *)" }
    "birthday-check" = { schedule = "cron(0 12 * * ? *)" }
    "reminder-check" = { schedule = "cron(0 13 * * ? *)" }
  }

  all_functions = merge(local.http_functions, local.scheduled_functions)
}

# Empacota a pasta netlify/functions (código + lib/, sem node_modules).
data "archive_file" "functions" {
  type        = "zip"
  source_dir  = "${path.module}/../netlify/functions"
  output_path = "${path.module}/build/functions.zip"
}

# ---------- IAM: papel de execução das Lambdas ----------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "sp-car-clean-lambda-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Logs no CloudWatch.
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Leitura dos segredos no SSM (+ decrypt do SecureString via chave gerenciada do SSM).
data "aws_iam_policy_document" "lambda_secrets" {
  statement {
    sid       = "ReadSsmParams"
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/sp-car-clean/*"]
  }
  statement {
    sid       = "DecryptSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name   = "read-ssm-secrets"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_secrets.json
}

# ---------- Lambdas (uma por função) ----------
resource "aws_lambda_function" "fn" {
  for_each = local.all_functions

  function_name    = "sp-car-clean-${each.key}"
  filename         = data.archive_file.functions.output_path
  source_code_hash = data.archive_file.functions.output_base64sha256
  handler          = "entry.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  role             = aws_iam_role.lambda_exec.arn

  environment {
    variables = {
      FN_TARGET      = each.key
      SECRETS_PREFIX = "/sp-car-clean/"
    }
  }
}

# Logs com retenção (evita CloudWatch crescer sem limite).
resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.all_functions
  name              = "/aws/lambda/sp-car-clean-${each.key}"
  retention_in_days = 30
}

# =====================================================================
# API Gateway HTTP API — expõe as funções HTTP em /api/<nome>
# =====================================================================
resource "aws_apigatewayv2_api" "http" {
  name          = "sp-car-clean-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each = local.http_functions

  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.fn[each.key].invoke_arn
  integration_method = "POST"
  # payload 1.0 entrega o evento no formato Netlify (httpMethod, headers, body,
  # queryStringParameters) — por isso os handlers funcionam sem reescrever.
  payload_format_version = "1.0"
}

# Rota ANY (aceita GET/POST/OPTIONS; o handler decide). Cobre o webhook do
# WhatsApp (GET de verificação + POST de mensagens) e o preflight de CORS.
resource "aws_apigatewayv2_route" "fn" {
  for_each = local.http_functions

  api_id    = aws_apigatewayv2_api.http.id
  route_key = "ANY /api/${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.fn[each.key].id}"
}

resource "aws_lambda_permission" "apigw" {
  for_each = local.http_functions

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# =====================================================================
# EventBridge — dispara as funções agendadas (cron)
# =====================================================================
resource "aws_cloudwatch_event_rule" "cron" {
  for_each = local.scheduled_functions

  name                = "sp-car-clean-${each.key}"
  schedule_expression = each.value.schedule
}

resource "aws_cloudwatch_event_target" "cron" {
  for_each = local.scheduled_functions

  rule = aws_cloudwatch_event_rule.cron[each.key].name
  arn  = aws_lambda_function.fn[each.key].arn
}

resource "aws_lambda_permission" "cron" {
  for_each = local.scheduled_functions

  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cron[each.key].arn
}

# ---------- Saídas úteis ----------
output "api_endpoint" {
  description = "URL base da API (para testar as funções antes de rotear pelo CloudFront)."
  value       = aws_apigatewayv2_api.http.api_endpoint
}
