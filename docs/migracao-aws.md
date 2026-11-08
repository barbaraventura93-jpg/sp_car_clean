# Migração do Firebase para AWS (DynamoDB + Cognito)

> Status: **plano aprovado, Fase 0 não iniciada.** Documento vivo — cada fase
> concluída volta aqui com o que mudou e o que foi verificado.

## Por que

Em 08/11/2026 o acesso ao projeto Firebase do site foi perdido. O que foi
medido nesse dia:

- o banco continua servindo: `GET /services.json` devolve 200 com dado real, e
  o host resolve para IPs da Google;
- **o login está quebrado para todos.** No site publicado,
  `firebase.auth().signInWithEmailAndPassword` devolve
  `auth/api-key-not-valid.-please-pass-a-valid-api-key.` — a chave de API do
  projeto foi apagada ou desabilitada;
- o console não lista mais o projeto para a conta usada (o admin configurado no
  código é `spcarclean0@gmail.com`, outra conta Google);
- sem console não há como criar chave nova, exportar pelo painel nem **publicar
  regras** — a correção dos gift cards do PR #51 fica travada;
- o `FIREBASE_DATABASE_SECRET` (no SSM) ainda dá leitura e escrita totais,
  ignorando as regras. É o que mantém o site de pé e o que viabiliza esta
  migração.

Consequência prática: o site **vende** (visitante agenda, paga, o webhook
confirma), mas **não há gestão** — sem mexer em preço, serviço, estoque, agenda
ou gift card.

**Esta migração é o caminho que devolve o acesso sem depender da conta Google.**
O Cognito é criado nesta conta AWS; o usuário admin é criado por nós.

## Estado atual, medido

| | |
|---|---|
| Dados | 276 KB, 18 nós de primeiro nível |
| Agendamentos | 10 |
| Clientes com conta | 2 |
| Serviços / combos | 12 / 2 |
| Estoque / receitas | 20 / 9 |
| Portfólio / galeria | 11 / 5 |
| `blocked` | 12.150 datas |
| `app.js` | 8.757 linhas, 229 referências ao Firebase, **187 chamadas** de leitura/escrita, 24 de autenticação |
| Lambdas que usam o Firebase | **11 de 16** |
| Tráfego legítimo | ~390 requisições/dia |

### Custo da infraestrutura alvo

Preços da API de preços da AWS, região `sa-east-1`, 08/11/2026, aplicados ao
volume medido acima:

| Item | US$/mês |
|---|---|
| DynamoDB — leituras (140.400 RRU) | 0,0263 |
| DynamoDB — escritas (1.200 WRU) | 0,0011 |
| DynamoDB — armazenamento + PITR | 0,0002 |
| Cognito Lite (3 usuários) | 0,0165 |
| S3 — backup diário | 0,0005 |
| **Total** | **0,04** |

Com o negócio 50× maior: **US$ 2,21/mês**. Prova empírica na própria conta: o
Cognito custou **US$ 0,00 em todos os meses** de ago a nov/2026, com 8 usuários
em dois pools, e o DynamoDB entre US$ 0,0003 e 0,0004/mês.

**O custo não é a infraestrutura — é o trabalho.** Daí este plano em fases.

## Princípio de arquitetura

Hoje **o navegador fala direto com o banco**. É a raiz de todas as brechas
encontradas: o cliente grava o próprio preço, forja gift card, lê todos os
cupons e publica avaliação sem passar por ninguém.

No alvo, o navegador **nunca** toca o DynamoDB:

```
navegador → CloudFront → API Gateway → Lambda → DynamoDB
                                   ↑
                            Cognito (JWT)
```

Isso é deliberado e é metade do valor da migração: a regra de negócio passa a
viver no servidor, onde o cliente não alcança.

**A API é por intenção, não por tabela.** Uma API genérica de CRUD
(`GET/PATCH /{tabela}`) — como a usada no `Planejamento_Financeiro`, onde todo
dado é de uma única usuária — **recriaria exatamente as brechas atuais**, porque
o navegador voltaria a poder gravar qualquer campo de qualquer registro. Aqui a
maior parte do dado é compartilhada (catálogo, config, agenda), então cada
endpoint faz uma coisa e valida o que lhe cabe.

### Superfície da API

**Público, sem autenticação**

