# Runbook de Execução — Consolidação Total na AWS

> **Projeto:** SP Car Clean
> **Objetivo:** Migrar 100% da infraestrutura (site + funções + banco + auth + storage) para a AWS, eliminando o limite de build/merge do Netlify e consolidando a gestão em um único fornecedor.
> **Companion:** ver `docs/aws-migration-cost-estimate.md` para custos.
> **Data:** 2026-09-27

---

## Por que a migração resolve seu bloqueio

O travamento no Netlify é o **limite de 300 minutos de build/mês** do plano gratuito, **compartilhado entre todos os seus projetos**. Na arquitetura AWS proposta:

- O **build roda no GitHub Actions** (grátis: ilimitado em repositório público, 2.000 min/mês em privado) — **não há mais teto de merges**.
- A AWS cobra por **tráfego + armazenamento**, **não por deploy**. Deploy/merge passa a ser gratuito e ilimitado.
- Como seu tráfego e frequência de mudança são baixos, o custo fica em **~US$ 12–25/mês** (ver documento de custos).

---

## Divisão de responsabilidades

| Símbolo | Quem | O quê |
|---|---|---|
| 👤 **VOCÊ** | Bárbara | Ações que exigem login/credenciais: criar conta AWS, dar acesso a Firebase/Netlify, apontar DNS, aprovar gastos |
| 🤖 **EU** | Claude Code | Escrever IaC, workflows, portar funções, scripts de migração, testes |
| 🤝 **JUNTOS** | — | Passos que eu preparo e você executa/valida |

---

## Pré-requisitos (👤 VOCÊ, antes de tudo)

1. **Criar conta AWS** (ou usar existente) e ativar **MFA** na conta raiz.
2. Criar um **usuário IAM administrativo** (não usar a conta raiz no dia a dia).
3. Configurar **AWS Budgets** com alerta em **US$ 30 e US$ 50/mês** (proteção contra surpresa).
4. Ativar **Cost Anomaly Detection** (grátis).
5. Definir a **região**: `sa-east-1` (São Paulo) para dados/latência/LGPD.
   - ⚠️ Exceção: o certificado TLS do CloudFront **precisa** ficar em `us-east-1`.
6. Ter acesso de **export** ao Firebase (Realtime DB, Storage, Auth) e ao painel de DNS do domínio.

> Sem estes itens eu não consigo aplicar nada — mas **já posso escrever toda a IaC e o código** enquanto você prepara a conta.

---

## Decisões que preciso de você para gerar o código certo

Antes de eu escrever a Infraestrutura-como-Código, preciso destas escolhas (posso recomendar um padrão para cada):

| Decisão | Opções | Minha recomendação |
|---|---|---|
| **Ferramenta de IaC** | Terraform · AWS SAM · AWS CDK | **Terraform** (portável, você não fica presa à AWS) |
| **IA** | Manter Claude API · Migrar p/ Bedrock | **Manter Claude API** no início (menos mudança); Bedrock depois |
| **Push** | Manter FCM · Migrar p/ SNS | **Manter FCM** (grátis, já funciona) |
| **Banco** | DynamoDB · RDS | **DynamoDB on-demand** (encaixa no modelo atual, muito mais barato) |
| **Repos dos outros projetos** | — | Me diga quantos/quais são para reaproveitar a mesma esteira |

---

## FASE 0 — Fundação (baixo risco, reversível)

**Objetivo:** conta pronta, cobrança monitorada, DNS sob controle.

| Passo | Quem | Ação |
|---|---|---|
| 0.1 | 👤 | Criar conta AWS, IAM admin, MFA |
| 0.2 | 👤 | Criar AWS Budgets + alertas (US$ 30/50) |
| 0.3 | 🤖 | Escrever Terraform base (backend de estado em S3, provider, tags de custo `Project=sp-car-clean`) |
| 0.4 | 🤝 | Criar zona no **Route 53** e apontar os *nameservers* no registrador do domínio |
| 0.5 | 🤖 | Emitir certificado **ACM** (`us-east-1`) para o domínio |

**Validação:** `aws sts get-caller-identity` responde; budget aparece no console.
**Rollback:** nada em produção mudou; DNS antigo continua ativo até o cutover.

---

## FASE 1 — Hospedagem estática (baixo risco) ⭐ *destrava o limite de merges*

