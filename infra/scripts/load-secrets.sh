#!/usr/bin/env bash
# Lê infra/scripts/secrets.env e cria/atualiza cada variável no AWS SSM
# Parameter Store como SecureString, sob o prefixo /sp-car-clean/.
#
# Uso (no CloudShell, dentro de ~/sp_car_clean):
#   cp infra/scripts/secrets.env.example infra/scripts/secrets.env
#   nano infra/scripts/secrets.env      # preencha os valores (copie do Netlify)
#   bash infra/scripts/load-secrets.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${1:-$DIR/secrets.env}"
PREFIX="/sp-car-clean"

if [ ! -f "$ENV_FILE" ]; then
  echo "Não encontrei $ENV_FILE."
  echo "Faça: cp $DIR/secrets.env.example $DIR/secrets.env  e preencha os valores."
  exit 1
fi

count=0
while IFS= read -r line || [ -n "$line" ]; do
  # remove espaços à esquerda
  line="${line#"${line%%[![:space:]]*}"}"
  # ignora vazias e comentários
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  # separa KEY=VALUE no primeiro '='
  key="${line%%=*}"
  value="${line#*=}"
  key="$(printf '%s' "$key" | xargs)"
  # tira aspas externas, se houver
  value="${value%\"}"; value="${value#\"}"
  if [ -z "$value" ]; then
    echo "· $key vazio — pulando"
    continue
  fi
  aws ssm put-parameter --name "$PREFIX/$key" --type SecureString --value "$value" --overwrite >/dev/null
  echo "✓ $PREFIX/$key"
  count=$((count + 1))
done < "$ENV_FILE"

echo ""
echo "Concluído: $count parâmetro(s) gravado(s) no SSM sob $PREFIX/."
echo "Lembre do FCM_SERVICE_ACCOUNT (JSON) — suba à parte, veja o secrets.env.example."
