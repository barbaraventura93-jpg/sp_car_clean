# Infra — SP Car Clean na AWS

Terraform de toda a infraestrutura do site e do backend (região `sa-east-1`, certificado em `us-east-1`):

| Arquivo | O que cria |
|---|---|
| `main.tf` | **S3** (arquivos do site, privado), **CloudFront** (CDN + HTTPS, roteia `/api/*` para a API e `/media/*` para o bucket de mídia), registros **Route 53**, **OIDC do GitHub** (deploy sem chave estática) |
| `certificate.tf` | Certificado **ACM** para `spcarclean.com.br` e `*.spcarclean.com.br`, validado por DNS |
| `api.tf` | **Lambda** (uma por arquivo de `functions/`), **API Gateway HTTP API**, crons no **EventBridge Scheduler**, permissões |
| `media.tf` | **S3 de mídia** (substitui o Firebase Storage): fotos/vídeos da galeria e fotos do check-in, privado, servido pelo CloudFront em `/media/*`; CORS para o upload direto do painel |
| `push.tf` | Push do admin e dos clientes: chave **VAPID** (gerada aqui, guardada no SSM) e tabela **DynamoDB** dos aparelhos inscritos |
| `versions.tf` | Providers e **backend S3** do estado |

```
visitante ──▶ CloudFront ──┬── /*                     ──▶ S3 (site)
                           ├── /media/*               ──▶ S3 (mídia: fotos e vídeos)
                           ├── /api/*                 ──▶ API Gateway ──▶ Lambda (15 funções)
                           └── /.netlify/functions/*  ──▶ (legado, reescrito p/ /api/* — backlog L1)
painel admin ──(PUT com URL pré-assinada pela função upload-url)──▶ S3 (mídia)
EventBridge Scheduler ──(4 crons diários + calendar-sync a cada 15 min)──▶ Lambda
Lambda calendar-sync ──▶ Google Calendar API (agenda do admin)
Lambda ──(na inicialização)──▶ SSM Parameter Store /sp-car-clean/* (segredos)
Estado do Terraform ──▶ S3 sp-car-clean-tfstate-<conta> (versionado, com trava)
```

---

## Preparar o CloudShell

No console AWS (região **sa-east-1**), abra o **CloudShell** (ícone `>_`).

```bash
# Terraform (o CloudShell perde pacotes instalados fora da pasta home; repita se sumir)
terraform -version || (sudo yum install -y yum-utils \
  && sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo \
  && sudo yum install -y terraform)

# Repositório
[ -d ~/sp_car_clean ] || git clone https://github.com/barbaraventura93-jpg/sp_car_clean.git ~/sp_car_clean
cd ~/sp_car_clean && git checkout main && git pull

# Estado do Terraform no S3 (cria o bucket se preciso, gera infra/backend.hcl e roda o init)
bash scripts/aws-bootstrap-tfstate.sh
```

Na **primeira vez**, o script move o estado que estava no disco do CloudShell para o S3 (e guarda uma cópia em `~/tfstate-backup-<data>`). Nas próximas, ele só recria o `backend.hcl` e roda o `terraform init`: o estado fica no S3 e não se perde se o CloudShell for apagado.

## Aplicar mudanças

```bash
cd ~/sp_car_clean && git pull
cd infra
terraform plan     # confira o que vai mudar
terraform apply    # digite "yes"
```

Mudanças no CloudFront levam ~5–10 min para propagar.

> **Esta versão (apps + S3 + Google Agenda) precisa de `terraform apply` antes do
> merge**: ela cria o bucket de mídia, a rota `/media/*` e as funções novas
> (`upload-url`, `notify-client`, `calendar-sync`, `admin-alerts`). Sem o apply, o
> passo "Publicar funções" do deploy falha (de propósito) e o upload de fotos do painel
> fica sem destino.

## Deploy do código

Cada merge na `main` roda `.github/workflows/deploy-aws.yml`: publica as **funções** (Lambda) e depois o **site** (S3 + invalidação do CloudFront).

- Uma função **nova** em `functions/` precisa entrar nas listas `http_functions` ou `scheduled_functions` de `api.tf` e ser aplicada **antes** do merge (senão o deploy falha de propósito).
- Secrets do GitHub usados pelo workflow: `AWS_ROLE_ARN`, `AWS_REGION`, `S3_BUCKET`, `CF_DISTRIBUTION_ID` (saídas do Terraform) e as chaves públicas do build `FIREBASE_API_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`.

## Segredos das funções (SSM Parameter Store)

Ficam em `/sp-car-clean/<NOME>`, criptografados, e as Lambdas carregam ao iniciar.

```bash
# Um valor
aws ssm put-parameter --name /sp-car-clean/NOME --type SecureString --overwrite --value 'valor'
# Vários, a partir de um JSON {"NOME": "valor", ...}
bash scripts/aws-put-secrets.sh segredos.json && rm segredos.json
# Conferir os nomes gravados
aws ssm get-parameters-by-path --path /sp-car-clean/ --query 'Parameters[].Name' --output text
```

Depois de mudar um segredo, as funções o leem quando reiniciam: no próximo deploy, ou rodando o workflow **Deploy to AWS** manualmente (aba Actions → Run workflow).

## Crons

`admin-alerts` (07h30 — entregas dos próximos dias e estoque em falta, por push e Telegram),
`ai-dispatcher` (08h), `birthday-check` (09h) e `reminder-check` (10h), horário de Brasília,
e `calendar-sync` a cada 15 minutos (Google Agenda). Para pausar todos:
`terraform apply -var schedules_enabled=false`.

```bash
aws scheduler list-schedules --query 'Schedules[].[Name,State]' --output table
```

## Diagnóstico

```bash
# A API deve responder JSON 400 ("code e email são obrigatórios"), não HTML:
curl -sS -i -X POST https://spcarclean.com.br/api/booking-status -H 'Content-Type: application/json' -d '{}'
```

Logs: CloudWatch → Log groups → `/aws/lambda/sp-car-clean-<função>` (retenção de 14 dias).

## Segurança embutida

- O endpoint direto do API Gateway recusa requisições que não vêm do CloudFront (cabeçalho secreto `x-origin-verify`).
- O IP usado no rate-limit vem da borda do CloudFront (`x-viewer-ip`), não de um cabeçalho que o cliente possa forjar.
- Throttling da API (25 req/s, rajada 50) como teto de custo.
- Bucket de mídia sem listagem: só o CloudFront lê (`/media/*`) e só a função `upload-url` (com login de admin) gera URL de envio. Fotos de check-in têm nome aleatório (a URL não é adivinhável).
- Estado do Terraform em bucket privado, versionado (90 dias de histórico), criptografado e só por HTTPS.
