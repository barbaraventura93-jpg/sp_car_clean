# Checklist de Configuração — O que VOCÊ precisa fazer (passo a passo)

> **Para:** Bárbara
> **Objetivo:** Todas as configurações manuais (que exigem seu login/credenciais) para a migração à AWS.
> **Como usar:** faça na ordem. O que for de código/infra (Terraform, workflows, portar funções) **eu escrevo** — aqui está só o que **só você** pode fazer.
> **Legenda:** ⏱️ tempo estimado · 🔴 crítico p/ segurança · 💰 controle de custo

---

## BLOCO 1 — Criar e proteger a conta AWS ⏱️ ~30 min

### 1.1 Criar a conta
1. Acesse **https://portal.aws.amazon.com/billing/signup**
2. E-mail, nome da conta (ex.: `sp-car-clean`), e uma senha forte.
3. Tipo de conta: **Pessoal** (ou Empresarial, se for CNPJ).
4. Cadastre um **cartão de crédito** (a AWS cobra ~US$ 1 de verificação, estornado).
5. Verificação por telefone/SMS.
6. Escolha o plano de suporte **Basic (grátis)**.

### 1.2 🔴 Proteger a conta raiz (root)
1. Faça login como **root** (o e-mail que você cadastrou).
2. Canto superior direito → nome da conta → **Security credentials**.
3. Em **Multi-factor authentication (MFA)** → **Assign MFA device**.
4. Use um app autenticador (Google Authenticator, Authy) → escaneie o QR → confirme 2 códigos.
5. ⚠️ **Nunca use a conta root no dia a dia** depois disso.

### 1.3 🔴 Criar seu usuário administrativo (IAM Identity Center)
1. Busque **IAM Identity Center** no console → **Enable**.
2. **Users** → **Add user** → seu e-mail e nome.
3. **Permission sets** → crie um com a política **AdministratorAccess**.
4. Atribua o permission set ao seu usuário.
5. Você receberá um e-mail para definir senha + configurar MFA próprio.
6. A partir daqui, **use este usuário** (não o root).

---

## BLOCO 2 — 💰 Proteção de custo (faça ANTES de criar recursos) ⏱️ ~15 min

### 2.1 Criar um orçamento com alerta
1. Console → **Billing and Cost Management** → **Budgets** → **Create budget**.
2. Tipo: **Cost budget** → **Monthly**.
3. Valor: **US$ 30**.
4. Alertas de e-mail em: **50%**, **80%** e **100%** do orçamento → coloque seu e-mail.
5. Repita criando um segundo budget em **US$ 50** (alerta de teto máximo).

### 2.2 Ativar detecção de anomalias (grátis)
1. **Billing** → **Cost Anomaly Detection** → **Get started**.
2. Crie um monitor do tipo **AWS services** → notificação para seu e-mail.

### 2.3 Ligar o Cost Explorer
1. **Billing** → **Cost Explorer** → **Enable** (leva ~24h para popular dados).

> ✅ Com isso, se qualquer coisa começar a gerar custo inesperado, você recebe e-mail **antes** de virar uma conta alta.

---

## BLOCO 3 — Definir região e domínio ⏱️ ~20 min

### 3.1 Região
- Use sempre **South America (São Paulo) `sa-east-1`** no seletor de região (canto superior direito).
- ⚠️ **Única exceção:** ao criar o certificado TLS do CloudFront (Bloco 4), troque para **US East (N. Virginia) `us-east-1`** — é uma exigência da AWS. Depois volte para `sa-east-1`.

### 3.2 Route 53 (DNS)
1. Console → **Route 53** → **Hosted zones** → **Create hosted zone**.
2. Digite seu domínio (ex.: `spcarclean.com.br`) → **Public hosted zone** → **Create**.
3. A AWS vai gerar **4 nameservers** (tipo `ns-xxx.awsdns-xx.org`).
4. **Anote esses 4 nameservers** — você vai precisar deles no passo 3.3.
5. ⚠️ **NÃO** troque os nameservers no registrador ainda — só no cutover (Bloco 7). Trocar agora derruba o site atual.

### 3.3 Onde está seu domínio hoje?
- Me diga onde o domínio foi registrado (Registro.br, GoDaddy, Hostgator, etc.) — no cutover você vai lá trocar os nameservers pelos 4 da AWS.

---

## BLOCO 4 — Certificado HTTPS (ACM) ⏱️ ~15 min + espera

1. **Troque a região para `us-east-1`** (obrigatório para CloudFront).
2. Console → **Certificate Manager (ACM)** → **Request certificate** → **Public**.
3. Domínios: `spcarclean.com.br` **e** `*.spcarclean.com.br`.
4. Validação: **DNS validation**.
5. O ACM vai pedir para criar registros CNAME → como a zona já está no Route 53, clique em **Create records in Route 53** (automático).
6. Aguarde o status virar **Issued** (pode levar de minutos a algumas horas).
7. **Volte a região para `sa-east-1`.**

