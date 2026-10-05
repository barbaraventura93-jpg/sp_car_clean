# Planejamento e Estimativa de Custos — Migração da Infraestrutura para AWS

> **Projeto:** SP Car Clean — Estética Automotiva Premium
> **Documento:** Planejamento de migração + estimativa de custo mensal
> **Data:** 2026-09-27
> **Status:** Proposta para decisão

---

## 1. Sumário executivo

A infraestrutura atual do SP Car Clean é **100% serverless/gerenciada** (Netlify + Firebase + Claude API) e, no porte atual (um negócio local de estética automotiva em SP), roda **muito próximo das camadas gratuitas** — o custo real hoje provavelmente está entre **US$ 0 e US$ 50/mês**.

**A conclusão honesta é:** migrar para AWS **não vai reduzir custo** neste porte. O valor de migrar está em **outros ganhos**, não em economia:

- **Consolidação** — tudo em um único fornecedor e uma única fatura.
- **Residência de dados no Brasil** (região `sa-east-1`, São Paulo) — relevante para **LGPD**.
- **Headroom de escala** — se o negócio crescer para múltiplas unidades/franquia.
- **Integração com Bedrock** — rodar IA (inclusive Claude) dentro da própria AWS.

Se a migração for feita com **arquitetura serverless-nativa** (S3 + CloudFront + Lambda + DynamoDB + Cognito), a fatura AWS fica em torno de:

| Cenário | Custo AWS/mês (aprox.) | Custo AWS/mês em R$* |
|---|---|---|
| **Baixo** (enxuto, dentro das free tiers) | **US$ 5 – 10** | R$ 27 – 55 |
| **Esperado** (negócio ativo) | **US$ 12 – 25** | R$ 66 – 138 |
| **Alto** (crescimento + WAF + segurança reforçada) | **US$ 40 – 90** | R$ 220 – 495 |

\* Câmbio de referência **R$ 5,50/US$** — atualize conforme o dia. Valores **excluem** a Claude API e serviços externos (pagamentos/WhatsApp), que não mudam com a migração.

> ⚠️ **Armadilha a evitar:** se a migração for feita com arquitetura "tradicional" (RDS Multi-AZ + NAT Gateway + Fargate/EC2), o custo pula para **US$ 120 – 250/mês** sem entregar mais valor neste porte. **Não recomendado.**

---

## 2. Inventário da infraestrutura atual

| Camada | Serviço atual | Função no sistema |
|---|---|---|
| Hospedagem front | **Netlify** (site estático `dist/`) | PWA público + painel admin |
| Funções backend | **Netlify Functions** (~13) | IA, pagamentos, webhooks, notificações |
| Funções agendadas | Netlify Scheduled (3 crons) | `birthday-check`, `reminder-check`, `ai-dispatcher` |
| Banco de dados | **Firebase Realtime Database** | Agendamentos, clientes, config de IA, uso |
| Armazenamento | **Firebase Storage** → migrado para **S3** (`infra/media.tf`) | Fotos (check-in, portfólio, orçamento) |
| Autenticação | **Firebase Auth** | Acesso ao painel administrativo |
| Notificações push | **Firebase Cloud Messaging (FCM)** | Push de agendamento/lembrete |
| Inteligência artificial | **Claude API (Anthropic)** | 13 agentes (concierge, orçamento, upsell…) |
| E-mail | **EmailJS** | Confirmações e reativação de clientes |
| Pagamentos | **InfinitePay** (externo) | Cobranças e webhook |
| Mensageria | **WhatsApp Business / Telegram** (externos) | Alertas e atendimento |

**Escala estimada (porte atual):** tráfego baixo (milhares de visitas/mês), armazenamento de fotos na casa de poucos a ~10 GB, e teto de **~1.650 chamadas de IA/mês** definido em `config.js`.

---

## 3. Mapa de-para: Atual → AWS

