# Infra — Fase 1 (Hospedagem estática na AWS)

Terraform que cria a hospedagem do site na AWS e a esteira de deploy:

- **S3** (bucket privado) — guarda os arquivos do site
- **CloudFront** — CDN + HTTPS (usa o certificado ACM)
- **Route 53** — registros do domínio apontando para o CloudFront (dormentes até o cutover)
- **GitHub OIDC** — Identity Provider + Role para o GitHub Actions publicar sem chave estática

> Esta fase **não mexe** no site atual (Netlify). O domínio só passa para a AWS no cutover (Bloco 7 do runbook), quando os nameservers forem trocados no Registro.br.

---

## Pré-requisitos

1. Hosted Zone criada no Route 53 (Bloco 3) ✅
2. Certificado ACM em **us-east-1** com status **Issued** (Bloco 4) — você precisa do **ARN**.

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

4. Crie o `terraform.tfvars` com o ARN do certificado:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   nano terraform.tfvars    # cole o ARN do certificado ACM (us-east-1) e salve
   ```

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
