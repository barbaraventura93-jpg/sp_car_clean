# Infra — SP Car Clean na AWS

Terraform de toda a infraestrutura do site e do backend (região `sa-east-1`, certificado em `us-east-1`):

| Arquivo | O que cria |
|---|---|
| `main.tf` | **S3** (arquivos do site, privado), **CloudFront** (CDN + HTTPS, roteia `/api/*` para a API), registros **Route 53**, **OIDC do GitHub** (deploy sem chave estática) |
| `certificate.tf` | Certificado **ACM** para `spcarclean.com.br` e `*.spcarclean.com.br`, validado por DNS |
| `api.tf` | **Lambda** (uma por arquivo de `functions/`), **API Gateway HTTP API**, crons no **EventBridge Scheduler**, permissões |
| `push.tf` | Push do admin: chave **VAPID** (gerada aqui, guardada no SSM) e tabela **DynamoDB** dos aparelhos inscritos |
| `media.tf` | Bucket **S3 de mídia** (fotos/vídeos do painel), privado, versionado, com CORS só para o domínio; servido pelo CloudFront em `/media/*` |
| `versions.tf` | Providers e **backend S3** do estado |

```
visitante ──▶ CloudFront ──┬── /*                     ──▶ S3 (site)
                           ├── /media/*               ──▶ S3 (mídia)
                           ├── /api/*                 ──▶ API Gateway ──▶ Lambda (12 funções)
                           └── /.netlify/functions/*  ──▶ (legado, reescrito p/ /api/* — backlog L1)
EventBridge Scheduler ──(3 crons diários)──▶ Lambda
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

## Fotos e vídeos (mídia)

O painel pede um link de envio a `POST /api/media-upload` (só admin) e envia o arquivo direto ao
bucket de mídia; o endereço público fica em `https://spcarclean.com.br/media/...`.

Fotos antigas, ainda no Firebase Storage, são copiadas por um script que também troca os links no banco:

```bash
cd ~/sp_car_clean
node scripts/migrate-media.js            # simulação: lista o que seria migrado
node scripts/migrate-media.js --apply    # copia para o S3 e troca os links
```

Pode rodar de novo com segurança; o que falhar continua com o link antigo e é listado no fim.

## Crons

`ai-dispatcher` (08h), `birthday-check` (09h) e `reminder-check` (10h), horário de Brasília. Para pausar todos: `terraform apply -var schedules_enabled=false`.

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
- Estado do Terraform em bucket privado, versionado (90 dias de histórico), criptografado e só por HTTPS.
