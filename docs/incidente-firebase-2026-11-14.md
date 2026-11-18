# Incidente: banco Firebase inacessível desde 10/11/2026

> Registro feito em 14/11/2026, a partir dos logs do CloudWatch e de testes
> diretos nos endpoints.
>
> **CORRIGIDO EM 16/11/2026 — a premissa deste documento estava errada.** Eu o
> escrevi como quem investiga um projeto apagado sem aviso, e cheguei a
> recomendar procurar a conta Google dona e recuperar o projeto dentro dos 30
> dias. Nada disso se aplica: a Bárbara **excluiu o Firebase de propósito**, e
> foi por isso que pediu a migração para a AWS. O que o diagnóstico abaixo
> acerta é o efeito (o que quebrou, quando e por quê); o que ele erra é a
> causa e, por consequência, o plano de ação. O plano certo é terminar a
> migração — ver `docs/migracao-aws.md` e a seção "O caminho de volta" no fim
> deste arquivo.

## O que está acontecendo

O Realtime Database `sp-car-clean-default-rtdb` **não responde mais**. Toda
requisição devolve HTTP 404 com a mensagem do Firebase *"Please ensure that you
have the URL of your Firebase Realtime Database instance configured correctly"* —
que é a resposta para instância que não existe, não para segredo errado (esse
daria 401) nem para regra que proíbe (daria 401/403).

A chave web pública do projeto (`AIza…`, que está no site em produção e
funcionava) agora devolve **"API key not valid"** no Identity Toolkit. Chave de
API morre junto com o projeto que a emitiu.

## Quando começou

| Data | Evidência |
|---|---|
| 09/11 06:17 UTC | último backup **bem-sucedido** (20 nós, 286 KB) |
| 09/11 11:01 UTC | última execução de agentes: 3 rodaram (relatório semanal entre eles) |
| **10/11 06:17 UTC** | `firebase-backup: Firebase respondeu HTTP 404` — e todo dia desde então |
| 10/11 11:00 UTC | `ai-dispatcher: 0 agente(s) executado(s)` — e todo dia desde então |

A janela em que o banco morreu é entre **09/11 11:01** e **10/11 06:17 UTC**.

## O que quebrou e o que não quebrou

**Funciona:** o site abre (HTML/CSS/JS no S3+CloudFront), mostra o carrossel (as
7 fotos estáticas) e a tabela de preços (valores padrão do `app.js`, não do
banco). Nada disso prova que o sistema está de pé — é tudo estático.

**Não funciona:**

- **Consultar agendamento** devolve `{"ok":false}` para qualquer código. Por
  desenho, a resposta de "não encontrado" é idêntica à de código inválido
  (anti-enumeração), então o cliente vê *"não encontrado"* e não um erro — o que
  esconde a falha.
- **Novo agendamento** não pode ser gravado.
- **Login de cliente** (Firebase Auth) está fora.
- **Agentes de IA**: nenhum roda desde 10/11. O relatório semanal saiu pela
  última vez em 09/11.
- **Backup diário**: o último é de 09/11.

### Por que os agentes somem em silêncio

`config.getAgentConfig()` lê `/aiConfig/<agente>` com `try/catch` que devolve
`null` no erro, e o despachante trata `null` como desligado:
`if (!cfg?.enabled || !cfg.schedule) continue;` — sem log, sem alerta. Com o
banco em 404, todos os 11 agentes são pulados sem deixar rastro além do
`0 agente(s) executado(s)`.