| Endpoint | Regra no servidor |
|---|---|
| `GET /api/catalog` | devolve serviços, combos, config **saneada**, portfólio, galeria e disponibilidade num payload só, cacheável. Nunca inclui cupom, gift card nem dado de cliente. |
| `POST /api/booking` | cria agendamento. **O preço é calculado aqui**, a partir do catálogo + porte do carro + combo + cupom + gift card. O valor que o navegador manda é ignorado. |
| `POST /api/booking/status` | consulta por código + e-mail (já existe hoje) |
| `POST /api/booking/self-service` | reagendar/cancelar com código + e-mail |
| `POST /api/coupon/quote` | valida o cupom e devolve **só o desconto**. Os códigos nunca chegam ao navegador. |
| `POST /api/giftcard/quote` | valida e devolve **só o saldo utilizável**. Não devolve dados do comprador. |
| `POST /api/giftcard/buy` | cria o cartão `pending` e o link de pagamento |
| `POST /api/feedback` | grava como `pending` — passa por moderação |
| `POST /api/waitlist` | entra na lista de espera |

**Cliente autenticado (Cognito)** — `GET /api/me/bookings`, `GET|PUT /api/me/profile`.

**Admin (grupo `admin` no Cognito)** — `/api/admin/*` para catálogo, config,
agenda bloqueada, estoque, gift cards, cupons, moderação de avaliação, clientes
e configuração dos agentes de IA.

### Brechas que a migração fecha

| Brecha de hoje | Como fica |
|---|---|
| Gift card forjável: `giftcards/$code` aceita escrita sem login | resgate só no servidor, com `ConditionExpression` — fecha a forja **e** o gasto duplo em corrida |
| Preço vem do navegador; o webhook confere o pago contra o preço que o próprio cliente gravou | preço calculado no servidor a partir do catálogo |
| `coupons` com `.read: true`: todos os códigos são públicos | códigos nunca saem do servidor |
| `feedback` aceita escrita anônima | moderação antes de publicar |
| `waitlist` aceita escrita anônima | rate-limit e validação |
| Admin definido por comparação de e-mail no JS do cliente | grupo do Cognito, verificado na Lambda |
| `config.adminPassword` em texto puro, leitura pública | **não é importado** |
| Quem tem o código do gift card lê nome, e-mail e telefone do comprador | o endpoint devolve só saldo e status |

## Modelo de dados

Tabela única `sp-car-clean-data`, `pk` + `sk`, sob demanda, PITR ligado.

| Firebase | `pk` | `sk` |
|---|---|---|
| `services/<slug>` | `CATALOG` | `SERVICE#<slug>` |
| `combos/<slug>` | `CATALOG` | `COMBO#<slug>` |
| `config/*` (campos planos) | `CATALOG` | `CONFIG` (um item só) |
| `portfolio/<id>` | `CATALOG` | `PORTFOLIO#<id>` |
| `gallery/<id>` | `CATALOG` | `GALLERY#<id>` |
| `blocked/<data>` | `AVAIL#<ano>` | `BLOCKED#<data>` |
| `dayLoad/<data>` | `AVAIL#<ano>` | `LOAD#<data>` |
| `bookings/<código>` | `BOOKING` | `<código>` |
| `bookingIndex/<uid>/<cód>` | `CLIENT#<sub>` | `BOOKING#<código>` |
| `clientProfiles/<uid>` | `CLIENT#<sub>` | `PROFILE` |
| `coupons/<código>` | `COUPON` | `<código>` |
| `giftcards/<código>` | `GIFTCARD` | `<código>` |
| `stock/<id>` | `STOCK` | `ITEM#<id>` |
| `stockRecipes/<serviço>` | `STOCK` | `RECIPE#<serviço>` |
| `feedback/<id>` | `FEEDBACK` | `<id>` |
| `waitlist/<id>` | `WAITLIST` | `<id>` |
| `aiConfig/<agente>` | `AI` | `CONFIG#<agente>` |
| `aiUsage/<mês>` | `AI` | `USAGE#<mês>` |
| `aiLogs/<id>` | `AI` | `LOG#<ts>#<id>` — com TTL de 90 dias |
| `aiRateLimit/<chave>` | `AI` | `RATE#<chave>` — com TTL |
| `adminPushTokens/<token>` | `ADMIN` | `PUSHTOKEN#<hash>` |
| `clientLinks/<email>` | `ADMIN` | `CLIENTLINK#<email>` |

Índices secundários:

