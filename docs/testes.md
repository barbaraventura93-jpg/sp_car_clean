# Testes — SP Car Clean

Os testes existem para que uma mudança de hoje não quebre, sem aviso, o que já
funcionava ontem. Última atualização: 10/11/2026.

## A regra

1. **Toda mudança roda `npm test`** antes de ser enviada.
2. **Todo bug corrigido ganha um teste de regressão**: um teste que falhava
   antes da correção e passa depois.
3. **Toda regra de negócio nova ganha teste** (preço, prazo, desconto, estoque,
   quem pode ver ou alterar o quê).
4. Teste não se desliga nem se pula para "ficar verde". Se um teste falha, ou o
   código está errado ou a regra mudou de propósito, e aí o teste muda junto,
   com a explicação no PR.

O deploy segue a mesma regra: um push na `main` só publica o site se o job
`testes` passar (`.github/workflows/deploy-aws.yml`, `needs: testes`).

## Como rodar

```
npm ci                              # uma vez, instala o Playwright
npx playwright install chromium     # uma vez, baixa o navegador de teste
npm test                            # roda tudo
npm run test:rapido                 # só os testes puros (segundos)
```

`npm test` gera o site numa pasta `dist/` com chaves de mentira, sobe um
servidor local na porta 8099, roda os testes e derruba o servidor. Nenhum teste
fala com AWS, Firebase, InfinitePay, Google ou e-mail, e nenhum usa dado real
de cliente.

## Como ler o resultado

```
Testes puros (9)
  ok     test-estoque-custo.js  (0.0s)
  FALHA  test-prazo-entrega.js  (0.0s)
         | AssertionError: 3 dias tem que dizer "Retirada em 3 dias"
         | + 'Retirada em 2 dias'
         | - 'Retirada em 3 dias'

RESULTADO: 1 falha(s) em 14: test-prazo-entrega.js
```

- A linha `FALHA` diz **qual arquivo**.
- A frase depois de `AssertionError` diz **qual regra** foi quebrada.
- A linha com `+` é o que o sistema respondeu; a com `-` é o que deveria.
- `RESULTADO` no fim: se disser "passaram", pode enviar.

## Como escrever um teste novo

Crie `scripts/test-<assunto>.js`. Não precisa cadastrar em lugar nenhum: o
`npm test` acha sozinho todo arquivo que começa com `test-`.

```js
'use strict';
const assert = require('assert');
const { minhaRegra } = require('../functions/minha-funcao')._interno;

// Diga em português o que a regra garante: a frase aparece quando falhar.
assert.strictEqual(minhaRegra(100), 104, 'R$ 100 com a taxa vira R$ 104');

console.log('minha regra: todos passaram');
```

Padrão do projeto: Node puro com `assert`, sem framework e sem dependência
nova. Para o que depende de rede ou de relógio, o teste troca `fetch` por um
dublê e fixa a data (fuso America/Sao_Paulo). Depois de escrever, **quebre a
regra de propósito** no código, confirme que o teste falha, e desfaça: teste
que nunca falha não protege nada.

## Mapa de cobertura

Estado em 10/11/2026. "Não" é dívida conhecida, com o PR em que entra.

### Funções (`functions/`)

| Função | O que precisa estar travado | Tem teste? |
|---|---|---|
| `me.js` | dono do dado, campos permitidos, pontos | parcial: `test-me.js`, `test-me-browser.js` (falta o handler e os pontos) |
| `admin-data.js` | política por nó, caminho, papel admin | parcial: `test-dataclient.js` (falta o handler) |
| `lib/admin-auth.js` | assinatura, emissor, expiração, grupo admin | não — PR 6 |
| `infinitepay-webhook.js` | autenticidade, valor, repetição, estados | sim: `test-webhook-pagamento.js` |
| `create-payment.js`, `create-gift-payment.js` | valor vem do banco, não do cliente | não — PR 7 (junto do preço no servidor) |
| `upload-url.js`, `lib/s3.js` | tipo, tamanho, chave do objeto, só admin | não — PR 5 |
| `create-referral.js` | limite, auto-indicação, duplicidade | não — PR 5 |
| `booking-status.js` | código + e-mail | não — PR 5 |
| `notify-booking.js`, `notify-client.js`, `push-subscription.js` | quem pode disparar | não — PR 5 |
| `ai.js`, `lib/agents/*`, `lib/core/config.js` | quem chama, orçamento, tamanho da entrada | não — PR 5 |
| `calendar-sync.js` | assinatura do link, formato ICS | não — PR 6 |
| `reminder-check.js`, `birthday-check.js`, `admin-alerts.js` | data em Brasília, não repetir envio | não — PR 6 |
| `firebase-backup.js` | recusar backup vazio ou truncado | não — PR 6 |
| `drive-sync.js` + `scripts/drive-sync.gs` | segredo, tamanho, roteamento por nome | sim: `test-drive-sync.js`, `test-drive-sync-nomes.js` |
| `lib/feriados.js` | feriados e dia útil | não (o arquivo não é usado por ninguém; decisão pendente) |

### Site (`app.js`, `dataclient.js`, `cognito.js`)

| Fluxo ou regra | Tem teste? |
|---|---|
| Área Restrita como única porta do painel | sim: `test-porta-admin.js` |
| Separação cliente / admin na mesma página | sim: `test-cliente-browser.js` |
| Minha Conta pelo servidor | sim: `test-me-browser.js` |
| Roteamento de dados (direto ou pelo servidor) | sim: `test-dataclient.js` |
| Estoque: custo pela unidade de compra | sim: `test-estoque-custo.js`, `test-estoque-form.js` |
| Estoque: consumo pelas vendas e previsão de compra | sim: `test-estoque-consumo.js` |
| Serviço: custo vindo dos insumos | sim: `test-servico-insumos.js` |
| Prazo de entrega (frase ao cliente) | sim: `test-prazo-entrega.js` |
| Carrossel da página inicial | sim: `test-hero-carrossel.js` |
| Dados do cliente exibidos no painel sem virar código | sim: `test-painel-escape.js` (estático + navegador) |
| Agenda e disponibilidade, cupom, gift card, indicação | não — PR 7 |

### Infra e publicação

| Item | Tem teste? |
|---|---|
| Bucket sem acesso público, IAM sem `*`, região, serviços proibidos | sim: `test-infra-estatico.js` |
| Deploy depende dos testes e só publica da `main` | sim: `test-infra-estatico.js` |
| `terraform fmt` e `validate` | sim, no job `testes` do workflow |
| `npm audit` (alta ou crítica reprova) | sim, no job `testes` do workflow |
| `build.js` (versão dos assets) e `sw.js` (cache) | indireto (o build roda em todo `npm test`); teste próprio — PR 6 |

### Fora do `npm test`, de propósito

`scripts/test-giftcard-rules.sh` **escreve no banco de produção**. Só se roda à
mão, sabendo disso, ao publicar regras novas do banco.
