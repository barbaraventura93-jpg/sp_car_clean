#!/usr/bin/env bash
# Move o estado do Terraform (infra/) do disco do CloudShell para um bucket S3
# privado, versionado e criptografado. Idempotente: pode rodar de novo, e é o
# mesmo comando para recriar o backend.hcl num CloudShell novo.
#
# Uso (no AWS CloudShell, região sa-east-1, dentro do repositório):
#   bash scripts/aws-bootstrap-tfstate.sh
set -euo pipefail

REGION="sa-east-1"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="sp-car-clean-tfstate-${ACCOUNT}"
INFRA_DIR="$(cd "$(dirname "$0")/../infra" && pwd)"

echo "→ bucket de estado: s3://${BUCKET}"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  já existe"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  echo "  criado"
fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyInsecureTransport\", \"Effect\": \"Deny\", \"Principal\": \"*\",
    \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::${BUCKET}\", \"arn:aws:s3:::${BUCKET}/*\"],
    \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
  }]
}"
# Versões antigas do estado ficam 90 dias (histórico para desfazer um apply ruim).
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{"ID": "expira-versoes-antigas", "Status": "Enabled", "Filter": {},
             "NoncurrentVersionExpiration": {"NoncurrentDays": 90}}]
}'
echo "  privado, versionado, criptografado, só HTTPS"

printf 'bucket = "%s"\n' "$BUCKET" > "${INFRA_DIR}/backend.hcl"
echo "→ ${INFRA_DIR}/backend.hcl gerado"

cd "$INFRA_DIR"
if [ -s terraform.tfstate ]; then
  BACKUP="$HOME/tfstate-backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP" && cp terraform.tfstate* "$BACKUP"/
  echo "→ cópia de segurança do estado local em ${BACKUP}"
  terraform init -input=false -migrate-state -force-copy -backend-config=backend.hcl
  echo "→ estado migrado; removendo a cópia local (o backup acima continua)"
  rm -f terraform.tfstate terraform.tfstate.backup
else
  terraform init -input=false -backend-config=backend.hcl
fi

echo "→ recursos no estado remoto: $(terraform state list | wc -l)"