- **GSI1 — agenda:** `gsi1pk = BOOKING#<YYYY-MM>`, `gsi1sk = <data>#<código>`.
  Responde "agendamentos do mês" sem varrer a tabela.
- **GSI2 — cliente por e-mail:** `gsi2pk = EMAIL#<email canônico>`,
  `gsi2sk = BOOKING#<data>`. É o que **preserva o histórico dos 2 clientes**
  quando eles se recadastrarem (ver Autenticação).

`blocked` é importado como está, para não mudar comportamento. Fica registrado
como melhoria futura: 2026 tem 105 datas bloqueadas (dias de folga reais), 2027
tem 325 e **de 2028 em diante todos os dias estão bloqueados** — um horizonte de
agendamento escrito como 12 mil registros. Trocar por uma regra de horizonte +
exceções explícitas resolveria, mas é mudança de comportamento e precisa de
decisão à parte.

## Autenticação

As senhas do Firebase Auth **não podem ser exportadas** sem acesso ao projeto.
Então:

- o **usuário admin é criado por nós** no Cognito, com senha temporária. É aqui
  que o acesso ao painel volta;
- os **2 clientes se recadastram**. O histórico deles **não é perdido**: o
  vínculo passa a ser pelo **e-mail canônico** (GSI2), não pelo `uid`. Ao se
  recadastrar com o mesmo e-mail, o cliente reencontra os agendamentos. Isso é
  melhor que o cenário de criar um projeto Firebase novo, onde o `uid` muda e o
  histórico ficaria órfão;
- admin deixa de ser "e-mail igual a uma string no JS" e passa a ser **grupo
  `admin` do Cognito**, verificado na Lambda.

## Fases

Cada fase termina com verificação e teste seu. Nada é cortado sem rollback.

### Fase 0 — Fundação · risco nulo

Tabela DynamoDB com os dois GSIs, pool Cognito, usuário admin, e o script de
importação dos 18 nós. **Nada em produção aponta para isso ainda** — o site
segue inteiramente no Firebase.

Verificação: item a item, contagem e checksum contra a cópia do Firebase.

### Fase 1 — API de leitura + painel admin · risco baixo

Endpoints de leitura e os de escrita do admin. O **painel admin passa a usar a
API nova**; o site público continua lendo o Firebase.

**Seu acesso ao painel volta nesta fase.** O risco é baixo porque o admin é um
usuário só e dá para testar cada tela antes de depender dela.

### Fase 2 — Escrita pública · risco médio

Criação de agendamento, cupom, gift card, avaliação e lista de espera — com
todas as regras no servidor. Durante uma janela, a escrita vai para os **dois**
bancos (DynamoDB e Firebase), para que um rollback não perca nada.

### Fase 3 — Leitura pública · risco médio

O site público passa a ler a API em vez do Firebase. As 187 chamadas não são
reescritas uma a uma espalhadas: elas passam a atravessar **um único módulo de
acesso a dados** que imita a interface que o `app.js` já usa. Assim a troca
acontece em um lugar, e o diff fica revisável.

### Fase 4 — Lambdas e corte · risco baixo

As 11 Lambdas passam para o DynamoDB. O SDK do Firebase sai do frontend. O
Firebase fica só-leitura por um período de segurança e depois é desligado.

## O que depende de você

- definir a senha do admin no Cognito no fim da Fase 0;
- testar cada tela do painel na Fase 1 antes de dependermos dela;
- avisar os 2 clientes para recadastrarem (um WhatsApp cada);
- decidir sobre o horizonte de agendamento (os 12 mil `blocked`).

## Rede de segurança já em pé

- backup manual completo de 08/11/2026, entregue;
- **backup automático diário** às 03h17 de Brasília para
  `s3://sp-car-clean-backups-<conta>/firebase/`, retenção 180 dias, bucket
  privado e criptografado (`functions/firebase-backup.js`, `infra/backup.tf`);
- o Firebase permanece intacto e servindo durante todas as fases.

## Decisões em aberto

1. **Horizonte de agendamento** — importar os 12.150 `blocked` como estão
   (padrão) ou trocar por regra de horizonte?
2. **Moderação de avaliação** — hoje qualquer um publica. Passa a exigir sua
   aprovação, ou aprovação automática com possibilidade de remover?
3. **Dados de IA** — `aiLogs` (154) e `aiUsage` entram na migração ou ficam só
   no backup? Sugestão: importar com TTL de 90 dias.
