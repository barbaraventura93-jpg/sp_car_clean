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
EventBridge Scheduler ──(4 crons diários)──▶ Lambda
Apps Script (conta do admin) ──(a cada 5 min, GET /api/calendar-sync)──▶ Google Agenda do admin
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

# Se o CloudShell tiver AWS_REGION de outro projeto (ex.: us-east-1), os comandos
# `aws` abaixo levam --region sa-east-1 de propósito; o Terraform já fixa a região.

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

> O cron `calendar-sync` (a cada 15 min) saiu do código quando a agenda do admin passou
> para o Apps Script. Enquanto ninguém rodar `terraform apply`, ele continua existindo e só
> responde "nada a fazer"; o próximo apply o remove (1 schedule destruído — esperado).

## Deploy do código

Cada merge na `main` roda `.github/workflows/deploy-aws.yml`: publica as **funções** (Lambda) e depois o **site** (S3 + invalidação do CloudFront).

- Uma função **nova** em `functions/` precisa entrar nas listas `http_functions` ou `scheduled_functions` de `api.tf` e ser aplicada **antes** do merge (senão o deploy falha de propósito).
- Secrets do GitHub usados pelo workflow: `AWS_ROLE_ARN`, `AWS_REGION`, `S3_BUCKET`, `CF_DISTRIBUTION_ID` (saídas do Terraform) e as chaves públicas do build `FIREBASE_API_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`.

## Segredos das funções (SSM Parameter Store)

Ficam em `/sp-car-clean/<NOME>`, criptografados, e as Lambdas carregam ao iniciar.

```bash
# Um valor
aws ssm put-parameter --region sa-east-1 --name /sp-car-clean/NOME --type SecureString --overwrite --value 'valor'
# Vários, a partir de um JSON {"NOME": "valor", ...}
bash scripts/aws-put-secrets.sh segredos.json && rm segredos.json
# Conferir os nomes gravados
aws ssm get-parameters-by-path --region sa-east-1 --path /sp-car-clean/ --query 'Parameters[].Name' --output text
```

Depois de mudar um segredo, as funções o leem quando reiniciam: no próximo deploy, ou rodando o workflow **Deploy to AWS** manualmente (aba Actions → Run workflow).

## Fotos e vídeos (mídia)

O painel pede um link de envio a `POST /api/upload-url` (só admin) e envia o arquivo direto ao
bucket de mídia; o endereço público fica em `https://spcarclean.com.br/media/...`.

Fotos antigas, ainda no Firebase Storage, são copiadas por um script que também troca os links no banco:

```bash
cd ~/sp_car_clean
node scripts/migrate-media.js            # simulação: lista o que seria migrado
node scripts/migrate-media.js --apply    # copia para o S3 e troca os links
```

Pode rodar de novo com segurança; o que falhar continua com o link antigo e é listado no fim.

## Crons

`admin-alerts` (07h30 — entregas dos próximos dias e estoque em falta, por push e Telegram),
`ai-dispatcher` (08h), `birthday-check` (09h) e `reminder-check` (10h), horário de Brasília.
A agenda do admin não usa cron na AWS: quem chama é o Apps Script, a cada 5 minutos. Para pausar todos:
`terraform apply -var schedules_enabled=false`.

