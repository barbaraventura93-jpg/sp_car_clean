# Infra — Hospedagem e backend na AWS

Terraform que cria o site e o backend na AWS e a esteira de deploy:

- **S3** (bucket privado) — guarda os arquivos do site
- **CloudFront** — CDN + HTTPS; serve o site e roteia `/api/*` para a API
- **Route 53** — registros do domínio apontando para o CloudFront
- **GitHub OIDC** — Role para o GitHub Actions publicar site e funções sem chave estática
- **Fase 2 (`api.tf`)** — as funções de `netlify/functions` em **AWS Lambda**, atrás de um **API Gateway (HTTP API)**, com segredos no **SSM Parameter Store** e crons no **EventBridge Scheduler**

```
visitante ──▶ CloudFront ──┬── /*                     ──▶ S3 (site)
                           ├── /api/*                 ──▶ API Gateway ──▶ Lambda (11 funções)
                           └── /.netlify/functions/*  ──▶ (reescrito p/ /api/*)
EventBridge Scheduler ──(3 crons diários)──▶ Lambda
Lambda ──(na inicialização)──▶ SSM Parameter Store /sp-car-clean/* (segredos)
```

---

## Fase 2 — Backend no Lambda (passo a passo)

> **Ordem importa:** segredos → Terraform → teste → merge. Aplicar o Terraform já conserta a produção (o CloudFront passa a atender `/.netlify/functions/*` com as Lambdas), mesmo antes do merge.

### 1. Segredos: Netlify → SSM Parameter Store
No **CloudShell** (região `sa-east-1`), dentro do clone do repositório:

```bash
cd ~/sp_car_clean && git fetch origin && git checkout claude/laughing-mendel-2gx8nx && git pull
npx netlify-cli login                       # abre um link para autorizar
npx netlify-cli link                        # escolha o site sp-car-clean
npx netlify-cli env:list --context production --json > netlify-env.json
bash scripts/aws-put-secrets.sh netlify-env.json
rm netlify-env.json
```

- **Espaço:** o `netlify-cli` é grande; se o CloudShell (1 GB) reclamar, rode os três comandos `netlify-cli` no seu computador e envie o `netlify-env.json` pelo menu **Actions → Upload file** do CloudShell.
- **Variáveis "secretas" do Netlify** não saem no export (vêm vazias ou mascaradas). Grave-as à mão:
  `aws ssm put-parameter --name /sp-car-clean/NOME --type SecureString --overwrite --value 'valor'`

Confira: `aws ssm get-parameters-by-path --path /sp-car-clean/ --query 'Parameters[].Name'`
(ANTHROPIC_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_DATABASE_SECRET, TELEGRAM_*, INFINITEPAY_*, EMAILJS_*, FCM_SERVICE_ACCOUNT…).

### 2. Aplicar o Terraform
```bash
cd ~/sp_car_clean/infra
terraform init -upgrade      # baixa os providers novos (archive, random)
terraform plan               # esperado: Lambdas, API, crons e mudanças no CloudFront
terraform apply
```
O CloudFront leva ~5–10 min para propagar a mudança.

### 3. Testar em produção
```bash
# Deve responder JSON 400 ("code e email são obrigatórios"), não HTML:
curl -s -X POST https://spcarclean.com.br/api/booking-status -H 'Content-Type: application/json' -d '{}'
# Caminho legado também:
curl -s -X POST https://spcarclean.com.br/.netlify/functions/booking-status -H 'Content-Type: application/json' -d '{}'
```
Depois, no site: um agendamento de teste, o concierge de IA e o painel admin.
Logs: CloudWatch → Log groups → `/aws/lambda/sp-car-clean-<função>`.

### 4. Merge do PR
A partir daí, cada merge na `main` publica **funções e site** (`deploy-aws.yml`). Uma função nova em `netlify/functions/` precisa ser adicionada em `api.tf` (listas `http_functions`/`scheduled_functions`) e aplicada **antes** do merge.

### 5. Crons na AWS (troca sem envio em dobro)
Os 3 crons (`ai-dispatcher` 08h, `birthday-check` 09h, `reminder-check` 10h — horário de Brasília) saíram do `netlify.toml` e ficam ligados por padrão na AWS (`schedules_enabled = true`). A ordem importa: se os dois lados rodarem no mesmo dia, o e-mail de aniversário e os agentes de IA saem em dobro.
1. Merge na `main` → o Netlify publica sem os crons. Confira em **Netlify → Deploys** que o último deploy está **Published**.
2. Só então, no CloudShell: `git checkout main && git pull && cd infra && terraform apply` (liga os 3 agendamentos e remove a função `whatsapp-webhook`, que saiu junto com as integrações da Meta).
3. Conferir: `aws scheduler list-schedules --query 'Schedules[].[Name,State]' --output table`.

