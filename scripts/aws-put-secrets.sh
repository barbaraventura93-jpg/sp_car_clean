#!/usr/bin/env bash
# Copia as variáveis de ambiente das funções para o AWS SSM Parameter Store
# (SecureString, criptografadas), onde as Lambdas as leem ao iniciar.
#
# Entrada: arquivo JSON {"CHAVE": "valor", ...}.
#
# Uso (no AWS CloudShell, região sa-east-1):
#   bash scripts/aws-put-secrets.sh segredos.json
#   rm segredos.json      # não deixe o arquivo com segredos para trás
#
# Pode rodar de novo quando quiser: sobrescreve os valores existentes.
set -euo pipefail

FILE="${1:?uso: $0 arquivo.json}"
PREFIX="${SSM_PREFIX:-/sp-car-clean/}"
REGION="${AWS_REGION:-sa-east-1}"

command -v jq >/dev/null || { echo "jq não encontrado"; exit 1; }
jq -e 'type == "object"' "$FILE" >/dev/null || { echo "$FILE não é um objeto JSON"; exit 1; }

count=0
while IFS= read -r entry; do
  key="$(jq -r '.key' <<<"$entry")"
  value="$(jq -r '.value' <<<"$entry")"

  # URL é definida pelo Terraform; AWS_*/LAMBDA_*/NODE_* são reservadas do runtime.
  if [[ ! "$key" =~ ^[A-Za-z][A-Za-z0-9_]*$ || "$key" == "URL" || "$key" =~ ^(AWS_|LAMBDA_|NODE_) ]]; then
    echo "pulando  $key"
    continue
  fi
  if [[ -z "$value" ]]; then
    echo "vazio    $key (pulando)"
    continue
  fi

  aws ssm put-parameter --region "$REGION" --name "${PREFIX}${key}" \
    --type SecureString --value "$value" --overwrite >/dev/null
  echo "ok       ${PREFIX}${key}"
  count=$((count + 1))
done < <(jq -c 'to_entries[] | {key, value: (.value | tostring)}' "$FILE")

echo "$count parâmetro(s) gravado(s) em ${PREFIX} (${REGION})."
