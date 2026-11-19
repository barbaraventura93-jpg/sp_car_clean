# sp_car_clean — Contexto para Claude Code

## Preferências de interação

- Falar sempre em português com a Bárbara.

## Convenções desta conta AWS

- **Região AWS padrão: `sa-east-1`.** É a região padrão de **todo projeto novo**
  desta conta e a deste projeto (`infra/variables.tf` → `aws_region` default
  `sa-east-1`; backend do state em `sa-east-1`). Ao criar recursos novos, use
  `sa-east-1` salvo motivo documentado.
  - O provider-alias `us-east-1` em `infra/versions.tf` **não** é exceção: é
    obrigatório só para o certificado ACM do CloudFront (que a AWS exige em
    `us-east-1`). Não "corrija" para `sa-east-1`.
  - Exceção na conta: o `Planejamento_Financeiro` roda inteiro em `us-east-1`
    de propósito (mais barata) — decisão documentada no repo dele.

## Credencial AWS expirada ou inválida — revalidar sem perguntar

Pedido da Bárbara (18/11/2026). Vale como autorização permanente.

Quando uma chamada à AWS falhar por credencial expirada ou inválida
(`ExpiredToken`, `InvalidClientTokenId`, "expired or invalid AWS credentials"):

1. **Não parar nem perguntar.** Gerar o link de login na hora:
   `aws login --remote` (precisa do AWS CLI 2.32.0 ou mais novo; se faltar,
   instalar o CLI v2 primeiro). O comando mostra uma URL e um código.
2. **Abrir o link para ela:** mostrar a URL e o código logo no início da
   resposta, e mandar notificação (PushNotification) se ela estiver longe.
   O login em si é dela: só ela entra com a conta, e Claude não digita senha.
   **Pedir que ela entre com o usuário `barbara-admin`, nunca com o root.**
   Login de root dispara e-mail de "conta acessada" e deixa a sessão com a
   chave mestra da conta (decisão de 18/11/2026, depois de um alerta assim).
3. **Revalidar sozinho:** esperar o `aws login` terminar e rodar
   `aws sts get-caller-identity`. Se der certo, retomar a tarefa de onde parou,
   sem pedir de novo.
4. **Se o erro vier da ferramenta MCP da AWS** (`aws___run_script`), o
   `aws login` do terminal não conserta: essa credencial vem do conector. Nesse
   caso, dizer a ela para reconectar o conector da AWS nas configurações de
   conectores do claude.ai e tentar de novo logo depois. Enquanto isso, seguir
   pelo CLI se ele estiver autenticado.

## Permissões da chave do ambiente (`github-actions-tracker`)

Desde 18/11/2026 a chave do ambiente **só lê o IAM** (`IAMReadOnlyAccess`).
Ela não cria papel, política nem chave, e não se dá permissão nova.

- Mudança de IAM (inclusive `terraform apply` que mexe em `aws_iam_*`) é feita
  com o login do `barbara-admin` via `aws login`, com ela ciente do que muda.
- Não devolver `IAMFullAccess` à chave nem criar política "temporária" nela.
- O deploy não usa essa chave: entra pelo papel OIDC `sp-car-clean-github-deploy`.

## Testes — regra do projeto

- Toda mudança roda `npm test` antes do push. O deploy na `main` só publica se
  o job `testes` passar.
- Todo bug corrigido ganha teste de regressão (falha antes, passa depois).
- Toda regra de negócio nova ganha teste.
- Não pular nem desativar teste para ficar verde. Não usar `--no-verify`.
- Padrão: Node + `assert` em `scripts/test-*.js`, sem rede, sem dado real de
  cliente, sem dependência nova. Como rodar, escrever e ler: `docs/testes.md`.

## AWS Agent Toolkit — regras da experiência nova

> **help_level salvo: HIGH (Alta)** — ao construir na AWS, explicar cada passo antes
> de executar, sugerir alternativas quando houver abordagem melhor, e apontar boas
> práticas e trade-offs; ainda assim executar a escolha da usuária.

<!-- BEGIN AWS Agent Toolkit rules -->
# AWS Guidance for the new AWS experience

This user has signed up for the new AWS experience. This experience lets you sign into AWS using a social provider and requires the following additional context.

Where this guidance conflicts with the project's own instructions, the project's instructions take precedence.

## Context

### Terminology:

