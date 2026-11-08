#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Verifica as regras de escrita de giftcards/<code> no Firebase Realtime DB.
#
# Rode ANTES e DEPOIS de publicar as regras:
#     firebase deploy --only database
#
# ANTES da correção, o teste 1 é PERMITIDO — é a brecha: qualquer pessoa, sem
# login, cria um gift card com status e saldo arbitrários.
# DEPOIS, os seis ataques devem ser NEGADOS e o fluxo legítimo PERMITIDO.
#
# Uso:
#     ./scripts/test-giftcard-rules.sh
#     DB_URL=https://outro-projeto.firebaseio.com ./scripts/test-giftcard-rules.sh
#
# ATENÇÃO: este script ESCREVE na base apontada por DB_URL. Os cartões que ele
# cria não têm valor (saldo 0, ou status depleted), mas aparecem no painel —
# apague-os no fim, em Admin > Gift Cards. Não rode contra produção em horário
# de pico sem necessidade.
# ---------------------------------------------------------------------------
set -u

DB="${DB_URL:-https://sp-car-clean-default-rtdb.firebaseio.com}"
POC1="GIFT-TESTEPOC1"   # tentativa de criar com status/saldo arbitrários
POC2="GIFT-TESTEPOC2"   # tentativa de criar ATIVO com saldo
POC3="GIFT-TESTEPOC3"   # tentativa de criar PENDENTE com saldo
LEG="GIFT-TESTELEG1"    # cartão pendente legítimo (saldo 0)
falhas=0

req() { # método path corpo -> imprime o código HTTP
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
    -X "$1" -H 'Content-Type: application/json' -d "$3" "$DB$2" 2>/dev/null
}

checa() { # título código_obtido negado|permitido
  local titulo="$1" codigo="$2" quero="$3" ok=0
  if [ "$quero" = "negado" ]; then
    [ "$codigo" = "401" ] && ok=1
  else
    [ "$codigo" = "200" ] && ok=1
  fi
  if [ "$ok" = "1" ]; then
    printf '  OK      %-54s (HTTP %s)\n' "$titulo" "$codigo"
  else
    printf '  FALHOU  %-54s (HTTP %s, esperava %s)\n' "$titulo" "$codigo" "$quero"
    falhas=$((falhas + 1))
  fi
}

echo "Banco: $DB"
echo
echo "— ATAQUES (todos devem ser NEGADOS) —"

checa "1. criar cartão com status e saldo arbitrários" \
  "$(req PUT "/giftcards/$POC1.json" "{\"code\":\"$POC1\",\"amount\":1,\"balance\":0,\"status\":\"depleted\"}")" \
  negado

checa "2. criar cartão ATIVO com saldo (crédito do nada)" \
  "$(req PUT "/giftcards/$POC2.json" "{\"code\":\"$POC2\",\"amount\":500,\"balance\":500,\"status\":\"active\"}")" \
  negado

checa "3. criar PENDENTE já com saldo" \
  "$(req PUT "/giftcards/$POC3.json" "{\"code\":\"$POC3\",\"amount\":500,\"balance\":500,\"status\":\"pending\"}")" \
  negado

# Os testes 4 a 6 precisam de um cartão existente: cria o legítimo primeiro.
req PUT "/giftcards/$LEG.json" \
  "{\"code\":\"$LEG\",\"amount\":100,\"balance\":0,\"status\":\"pending\",\"buyerName\":\"Teste\",\"buyerEmail\":\"teste@exemplo.com\",\"createdAt\":\"2026-01-01T00:00:00.000Z\"}" \
  > /dev/null

checa "4. aumentar o saldo de um cartão existente" \
  "$(req PATCH "/giftcards/$LEG.json" '{"balance":9999}')" \
  negado

checa "5. trocar o valor de face (amount)" \
  "$(req PATCH "/giftcards/$LEG.json" '{"amount":9999}')" \
  negado

checa "6. ativar um pendente por fora do pagamento" \
  "$(req PATCH "/giftcards/$LEG.json" '{"status":"active","balance":500}')" \
  negado

echo
echo "— FLUXO LEGÍTIMO (deve ser PERMITIDO) —"
echo "  Se o teste 7 falhar, a compra de gift card está QUEBRADA no site."

checa "7. criar pendente com saldo 0 (buyGiftCard)" \
  "$(req PUT "/giftcards/$LEG.json" "{\"code\":\"$LEG\",\"amount\":100,\"balance\":0,\"status\":\"pending\",\"buyerName\":\"Teste\",\"buyerEmail\":\"teste@exemplo.com\",\"createdAt\":\"2026-01-01T00:00:00.000Z\"}")" \
  permitido

echo
if [ "$falhas" = "0" ]; then
  echo "RESULTADO: todos os testes passaram."
else
  echo "RESULTADO: $falhas teste(s) fora do esperado."
fi

echo
echo "Limpeza: apague em Admin > Gift Cards os códigos de teste que tenham sido"
echo "criados — $POC1, $POC2, $POC3, $LEG. Nenhum deles tem saldo utilizável."

[ "$falhas" = "0" ] && exit 0 || exit 1