**Objetivo:** site no S3 + CloudFront, build no GitHub Actions. **Aqui o problema do Netlify some.**

| Passo | Quem | Ação |
|---|---|---|
| 1.1 | 🤖 | Terraform: bucket **S3** (site), **CloudFront** (OAC, HTTPS, SPA fallback), cache headers iguais ao `netlify.toml` |
| 1.2 | 🤖 | Workflow **GitHub Actions** `deploy-aws.yml`: `node build.js` → `aws s3 sync dist/` → `cloudfront create-invalidation` |
| 1.3 | 👤 | Cadastrar secrets no GitHub: `AWS_ROLE_ARN` (OIDC, sem chave estática), `CF_DISTRIBUTION_ID` |
| 1.4 | 🤝 | Rodar o workflow em `workflow_dispatch` e testar na URL do CloudFront |
| 1.5 | 🤖 | Migrar o `build.js` para injetar env vars via secrets do GitHub (hoje é o Netlify que injeta) |

**Validação:** site abre pela URL do CloudFront; um merge de teste dispara build no GitHub (não no Netlify).
**Rollback:** Netlify continua servindo o domínio até o cutover de DNS (Fase 6).

> ✅ Ao fim desta fase, **cada merge deste projeto deixa de consumir minutos do Netlify** — o bloqueio está resolvido mesmo antes de migrar o resto.

---

## FASE 2 — Backend serverless (risco médio)

**Objetivo:** as 13 Netlify Functions viram Lambdas atrás de API Gateway; os 3 crons viram EventBridge Scheduler.

| Passo | Quem | Ação |
|---|---|---|
| 2.1 | 🤖 | Adaptar o handler: assinatura Netlify (`event.body`/`queryStringParameters` → `{statusCode, body}`) para **API Gateway HTTP API (payload v2)** — muito parecido, mudança mecânica |
| 2.2 | 🤖 | Terraform: **Lambda** (uma por função) + **API Gateway HTTP API** + rotas |
| 2.3 | 🤖 | Migrar segredos (chaves Claude, WhatsApp, Telegram, InfinitePay) para **SSM Parameter Store** |
| 2.4 | 🤖 | `birthday-check`, `reminder-check`, `ai-dispatcher` → **EventBridge Scheduler** (mesmos horários do `netlify.toml`) |
| 2.5 | 🤖 | Ajustar o front (`app.js`) para chamar as novas URLs de API |
| 2.6 | 🤝 | Testar cada endpoint (concierge, orçamento, pagamento, webhooks) no ambiente novo |

**Validação:** cada função responde igual ao Netlify; webhooks de pagamento/WhatsApp chegam.
**Rollback:** front aponta de volta para as funções Netlify (variável de ambiente de base URL).

> ⚠️ Os **webhooks** (InfinitePay, WhatsApp) têm URL fixa cadastrada no provedor — trocar a URL lá é um passo manual seu (👤), coordenado no cutover.

---

## FASE 3 — Dados: Firebase RTDB → DynamoDB (⚠️ risco ALTO)

**Objetivo:** migrar o banco sem perder dados. **Fase mais delicada do projeto.**

| Passo | Quem | Ação |
|---|---|---|
| 3.1 | 🤖 | Desenhar o modelo **single-table** no DynamoDB a partir dos caminhos atuais (`/aiConfig`, `/aiUsage`, `/bookings`, `/clients`, etc.) |
| 3.2 | 🤖 | Reescrever `lib/core/firebase.js` como adaptador **DynamoDB** (`dbGet`/`dbSet`/`dbPatch` com a mesma interface — o resto do código não muda) |
| 3.3 | 🤖 | Script de migração: export do RTDB (JSON) → transformação → `BatchWriteItem` no DynamoDB |
| 3.4 | 🤝 | **Dupla escrita temporária**: gravar em Firebase E DynamoDB por alguns dias, comparando integridade |
| 3.5 | 👤 | Export final do Firebase e carga no DynamoDB na janela de cutover |
| 3.6 | 🤝 | Validar contagens e amostras (agendamentos, clientes, config de IA) antes de virar a chave |

**Validação:** contagem de registros bate; agendamentos e config de IA idênticos.
**Rollback:** enquanto a dupla escrita estiver ativa, o Firebase continua sendo a fonte de verdade.

---

## FASE 4 — Autenticação: Firebase Auth → Cognito (risco médio-alto)

**Objetivo:** login do painel admin no Cognito.

