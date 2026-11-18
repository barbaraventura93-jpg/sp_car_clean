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
# USO (no AWS CloudShell, região sa-east-1) — ATENÇÃO AO RAMO:
#   git clone -b ccr-d3d7761c-vw5yj5 https://github.com/barbaraventura93-jpg/sp_car_clean.git
#   cd sp_car_clean && bash scripts/aws-apply.sh
#
# O RAMO IMPORTA. Aplicar a partir da `main` (que é o que um `git clone` sem
# `-b` entrega) faria o Terraform DESTRUIR a permissão das funções na tabela do
# DynamoDB — ela existe no estado, mas ainda não está na `main`. O site voltaria
# a ficar sem banco. A trava abaixo recusa rodar nesse caso; não confie só nesta
# instrução, porque instrução é o que mais se perde pelo caminho.
#
# Ele mostra o plano e PERGUNTA antes de aplicar. Nada acontece sem o seu "sim".
set -euo pipefail

REGION="sa-east-1"
TFV="1.10.5"

# ── trava: a configuração aqui tem de ser a da migração ───────────────
#
# Cada item abaixo já existe (ou vai existir) no estado do Terraform. Se a
# configuração não os tiver, o `apply` os apagaria em vez de criá-los.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
faltando=()
grep -q 'aws_iam_role_policy" "lambda_data"' "$REPO/infra/data.tf" 2>/dev/null \
  || faltando+=("infra/data.tf: política lambda_data (acesso das funções à tabela)")
grep -q 'DATA_TABLE' "$REPO/infra/api.tf" 2>/dev/null \
  || faltando+=("infra/api.tf: variável DATA_TABLE")
grep -q '"unsubscribe"' "$REPO/infra/api.tf" 2>/dev/null \
  || faltando+=("infra/api.tf: função unsubscribe em http_functions")

if [ ${#faltando[@]} -gt 0 ]; then
  echo "✗ PARE. Esta cópia do repositório não é a da migração:" >&2
  for f in "${faltando[@]}"; do echo "    falta $f" >&2; done
  echo >&2
  echo "  Ramo atual: $(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" >&2
  echo "  Aplicar assim APAGARIA recursos que já existem — entre eles a permissão" >&2
  echo "  das funções na tabela do DynamoDB, que é o que faz o painel ter dados." >&2
  echo >&2
  echo "  Use o ramo da migração:" >&2
  echo "    git clone -b ccr-d3d7761c-vw5yj5 https://github.com/barbaraventura93-jpg/sp_car_clean.git" >&2
  echo "  (ou, depois que o PR #67 for mesclado, a própria main)" >&2
  exit 1
fi
echo "→ configuração conferida: é a da migração"

# Costura para o teste: confere e sai, sem falar com a AWS.
[ -n "${SOMENTE_CONFERIR:-}" ] && exit 0

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
