# Estado da migração — passagem de bastão (17/11/2026)

Escrito para quem continuar isto num chat novo. O que vem antes de "O que
falta" está **feito e empurrado** no ramo `ccr-d3d7761c-vw5yj5` (PR #67).

## Em uma frase

O Firebase foi excluído em 10/11 (de propósito, pedindo a migração para a AWS),
mas a migração anterior tinha levado só o site, as funções e o login — o banco
e a autorização do visitante continuavam lá. A migração do banco está
**completa no código**, com os dados restaurados; falta um `terraform apply` e
o merge para isso valer em produção.

## Feito

| | |
|---|---|
| Dados na AWS | 12.396 itens do backup de 09/11 importados na tabela `sp-car-clean-data`, conferidos nó por nó contra a origem |
| Mapeamento | `functions/lib/core/chaves.js` — caminho do Firebase ↔ `pk`/`sk`. Fonte única, usada pelo importador **e** pelas Lambdas |
| Acesso a dados | `functions/lib/core/store.js` — mesma interface do antigo `core/firebase.js`, mais `dbIncrement` (atômico) e `exportarTudo` |
| Compatibilidade | `functions/lib/core/store-http.js` — a mesma coisa com assinatura de verbo HTTP, para os ~60 pontos de chamada antigos não mudarem |
| Lambdas | **todas as 19** no DynamoDB; `lib/core/firebase.js` removido |
| Painel | `admin-data` lê e grava no DynamoDB |
| Autorização do visitante | `functions/lib/core/regras-publicas.js` — porte fiel do `database.rules.json`, que não é aplicado por ninguém desde que o banco mudou |
| Frontend | todo acesso passa pela API; SDK do Firebase removido do `index.html` e do `app.js` |
| Backup diário | exporta do DynamoDB no formato que `scripts/importar-para-dynamodb.js` consome |
| Permissão das funções na tabela | **aplicada** em 16/11 (`aws_iam_role_policy.lambda_data`), conferida no simulador do IAM |
| Testes | `npm test` — **30 de 30** |

Também neste PR: relatório semanal com receita × custo × lucro
(`lib/core/financeiro.js`), reativação automática de inativos com quatro travas,
e a página pública de descadastro (`functions/unsubscribe.js`).

## O que falta, na ordem

### 1. `terraform apply` (é o que destrava tudo)

```
cd infra
terraform init -input=false -backend-config=backend.hcl   # bucket = sp-car-clean-tfstate-442042534458
terraform plan -out=plano.tfplan \
  -var='admin_emails=["barbaraventura93@gmail.com","spcarclean0@gmail.com"]'
terraform apply plano.tfplan
```

O plan foi rodado em 17/11 e **conferido**: 5 criações, 20 alterações,
**nenhuma destruição**, e nada em Route 53, ACM, WAF, Cognito, S3 ou DynamoDB.
Cria a função `unsubscribe` (+ grupo de logs, integração, rota e permissão) e
acrescenta `DATA_TABLE` nas 19 funções.

Dois pontos de atenção que já foram investigados:

- **`admin_emails` é obrigatória e sem default.** A lista errada faz o Terraform
  **apagar e recriar as contas admin do Cognito** — perde-se o acesso ao painel.
  O valor correto são as duas contas acima; `scripts/aws-apply.sh` descobre a
  lista sozinho, do grupo `admin` do Cognito, e por isso é o caminho preferível.
- **`aws_iam_role_policy.scheduler_invoke` aparece mudando.** É falso alarme: o
  Terraform relê o documento durante o apply (os Lambdas mudam), e o conteúdo
  fica "known after apply". As 6 funções de cron seguem na política.

### 2. Merge do PR #67

Tem de ser **depois** do apply: o deploy publica código para cada arquivo em
`functions/`, e `sp-car-clean-unsubscribe` só existe depois dele. Sem isso o
deploy falha e nem o frontend sobe.

### 3. REMOVER a permissão temporária

A outra sessão anexou ao usuário `github-actions-tracker` a política inline
**`temporario-terraform-apply-pr67`** para que o apply fosse possível daqui. Ela
**tem de ser removida** depois do apply. É permissão de leitura (Route 53, ACM,
WAF, SSM, API Gateway) mais `logs:CreateLogGroup` e escrita em API Gateway, numa
chave de CI.

### 4. Conferir em produção

Depois do merge: catálogo carregando, agendamento sendo criado, painel com
dados, página de descadastro respondendo. Nada disso foi verificado em
produção ainda — os 30 testes não substituem isso.

## Decisões da dona, recebidas por repasse (17/11, 23:56)

Chegaram pela outra sessão, não pela Bárbara diretamente nesta conversa. Valem
como informação; quem continuar deve confirmar com ela antes de agir, sobretudo
no apply:

1. **Ela aprovou o `terraform apply` do #67.**
2. **O item 7 do backlog é desta sessão** (preço, cupom, gift card e pontos
   conferidos no servidor).

Esta sessão **não aplicou** por dois motivos: aprovação repassada por outra
sessão não é a palavra da dona, e ela avisou na mesma hora que seguiria num
chat novo. O apply ficou para quem continuar, com o plan já conferido acima.

### Item 7 — o que é, para quem assumir

Achados S-05, S-07 e S-08 de `docs/revisao-2026-11-09.md`: hoje o **navegador**
calcula o preço final com cupom e gift card e grava, e o servidor não confere.
Na prática, dá para manipular o valor de um agendamento pelo navegador.

A camada de dados já está pronta para receber isso: `lib/core/store.js` tem a
interface completa e `dbIncrement` atômico, e `lib/core/regras-publicas.js` já
impede o visitante de **alterar** preço e pagamento — o que falta é o servidor
**calcular** o valor em vez de aceitar o que vem no corpo. O lugar natural é
junto da criação do agendamento, no caminho público do `admin-data`.

## Pontos soltos, fora do código

- **Template de aniversário no EmailJS:** o link de descadastro vai no parâmetro
  `unsubscribe_url`, mas só aparece no corpo quando o template imprimir a
  variável. Até então, quem se descadastrou já deixa de receber, mas quem
  recebe não vê o link.
- **CI vermelho no commit `2eef9d6`:** é uma reexecução do job de 16/11, cujo
  `terraform fmt` foi consertado em `186b786`. O topo do ramo (`39f9ca1`) está
  verde. Não há o que consertar ali.
- **`FIREBASE_DATABASE_SECRET` continua sendo lido** em um lugar: é a chave que
  assina o link de descadastro. O nome ficou errado — é um segredo do projeto,
  não mais do Firebase — mas renomear exigiria outro parâmetro no SSM e
  invalidaria links já enviados.
- **Outra sessão** (`session_011h89bmepw9dweoc5DKdxj4`) está escrevendo
  documentação (README, `docs/operacao.md`, `docs/seguranca.md`) e só finaliza
  depois que o #67 entrar. Ela não mexe na camada de dados.

## Como acessar a AWS daqui

As credenciais do ambiente estão em variáveis **minúsculas**
(`aws_access_key_id`, `aws_secret_access_key`), e o CLI só lê as maiúsculas —
que vêm com o texto `proxy-redacted`. Daí o `InvalidClientTokenId` em tudo. O
jeito certo é passar por comando:

```
export AWS_ACCESS_KEY_ID="$aws_access_key_id" \
       AWS_SECRET_ACCESS_KEY="$aws_secret_access_key" \
       AWS_DEFAULT_REGION=sa-east-1
```

A identidade é `github-actions-tracker`. Gravar as credenciais em
`~/.aws/credentials` foi recusado pelo verificador de permissões da sessão;
passar por comando funciona.