---

## BLOCO 5 — Conectar o GitHub à AWS (para o deploy automático) ⏱️ ~20 min

> Isso substitui o build do Netlify. Depois disso, cada merge builda no GitHub (grátis) e publica na AWS.

### 5.1 Criar a conexão segura (OIDC — sem chave estática)
1. Console → **IAM** → **Identity providers** → **Add provider**.
2. Tipo: **OpenID Connect**.
3. Provider URL: `https://token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com` → **Add provider**.

### 5.2 Criar a role que o GitHub vai assumir
- 🤖 **Eu te entrego a política exata** (JSON) e o passo a passo da role assim que começarmos a Fase 1 — ela precisa apontar para o seu repositório específico. Você só vai colar e criar.

### 5.3 Cadastrar os secrets no GitHub
No repositório → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
- `AWS_ROLE_ARN` — o ARN da role (eu te passo no 5.2)
- `AWS_REGION` — `sa-east-1`
- `CF_DISTRIBUTION_ID` — id do CloudFront (gerado na Fase 1)
- `S3_BUCKET` — nome do bucket (gerado na Fase 1)

---

## BLOCO 6 — Exports do Firebase (para migrar dados/auth/fotos) ⏱️ ~30 min

> Só na hora de cada fase — não precisa fazer agora. Reúna os acessos:

### 6.1 Realtime Database (Fase 3)
1. **Firebase Console** → **Realtime Database** → menu **⋮** → **Export JSON**.
2. Guarde o arquivo — 🤖 eu escrevo o script que transforma e carrega no DynamoDB.

### 6.2 Authentication (Fase 4)
1. Precisa da **Firebase CLI**: `firebase auth:export usuarios.json --project SEU_PROJETO`.
2. ⚠️ Usuários vão **redefinir a senha** no 1º login (o hash não é portável) — isso é normal e seguro.

### 6.3 Storage / fotos (Fase 5) — ✅ pronto para rodar
1. `terraform apply` (cria o bucket de mídia e a rota `/media/*`).
2. Rode `node scripts/migrate-media.js` (simulação) e depois `node scripts/migrate-media.js --apply`
   (variáveis e passo a passo no README → "Fotos e vídeos (S3)").
3. Conferido o site, `firebase deploy --only storage` (regras só leitura) e apague os arquivos do Storage.

---

## BLOCO 7 — Cutover final (só quando tudo estiver testado) ⏱️ ~1h + monitoramento

1. **DNS**: no registrador do domínio, troque os nameservers pelos **4 do Route 53** (Bloco 3.2).
2. **Webhooks**: atualize a URL nos provedores para as novas Lambdas:
   - **InfinitePay** → painel → webhooks → nova URL.
   - **WhatsApp Business** → configuração de webhook → nova URL.
3. Aguarde a propagação do DNS (até 24–48h) e monitore.
4. **Só depois de tudo estável:** desligar Netlify e Firebase.

---

## Segredos que você vai precisar ter em mãos (para eu configurar no Parameter Store)

Reúna estes valores (não cole aqui no chat — vamos colocá-los direto no AWS Parameter Store com segurança):
- Chave da **Claude API** (Anthropic)
- Token do **WhatsApp Business API**
- Token do **Telegram Bot**
- Chaves do **InfinitePay**
- Config do **EmailJS** (ou credenciais SES quando migrar)
- Chaves do **Firebase** (enquanto convivência dupla estiver ativa)

---

## Resumo: sua fila de tarefas

| Quando | Tarefa | Bloco |
|---|---|---|
| **Agora** | Criar conta AWS + MFA + usuário admin | 1 |
| **Agora** | Budgets US$ 30/50 + anomalias | 2 |
| **Agora** | Criar hosted zone no Route 53 (sem trocar DNS ainda) | 3 |
| **Agora** | Me dizer: onde o domínio está registrado + as decisões (IaC/IA/banco) | 3.3 |
| **Fase 1** | Certificado ACM + conexão OIDC + secrets do GitHub | 4, 5 |
| **Fases 3–5** | Exports do Firebase | 6 |
| **Fase 6** | Trocar DNS + webhooks, desligar antigos | 7 |

> 🤖 **O que eu faço em paralelo:** toda a IaC (Terraform), o workflow de deploy, a portabilidade das 13 funções, o modelo e script do DynamoDB, e os adaptadores de código. Você só executa os blocos acima.

---

*Checklist de configuração manual — companion de `aws-migration-runbook.md` e `aws-migration-cost-estimate.md`.*