**Isto não é o defeito dos DEFAULTS** (corrigido no PR #67): o backup de 09/11
mostra os 11 agentes com `enabled: true` e nenhum `disabledReason`. O PR #67
melhora o comportamento, mas **não ressuscita os agentes** — eles voltam só
quando o banco voltar.

## O backup existe e está íntegro

`s3://sp-car-clean-backups-442042534458/firebase/2026/11/09/firebase-2026-11-09T06-17-18-353Z.json.gz`

Verificado em 14/11: gzip íntegro, JSON válido, 20 nós —
`bookings` 14, `services` 13, `stock` 20, `stockRecipes` 9, `portfolio` 8,
`gallery` 5, `clientProfiles` 2, `coupons` 2, `combos` 2, `config` 5,
`aiConfig` 11, `aiUsage` 5, `aiLogs` 156, `blocked` 12130, e os demais.

**Perda possível:** só o que foi escrito entre 09/11 06:17 e a morte do banco —
no máximo um dia. Depois disso nada foi gravado, porque não havia onde gravar.

## O caminho de volta: terminar a migração

O Firebase não volta, e não precisa. O que ficou faltando da migração era
justamente a camada de dados — o site e as funções já estavam na AWS, e o login
já era Cognito.

**Feito em 16/11/2026:**

1. **Os dados estão na AWS.** O backup de 09/11 foi importado para a tabela
   `sp-car-clean-data` do DynamoDB: 12.396 itens, conferidos nó por nó contra o
   backup (`scripts/importar-para-dynamodb.js`, com `--conferir`).
2. **O mapeamento virou código** em `functions/lib/core/chaves.js`, usado tanto
   pelo importador quanto pelas Lambdas — uma fonte só, para não existir chave
   gravada num formato e lida em outro.
3. **O acesso a dados** (`functions/lib/core/store.js`) tem a mesma interface do
   antigo `core/firebase.js`, então cada Lambda troca uma linha de `require`.
4. **O painel** já aponta para o DynamoDB (`admin-data`), e o `dataclient.js`
   deixou de mandar leitura de nó público direto ao Firebase — era o que
   quebrava a aba Serviços enquanto o resto do painel respondia.

5. **A permissão das funções na tabela foi aplicada** em 16/11, com
   `terraform apply` direcionado (`aws_iam_role_policy.lambda_data`).
   Conferido pelo simulador de políticas do IAM: as 7 operações de dados
   liberadas na tabela e nos dois índices, `DeleteTable` e `UpdateTable`
   negadas. **Era o bloqueio do painel.**

**Falta, na ordem:**

1. **O resto do `terraform apply`** — e ele tem de vir ANTES do merge:

   | O que falta | Por quê |
   |---|---|
   | função `unsubscribe` + grupo de logs | falta `logs:CreateLogGroup` à chave de desenvolvimento |
   | rota `/api/unsubscribe` | falta `apigatewayv2:*` |
   | variável `DATA_TABLE` nas 19 funções | o grupo de logs acima é dependência e falha primeiro |

   **Mesclar antes disso quebra o deploy**: o workflow publica código para cada
   arquivo em `functions/`, e `sp-car-clean-unsubscribe` não existe como função
   — é a trava que o próprio `deploy-aws.yml` descreve. Com o deploy falhando,
   nem o frontend sobe.

   A variável `DATA_TABLE` não é urgente: o `store.js` usa
   `process.env.DATA_TABLE || 'sp-car-clean-data'`, justamente porque esta
   ordem (código antes da variável) já aconteceu antes neste projeto.

   **Como rodar:** `scripts/aws-apply.sh`, do AWS CloudShell. Ele baixa o
   Terraform, lê o `admin_emails` **do próprio grupo `admin` do Cognito** — em
   vez de pedir que alguém digite, porque a lista errada faz o Terraform apagar
   e recriar as contas admin — mostra o plano e só aplica depois de confirmação.
2. ~~As Lambdas que falam HTTP direto com o Firebase~~ — **feito em 16/11.**
   Todas as 19; `lib/core/firebase.js` foi removido.
3. ~~`firebase-backup`~~ — **feito.** Exporta do DynamoDB no mesmo formato que o
   importador consome, e o teste fecha o ciclo passando a exportação pelo
   importador.
4. ~~Endpoint público de dados~~ — **feito, e sem rota nova.** O
   `/api/admin-data` ganhou um nível anônimo, autorizado por
   `lib/core/regras-publicas.js` (porte fiel das regras antigas do Realtime
   Database). O SDK do Firebase saiu do frontend.

**O login dos clientes não se perdeu:** o pool do Cognito tem as 3 contas, e o
histórico delas é reencontrado pelo e-mail canônico (GSI2), não pelo uid antigo
do Firebase.

## Buracos que este incidente expôs

- **Nada avisou.** Quatro dias de banco fora, backup falhando todo dia, e o
  único sinal foi um log. `admin-alerts` roda de manhã, mas também lê o banco:
  com o banco fora, ele não tem o que comparar e não grita. Um alerta que
  dependa do próprio banco não serve para avisar que o banco caiu.
- **Falha silenciosa por desenho.** Tanto `booking-status` (anti-enumeração)
  quanto `getAgentConfig` (`catch → null`) transformam erro de infraestrutura em
  "não encontrado"/"desligado". É seguro para o cliente e cego para a dona.
- **Ponto único de falha confirmado — e agora resolvido.** O acesso aos dados
  dependia de um segredo no SSM e de uma conta Google que ninguém sabia qual
  era. Os dados agora estão numa tabela da própria conta AWS, com PITR de 35
  dias.
- **O que ninguém verificou antes de excluir:** que a migração tinha levado só
  o site, as funções e o login — não o banco. Uma lista do que cada serviço
  ainda atende, conferida antes de desligar, teria evitado os seis dias de
  parada.
