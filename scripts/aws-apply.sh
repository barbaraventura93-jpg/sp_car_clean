#!/usr/bin/env bash
# Aplica a infraestrutura (infra/) com o Terraform, de dentro do AWS CloudShell.
#
# POR QUE ESTE SCRIPT EXISTE
#
# O `terraform apply` precisa de permissões que a chave de desenvolvimento não
# tem (SSM, API Gateway, CloudWatch Logs). No CloudShell você entra como você
# mesma, com acesso de administradora, e aí ele roda.
#
# E, principalmente: ele **descobre o `admin_emails` da própria conta**, em vez
# de pedir que você digite. Essa variável é obrigatória e não tem default; se
# for aplicada com a lista errada, o Terraform APAGA e RECRIA as contas admin
# do Cognito — ou seja, você perderia o acesso ao painel por um erro de
# digitação. Lendo do grupo `admin` que já existe, isso não pode acontecer.
#
# USO (no AWS CloudShell, região sa-east-1):
#   git clone https://github.com/barbaraventura93-jpg/sp_car_clean.git
#   cd sp_car_clean && bash scripts/aws-apply.sh
#
# Ele mostra o plano e PERGUNTA antes de aplicar. Nada acontece sem o seu "yes".
set -euo pipefail

REGION="sa-east-1"
TFV="1.10.5"

echo "→ conta e identidade"
aws sts get-caller-identity --query '[Account,Arn]' --output text

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="sp-car-clean-tfstate-${ACCOUNT}"
INFRA="$(cd "$(dirname "$0")/../infra" && pwd)"

# Terraform no CloudShell: não vem instalado, e o disco é temporário.
if ! command -v terraform >/dev/null 2>&1; then
  echo "→ baixando Terraform ${TFV}"
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/tf.zip" \
    "https://releases.hashicorp.com/terraform/${TFV}/terraform_${TFV}_linux_amd64.zip"
  unzip -oq "$TMP/tf.zip" -d "$TMP"
  export PATH="$TMP:$PATH"
fi
terraform version | head -1

echo "→ descobrindo os admins no grupo \`admin\` do Cognito"
POOL="$(aws cognito-idp list-user-pools --max-results 10 --region "$REGION" \
  --query "UserPools[?Name=='sp-car-clean-users'].Id | [0]" --output text)"
if [ -z "$POOL" ] || [ "$POOL" = "None" ]; then
  echo "✗ pool 'sp-car-clean-users' não encontrado — pare e verifique a região." >&2
  exit 1
fi

# O e-mail é o atributo `email`; o username é o sub. A ordem não importa para o
# Terraform (é um set), mas ordenar deixa o plano estável de uma vez para outra.
EMAILS="$(aws cognito-idp list-users-in-group --user-pool-id "$POOL" \
  --group-name admin --region "$REGION" \
  --query 'Users[].Attributes[?Name==`email`].Value' --output text | tr '\t' '\n' | sort -u)"

if [ -z "$EMAILS" ]; then
  echo "✗ nenhum usuário no grupo admin. Aplicar assim apagaria as contas." >&2
  exit 1
fi

echo "  admins encontrados:"
echo "$EMAILS" | sed 's/^/    /'

LISTA="$(echo "$EMAILS" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"

printf 'bucket = "%s"\n' "$BUCKET" > "${INFRA}/backend.hcl"
cd "$INFRA"

echo "→ init (estado em s3://${BUCKET})"
terraform init -input=false -backend-config=backend.hcl >/dev/null

echo "→ plano"
terraform plan -input=false -var="admin_emails=${LISTA}" -out=plano.tfplan

cat <<'AVISO'

────────────────────────────────────────────────────────────────────
Confira o plano acima antes de continuar. O que é esperado nesta leva:

  criar   aws_iam_role_policy.lambda_data          (se ainda não existir)
  criar   aws_lambda_function.fn["unsubscribe"]    + grupo de logs
  criar   a rota /api/unsubscribe no API Gateway   (integração + permissão)
  alterar as 19 funções, só para receber DATA_TABLE

NÃO deve haver nada com "destroy" — muito menos em aws_cognito_user,
aws_dynamodb_table ou aws_s3_bucket. Se houver, responda "no" e me chame.
────────────────────────────────────────────────────────────────────

AVISO

read -r -p 'Aplicar? digite "sim" para continuar: ' RESP
if [ "$RESP" != "sim" ]; then
  echo "→ nada foi aplicado."
  exit 0
fi

terraform apply plano.tfplan
echo
echo "→ pronto. Agora o merge do PR publica o código novo sem quebrar o deploy."
