# =====================================================================
# Push do admin (Web Push padrão, sem Firebase): chave VAPID e tabela com os
# aparelhos inscritos. A chave privada fica só no SSM (e no estado, que é
# criptografado no S3); a pública é derivada dela pela função push-subscription.
# =====================================================================
resource "tls_private_key" "vapid" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "aws_ssm_parameter" "vapid_private_key" {
  name  = "${var.ssm_param_path}WEB_PUSH_VAPID_PRIVATE_KEY"
  type  = "SecureString"
  value = tls_private_key.vapid.private_key_pem
}

resource "aws_dynamodb_table" "push" {
  name         = "sp-car-clean-push-subscriptions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

data "aws_iam_policy_document" "lambda_push" {
  statement {
    sid       = "PushSubscriptions"
    actions   = ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Scan"]
    resources = [aws_dynamodb_table.push.arn]
  }
}

resource "aws_iam_role_policy" "lambda_push" {
  name   = "push-subscriptions"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_push.json
}