```bash
aws scheduler list-schedules --region sa-east-1 --query 'Schedules[].[Name,State]' --output table
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
- WAF na borda (reputação de IP, explorações comuns e teto por IP) — ver "WAF e plano de tarifa fixa" abaixo.
- Estado do Terraform em bucket privado, versionado (90 dias de histórico), criptografado e só por HTTPS.

## WAF e plano de tarifa fixa

O site tem um AWS WAF (`infra/waf.tf`) associado ao CloudFront, com três regras:
reputação de IP da Amazon, explorações comuns (`CommonRuleSet`, sem inspecionar
`/api/*`) e um teto de 2.000 requisições por IP a cada 5 minutos.

Por que foi criado: entre 1 e 7/nov/2026 a distribuição saiu de ~390 para
~99.500 requisições/dia com **96,7% de respostas 4xx** — varredura de bot
sondando caminhos inexistentes. Nada caiu (5xx em 0%), mas não havia nenhum
filtro antes do CloudFront.

**O WAF só é gratuito dentro de um plano de tarifa fixa do CloudFront.** Avulso,
custa ~US$5/mês + ~US$1 por regra. Então a ordem importa:

```bash
# 1. Cria o WAF e associa à distribuição (enable_waf já vem true)
terraform apply

# 2. Pegue os dois ARNs
terraform output -raw cloudfront_distribution_arn
terraform output -raw waf_web_acl_arn

# 3. Assine o tier Free JÁ EM SEGUIDA (entre os passos 1 e 2 o WAF é cobrado)
aws pricing-plan-manager create-subscription --region us-east-1 \
  --plan-family CloudFront --plan-tier FREE \
  --resource-arns "<cloudfront_distribution_arn>" "<waf_web_acl_arn>"

# 4. Conferir
aws pricing-plan-manager list-subscriptions --region us-east-1
```

```bash
# 5. Anexar a zona do Route 53 ao plano, o que zera os US$0,50/mês dela.
#    A doc do CloudFront só cita o console (Manage Plan), mas a API resolve:
SARN=$(aws pricing-plan-manager list-subscriptions --region us-east-1 \
  --query 'subscriptionSummaries[0].arn' --output text)
ETAG=$(aws pricing-plan-manager list-subscriptions --region us-east-1 \
  --query 'subscriptionSummaries[0].eTag' --output text)
aws pricing-plan-manager associate-resources-to-subscription --region us-east-1 \
  --arn "$SARN" --if-match "$ETAG" \
  --resource-arns "arn:aws:route53:::hostedzone/<ID_DA_ZONA>"
```

O que o tier Free cobre, sem cobrança por excesso mesmo durante ataque: a
distribuição, o web ACL com até 5 regras, proteção DDoS sempre ativa,
transferência de dados, ingestão de logs do WAF no CloudWatch, certificado TLS,
CloudFront Functions, créditos de armazenamento no S3 e a zona do Route 53
anexada no passo 5.

Limites e armadilhas que valem saber:

- **O web ACL não pode ter condição customizada.** Um
  `scope_down_statement` (ou qualquer lógica própria de match) torna o web ACL
  inelegível e o `create-subscription` falha com
  `ValidationException: The following resources are not eligible for this
  subscription tier: <arn do web ACL>`. Isso aconteceu de verdade aqui: a
  primeira versão do `waf.tf` excluía `/api/*` da inspeção por `scope_down` e
  foi recusada. Para ajustar o comportamento de regras do grupo gerenciado use
  `rule_action_override` (ligar/desligar regra), que é suportado — é o que o
  `waf.tf` faz hoje com as 4 regras de inspeção de corpo.
- **5 cache behaviors no tier Free, e a distribuição usa exatamente 5.** Um
  caminho novo exige subir para o Pro (pago).
- **1 domínio apex por plano.** `spcarclean.com.br` + `www` contam como um.
- **Não dá para voltar `enable_waf` para false com o plano ativo** — a AWS
  recusa remover a associação. Cancele o plano primeiro
  (`aws pricing-plan-manager cancel-subscription --arn <arn> --if-match <eTag>`).
- **Ao cancelar o plano, apague o web ACL junto** se não for mais usá-lo, senão
  ele volta a custar ~US$5/mês em pay-as-you-go.
- **Desativar a distribuição não cancela o plano**: a cobrança continua.
- Regras pagas do WAF (Bot Control direcionado, ATP, ACFP, regras de parceiros
  e rule groups customizados) não são aceitas em plano. As gerenciadas
  gratuitas da AWS, sim.
- Logs de acesso padrão do CloudFront só entram do tier Pro para cima.

Se um dia a Central de IA ou o painel admin começarem a dar 403 sem motivo,
suspeite do `CommonRuleSet`: veja quais regras dispararam em CloudWatch
(métricas `common-rules` / `sp-car-clean-site`) e mova a regra específica para
`count` com um `rule_action_override` em `infra/waf.tf`.