Faça os passos 1 e 2 antes das 08h (horário de Brasília) para não pular nenhum dia. Logs de cada execução: `/aws/lambda/sp-car-clean-<cron>` no CloudWatch.

### 6. Desligar o Netlify (quando tudo estiver estável)
1. **InfinitePay:** nada a fazer — a URL de retorno é gerada a cada pagamento a partir do domínio.
2. Desativar o site no Netlify.

### Segurança embutida
- O endpoint direto do API Gateway recusa requisições que não vêm do CloudFront (cabeçalho secreto `x-origin-verify`).
- O IP usado no rate-limit vem da borda do CloudFront (`x-viewer-ip`), não de um cabeçalho que o cliente possa forjar.
- Throttling da API (25 req/s, rajada 50) como teto de custo; logs com retenção de 14 dias.

---

# Fase 1 — Hospedagem estática (referência)

---

## Pré-requisitos

1. Hosted Zone criada no Route 53 (Bloco 3) ✅
2. Certificado HTTPS: **não precisa criar à mão** — `certificate.tf` emite e valida no ACM (us-east-1) um certificado para `spcarclean.com.br` **e** `*.spcarclean.com.br` (um curinga sozinho não cobre o domínio raiz).

---

## Como aplicar (pelo AWS CloudShell — sem instalar nada)

1. No console AWS (região **sa-east-1**), abra o **CloudShell** (ícone `>_` no topo).

2. Instale o Terraform (uma vez):
   ```bash
   sudo yum install -y yum-utils
   sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo
   sudo yum install -y terraform
   terraform -version
   ```

3. Traga o repositório e entre na pasta da infra:
   ```bash
   git clone https://github.com/barbaraventura93-jpg/sp_car_clean.git
   cd sp_car_clean/infra
   ```

4. (Opcional) `terraform.tfvars` só é necessário para mudar algum padrão — veja `terraform.tfvars.example`.

5. Rode:
   ```bash
   terraform init
   terraform plan      # confira o que vai ser criado
   terraform apply     # digite "yes" para confirmar
   ```
   > O CloudFront leva ~10–15 min para ficar pronto (status "Deployed").

6. Ao final, o Terraform imprime os **valores dos Secrets do GitHub**. Copie-os.

---

## Depois do apply

### 1. Configurar os Secrets no GitHub
Repositório → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Valor |
|---|---|
| `AWS_ROLE_ARN` | (saída do Terraform) |
| `AWS_REGION` | `sa-east-1` |
| `S3_BUCKET` | (saída do Terraform) |
| `CF_DISTRIBUTION_ID` | (saída do Terraform) |
| `FIREBASE_API_KEY` | sua chave pública do Firebase Web |
| `FIREBASE_VAPID_KEY` | sua chave VAPID (Web Push) |
| `EMAILJS_SERVICE_ID` | seu service id do EmailJS |
| `EMAILJS_PUBLIC_KEY` | sua public key do EmailJS |

### 2. Publicar o site
GitHub → aba **Actions** → workflow **"Deploy to AWS (S3 + CloudFront)"** → **Run workflow**.

### 3. Testar
Abra a **URL do CloudFront** (saída `cloudfront_domain`, algo como `dxxxx.cloudfront.net`) e confira o site. O domínio `spcarclean.com.br` ainda continua no Netlify até o cutover.

### 4. Ativar deploy automático (opcional)
Em `.github/workflows/deploy-aws.yml`, descomente o bloco `push:` para publicar a cada merge na `main`. **A partir daí, o limite de builds do Netlify deixa de importar para este site.**

---

## Cutover (só quando tudo estiver testado — Bloco 7)

1. No **Registro.br**, troque os nameservers do Netlify (`*.nsone.net`) pelos **4 do Route 53**.
2. Aguarde a propagação (até 24–48h).
3. O site passa a ser servido pela AWS. Depois é só desligar o Netlify.

---

## Observações

- **Estado do Terraform:** este setup usa estado **local** (arquivo `terraform.tfstate` no CloudShell). Para uso em equipe, dá para migrar para um backend S3 depois. Para um projeto solo, o local já serve — só não apague a pasta.
- **Custo desta fase:** ~US$ 1–5/mês (S3 + CloudFront), fora das camadas gratuitas. Sem custo de build.