| Componente atual | Equivalente AWS recomendado | Observação |
|---|---|---|
| Netlify (hosting estático) | **S3 + CloudFront** | Site estático + CDN global |
| Netlify Functions | **AWS Lambda + API Gateway (HTTP API)** | Mantém o modelo serverless |
| Netlify Scheduled Functions | **EventBridge Scheduler → Lambda** | Os 3 crons diários |
| Firebase Realtime Database | **DynamoDB** (on-demand) | NoSQL, encaixa no modelo atual |
| Firebase Storage | **S3** ✅ feito | Bucket de mídia servido pelo CloudFront em `/media/*` |
| Firebase Auth | **Amazon Cognito** | Login do painel admin |
| Firebase Cloud Messaging | **Web Push padrão** ✅ feito | VAPID + DynamoDB, sem Firebase nem SNS (admin e clientes) |
| EmailJS | **Amazon SES** | E-mail transacional |
| Claude API | **Manter Claude API** *ou* **Amazon Bedrock** | Bedrock roda Claude dentro da AWS |
| InfinitePay / WhatsApp / Telegram | **Inalterados** (externos) | Continuam via API |
| Segredos (chaves de API) | **SSM Parameter Store** (grátis) *ou* **Secrets Manager** | Parameter Store evita custo |
| DNS | **Route 53** | Zona hospedada |
| Observabilidade | **CloudWatch** (logs + alarmes) | Monitoramento |

---

## 4. Arquitetura AWS proposta (serverless-nativa)

```
                          ┌─────────────────┐
   Usuário/PWA  ─────────▶│   CloudFront     │  (CDN, TLS, cache)
                          └───────┬─────────┘
                                  │
                    ┌─────────────┴──────────────┐
                    ▼                             ▼
            ┌──────────────┐            ┌──────────────────┐
            │  S3 (site)   │            │  API Gateway     │
            │  estático    │            │  (HTTP API)      │
            └──────────────┘            └────────┬─────────┘
                                                 ▼
                                        ┌──────────────────┐
   EventBridge Scheduler ──(3 crons)──▶ │   AWS Lambda     │
                                        │  (13 funções)    │
                                        └───┬───┬───┬──────┘
                                            │   │   │
                    ┌───────────────────────┘   │   └───────────────┐
                    ▼                            ▼                   ▼
            ┌──────────────┐            ┌──────────────┐    ┌──────────────┐
            │  DynamoDB    │            │  S3 (fotos)  │    │  SES / FCM   │
            │  (dados)     │            │              │    │  Claude API  │
            └──────────────┘            └──────────────┘    └──────────────┘

   Auth: Cognito   │   Segredos: Parameter Store   │   Logs: CloudWatch
```

**Princípio-chave:** manter as Lambdas **fora de VPC** (sem NAT Gateway) e usar **serviços 100% gerenciados/on-demand**. Isso é o que mantém a fatura baixa.

---

## 5. Estimativa de custos mensais (detalhada)