- Say "project" instead of "account" — a project contains an AWS account and settings for sharing with other collaborators
- Say "team member" instead of "IAM user" — users are invited by email, not created or federated in IAM
- Say "AWS Settings" when referring to management tasks at [settings.aws.com](https://settings.aws.com/) (project management, billing, team members, spend limits). Users view their actual AWS resources in the AWS Management Console.
- Say "selected Region" when referring to the user's Region — not "home Region"
- The user has a managed IAM experience. This includes a managed service control policies (SCP) and resource control policies (RCP) that govern the use of AWS. They will still need to use IAM to create policies to let services work with each other. If there are questions about the SCPs or RCPs, go to the documentation at https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html

### Constraints:

- All projects share a single AWS Region determined by the user's contact address. Resources cannot be created in other Regions
- When developing:
  - MUST create all Regional resources in the project's assigned Region
  - You CAN create AWS WAF and Cloudwatch Logs resources in us-east-1 when there are global resources (like a global WAF instance) that require a connection to dependencies in us-east-1. You should not use these for any other reason, because resources in the selected Region will provide lower cost (due to no cross-Region traffic), increased availability (due to no cross-Region traffic), and easier manageability (due to not needing to look in another Region). When you need to do an inventory of resources, you need to look in both the selected Region and us-east-1 for Cloudwatch Logs or WAF resources.
  - MUST NOT attempt to create Lambda, API Gateway, or other Regional resources in any other Region
  - MUST direct users to confirm their Region in AWS Settings > View all projects > Overview > Additional Info > Region. If the user cannot confirm their Region, check in ~/.aws/config
  - MUST NOT use Lambda@Edge — excluded from both Lambda and CloudFront
  - MUST NOT use CloudFormation StackSets — no multi-account or multi-Region deployments
  - MUST NOT attempt cross-Region actions — no cross-Region replication for DynamoDB/S3/RDS, no multi-Region KMS keys
  - MUST NOT use Route 53 cross-Region routing — geolocation, latency-based, and failover routing policies are not available
  - CloudFront is a global service and its actions ARE allowed in `us-east-1`. A user can create a CloudFront distribution pointing to their project-region Lambda function URL or API Gateway. However, Lambda and API Gateway themselves MUST NOT be created in `us-east-1` — they must be in the project Region.
  - Reduced availability in `eu-north-1` specifically: Amazon Rekognition, Amazon Textract, Amazon Personalize, AWS App Runner are not available in that Region.
- IAM permissions for human access are managed by AWS. Don't assign roles to team members unless absolutely necessary
- The user may have a spend limit if they are on the paid plan. The limit that pauses their project if it's exceeded. If resources suddenly become inaccessible, ask if they have a spend limit configured. Only project owners can modify a spend limit.
- When developing:
  - MUST ask about spend limit status if the user reports sudden "Access Denied" errors on operations that previously worked
  - MUST direct users to check spend status in AWS Settings > Billing
  - MUST check if a user has upgraded their account to the paid plan
  - MUST ask the user if they want to clean up the successfully created resources or keep them to reduce cost
- The user sets up billing, creates spend limits, and retrieves and pays invoices in AWS Settings. The user creates budgets and optimizes their costs in the AWS Billing and Cost Management console
- Not all AWS services are available. If a service isn't working, do the following:
  1. Run the command `aws freetier get-account-plan-state`
  2. If accountPlanType": "FREE", check the [Free Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-free-tier) next,
  3. If accountPlanType": "PAID", check the [Paid Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-paid-plan).
  4. If neither list shows the service, check the [Not supported for this experience list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#unsupported-services). The user will need to activate advanced features to access this service.
- Users can activate advanced AWS services and capabilities for their account.
- For any AWS task or question — building, configuring, migrating, debugging, or operating a service, writing SDK code, authoring CDK/CloudFormation, or answering how a service works — first call `aws___search_documentation` with topic `agent_skills` and load the matching skill with `aws___retrieve_skill`. Do this even when you believe you know the answer: skills carry current service behavior that your training may not. Prefer the skill's guidance over general knowledge. Skip it only for work that does not involve AWS.

### Help level

- help_level (required): LOW, MEDIUM, or HIGH. **Saved for this user: HIGH.**

Constraints for each level:

**LOW:**

- MUST follow all constraints in this context file
- MUST execute the user’s request without modification
- MUST NOT ask clarifying questions unless the action would create a security vulnerability
- MUST NOT suggest alternatives or improvements

**MEDIUM:**

- MUST execute the user's request
- MAY ask up to two clarifying questions per task if the request has an ambiguity or a potential issue
- MUST NOT repeat a question or suggestion the user has already dismissed
- MUST NOT explain trade-offs or alternatives unless the user asks

**HIGH:**

- MUST explain what each step does and why before executing it
- MUST suggest alternatives when a better approach exists
- MUST flag best practices and explain trade-offs
- MUST still execute the user's choice if they disagree with a suggestion
<!-- END AWS Agent Toolkit rules -->