| Passo | Quem | Ação |
|---|---|---|
| 4.1 | 🤖 | Terraform: **Cognito User Pool** + app client |
| 4.2 | 👤 | Export dos usuários do Firebase Auth |
| 4.3 | 🤖 | Script de importação para o Cognito (usuários precisam **redefinir senha** no 1º acesso — limitação de segurança do hash) |
| 4.4 | 🤖 | Ajustar o front para autenticar via Cognito (Amplify Auth ou SDK) |
| 4.5 | 🤝 | Testar login/logout/recuperação de senha |

**Validação:** você consegue entrar no painel admin via Cognito.
**Rollback:** manter Firebase Auth ativo até confirmar o Cognito.

---

## FASE 5 — Complementos (risco baixo-médio)

| Passo | Quem | Ação |
|---|---|---|
| 5.1 | 🤖 | **EmailJS → Amazon SES**: reescrever `lib/core/email.js`; 👤 verificar domínio no SES e sair do *sandbox* |
| 5.2 | ✅ | **Storage → S3 (feito):** bucket de mídia `infra/media.tf` servido em `/media/*`; o painel envia direto ao S3 com URL pré-assinada (`functions/upload-url.js`); `scripts/migrate-media.js` copia os arquivos antigos e troca as URLs no RTDB; `storage.rules` fica só leitura até apagar o bucket. Passo a passo: README → "Fotos e vídeos (S3)" |
| 5.3 | ✅ | **FCM → Web Push padrão (feito):** push do admin e dos clientes sem Firebase (`infra/push.tf`, `functions/lib/webpush.js`) |
| 5.4 | 🤖 | (Opcional) Avaliar migração da IA para **Bedrock** |

**Validação:** e-mails saem pelo SES; fotos carregam do S3.

---

## FASE 6 — Cutover final (risco médio)

**Objetivo:** virar a chave e desligar o antigo.

| Passo | Quem | Ação |
|---|---|---|
| 6.1 | 🤝 | Apontar o **DNS** (Route 53) do domínio para o CloudFront |
| 6.2 | 👤 | Atualizar URL dos **webhooks** (InfinitePay, WhatsApp) para as novas Lambdas |
| 6.3 | 🤝 | Monitorar por 48–72h (CloudWatch, logs, alertas) |
| 6.4 | 👤 | Desligar Netlify e Firebase **só depois** de tudo estável |

**Validação:** site, agendamento, pagamento, IA e push funcionando 100% na AWS.
**Rollback:** reverter DNS e webhooks para o Netlify/Firebase (mantidos ativos até aqui).

---

## Ordem recomendada e ganho por fase

```
Fase 0 ──▶ Fase 1 ⭐ ──▶ Fase 2 ──▶ Fase 3 ⚠️ ──▶ Fase 4 ──▶ Fase 5 ──▶ Fase 6
 base     destrava      backend    dados        auth       extras     cutover
          o Netlify!    (médio)    (ALTO risco) (médio)    (baixo)    (médio)
```

- **Faça a Fase 1 primeiro** — é de baixo risco, reversível e **já resolve seu bloqueio de merges** sem depender do resto.
- A **Fase 3 (dados)** é onde mora o risco real — reserve tempo e teste com dupla escrita.

---

## O que eu posso começar a escrever JÁ (sem sua conta AWS pronta)

Assim que você me disser as decisões da tabela lá em cima (IaC, IA, banco), eu gero, nesta ordem:

1. **Fase 1 completa** — Terraform (S3 + CloudFront + ACM) + workflow `deploy-aws.yml` + ajuste do `build.js`.
2. **Fase 2** — adaptador de handler Lambda + Terraform das funções + EventBridge.
3. **Fase 3** — modelo DynamoDB + adaptador `dynamo.js` + script de migração.

Cada uma vira um PR próprio, testável e reversível.

---

## Próximos passos imediatos

1. 👤 Criar a conta AWS + Budgets (pré-requisitos acima).
2. 👤 Me responder as **decisões** (IaC / IA / banco) e quantos outros projetos entram na consolidação.
3. 🤖 Eu começo pela **Fase 1** (Terraform + GitHub Actions) — o pedaço que destrava seu Netlify.

---

*Runbook de execução — a migração exige suas credenciais e acessos (AWS, Firebase, DNS); o código e a IaC eu escrevo aqui, você aplica com os passos acima.*