> Preços aproximados para a região **`sa-east-1` (São Paulo)**, que é ~25–50% mais cara que `us-east-1`. **Sempre confirmar no [AWS Pricing Calculator](https://calculator.aws)** antes de decidir.

### Cenário **Esperado** (negócio ativo, porte atual)

| Serviço | Dimensionamento assumido | Custo/mês (US$) |
|---|---|---|
| **S3** (site + fotos) | ~10 GB armazenados | 0,60 |
| **CloudFront** (CDN) | ~30 GB egress (1 TB grátis/mês perpétuo) | 0 – 1,50 |
| **Lambda** (compute) | ~150k invocações, baixa memória (dentro da free tier) | 0 – 0,50 |
| **API Gateway** (HTTP API) | ~150k requisições | 0,20 – 0,40 |
| **DynamoDB** (on-demand) | <1 GB, ~700k operações | 1,50 – 3,00 |
| **Cognito** | Poucos usuários admin (dentro da free tier) | 0 |
| **SES** (e-mail) | Poucos milhares de e-mails | 0,20 – 0,50 |
| **Push** (manter FCM) | — | 0 |
| **EventBridge Scheduler** | 3 crons diários (~90/mês) | 0 |
| **CloudWatch** (logs/alarmes) | Logs + alguns alarmes | 2,00 – 4,00 |
| **Route 53** (DNS) | 1 zona + consultas | 0,50 – 1,00 |
| **Parameter Store** (segredos) | Standard tier | 0 |
| **Transferência de dados diversa** | — | ~1,00 |
| **Subtotal AWS** | | **≈ US$ 12 – 25/mês** |

### Comparativo dos três cenários

| Serviço | Baixo (US$) | Esperado (US$) | Alto (US$) |
|---|---|---|---|
| S3 | 0,30 | 0,60 | 3,00 |
| CloudFront | 0 | 1,00 | 8,00 |
| Lambda | 0 | 0,50 | 4,00 |
| API Gateway | 0,10 | 0,30 | 2,50 |
| DynamoDB | 1,00 | 2,50 | 12,00 |
| Cognito | 0 | 0 | 5,00 |
| SES | 0,10 | 0,30 | 2,00 |
| CloudWatch | 1,00 | 3,00 | 10,00 |
| Route 53 | 0,50 | 0,90 | 1,00 |
| Secrets Manager | 0 (Param Store) | 0 (Param Store) | 4,00 |
| WAF (segurança) | 0 | 0 | 8,00 |
| Transferência/diversos | 0,50 | 1,00 | 5,00 |
| Bedrock (se substituir Claude API) | opcional | opcional | opcional |
| **Total AWS** | **≈ US$ 5 – 10** | **≈ US$ 12 – 25** | **≈ US$ 40 – 90** |
| **Em R$ (× 5,50)** | **R$ 27 – 55** | **R$ 66 – 138** | **R$ 220 – 495** |

### Custos separados (não mudam com a migração)

| Item | Custo/mês estimado | Observação |
|---|---|---|
| **Claude API (Anthropic)** | US$ 5 – 30 | ~1.650 chamadas/mês; ou migrar p/ Bedrock (preço similar por token) |
| **InfinitePay** | % por transação | Externo, inalterado |
| **WhatsApp Business API** | Por conversa | Externo, inalterado |
| **Telegram** | Grátis | Externo, inalterado |

---

## 6. Armadilhas de custo AWS (evitar)

Estas são as fontes clássicas de "conta surpresa" na AWS — todas evitáveis nesta arquitetura:

| Armadilha | Impacto | Como evitar |
|---|---|---|
| **NAT Gateway** | ~US$ 32/mês + tráfego | Manter Lambdas **fora de VPC** |
| **RDS Multi-AZ** | US$ 25 – 60/mês (mínimo) | Usar **DynamoDB on-demand**, não RDS |
| **Fargate / EC2 ligado 24/7** | US$ 15 – 100+/mês | Ficar em **Lambda** (paga só o uso) |
| **CloudWatch Logs sem retenção** | Cresce indefinidamente | Definir **retenção de 14–30 dias** |
| **Egress de dados** | US$ 0,11–0,15/GB em sa-east-1 | Aproveitar **1 TB grátis do CloudFront** |
| **REST API Gateway** | US$ 3,50/milhão | Usar **HTTP API** (US$ 1,00–1,11/milhão) |
| **Secrets Manager** para tudo | US$ 0,40/segredo/mês | Usar **Parameter Store** (grátis) |
| **Região errada** | us-east-1 é mais barata, mas… | `sa-east-1` para **latência BR + LGPD** |

**Proteções recomendadas desde o dia 1:**
- **AWS Budgets** com alerta em US$ 30 e US$ 50/mês.
- **Billing alarm** no CloudWatch.
- **Cost Anomaly Detection** (grátis).
- Tags de custo por serviço (`Project=sp-car-clean`).

---

## 7. Ficar vs. Migrar — a decisão

| Critério | Manter (Netlify + Firebase) | Migrar (AWS serverless) |
|---|---|---|
| **Custo mensal** | ✅ Menor (~US$ 0 – 50) | ⚠️ Similar ou maior (~US$ 12 – 25+) |
| **Complexidade operacional** | ✅ Baixa | ⚠️ Média (mais serviços p/ configurar) |
| **Residência de dados (LGPD)** | ⚠️ EUA por padrão | ✅ Brasil (`sa-east-1`) |
| **Fornecedor único / 1 fatura** | ❌ Múltiplos | ✅ Consolidado |
| **Headroom p/ escalar (franquia)** | ⚠️ Ok, mas fragmentado | ✅ Excelente |
| **IA dentro da infra** | ❌ API externa | ✅ Bedrock disponível |
| **Curva de aprendizado** | ✅ Já dominada | ⚠️ Requer conhecimento AWS |

**Recomendação:** migrar **somente se** um destes for prioridade — LGPD/dados no Brasil, consolidação de fornecedor, ou preparação para escala (franquia/multi-unidade). **Se o objetivo for economizar, o melhor é permanecer no stack atual.**

---

## 8. Plano de migração faseado

Migração incremental, sem downtime, de menor para maior risco:

| Fase | Escopo | Risco | Esforço |
|---|---|---|---|
| **0 — Preparação** | Conta AWS, IAM, Budgets/alertas, Route 53, tags de custo | Baixo | 1–2 dias |
| **1 — Estáticos** | Site → S3 + CloudFront; fotos → S3 | Baixo | 2–3 dias |
| **2 — Backend** | Netlify Functions → Lambda + API Gateway; crons → EventBridge | Médio | 1 semana |
| **3 — Dados** | Firebase RTDB → DynamoDB (migração + dupla escrita temporária) | **Alto** | 1–2 semanas |
| **4 — Auth** | Firebase Auth → Cognito (migração de usuários) | Médio-alto | 3–5 dias |
| **5 — Complementos** | EmailJS → SES; avaliar Bedrock; ~~push (FCM)~~ e ~~Storage~~ ✅ feitos (Web Push + S3) | Baixo-médio | 3–5 dias |
| **6 — Cutover** | DNS final, desligar Netlify/Firebase, validação | Médio | 1–2 dias |

**Ponto crítico:** a **Fase 3 (migração de dados)** é a mais delicada — exige janela de dupla escrita e validação de integridade antes do cutover. É onde mora o maior risco do projeto.

---

## 9. Premissas e como validar

Esta estimativa assume:

1. **Porte atual mantido** — tráfego baixo, ~1.650 chamadas de IA/mês, poucos GB de fotos.
2. **Arquitetura serverless-nativa** — sem VPC/NAT/RDS/Fargate.
3. **Região `sa-east-1`** (São Paulo).
4. **Câmbio R$ 5,50/US$** — atualizar conforme o dia.
5. **Free tiers perpétuas aproveitadas** (CloudFront 1 TB, Lambda 1M req, etc.).
6. Claude API, pagamentos e mensageria **permanecem externos**.

**Antes de decidir, validar com dados reais:**
- 📊 Puxar o **consumo real atual** de Firebase (uso de RTDB, Storage, leituras/gravações) e Netlify (invocações de função, banda).
- 🧮 Rodar o **[AWS Pricing Calculator](https://calculator.aws)** com esses números.
- 💳 Conferir o valor **hoje pago** em Netlify + Firebase para comparação justa.
- 📈 Definir a **projeção de crescimento** (uma unidade? franquia?) — isso muda tudo.

---

## 10. Próximos passos sugeridos

1. **Levantar os números reais** de consumo atual (Firebase + Netlify) — sem isso, a estimativa é uma faixa, não um valor fechado.
2. **Definir o objetivo da migração** (custo? LGPD? consolidação? escala?) — a resposta decide se vale a pena.
3. Se seguir: começar pela **Fase 0 + Fase 1** (baixo risco, reversível) como piloto.
4. Rodar o piloto por ~30 dias e **comparar a fatura real** antes de migrar dados/auth.

---

*Documento de planejamento — os valores são estimativas de faixa e devem ser confirmados no AWS Pricing Calculator com os números reais de consumo.*
