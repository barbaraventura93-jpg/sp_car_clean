# Operação — SP Car Clean

Como saber se o site está funcionando, onde olhar quando algo falha, como
recuperar os dados e o que fazer se o gasto na AWS subir. Escrito para quem não
é da área. Última atualização: 15/11/2026.

Termos usados aqui: **projeto** é o seu espaço na AWS; **AWS Settings**
(settings.aws.com) é onde ficam cobrança, limite de gasto e team members.

---

## 1. Como saber se está no ar

Abrir a página inicial **não basta**: ela carrega mesmo com o banco de dados
fora do ar (foi assim que uma queda de dias passou despercebida em
novembro/2026, ver o item 5). Confira as três coisas:

| O que conferir | Como | Resultado esperado |
|---|---|---|
| A página | Abrir https://www.spcarclean.com.br | O site aparece |
| O banco de dados | **Em transição** (item 5): o Firebase foi removido e o banco está indo para o DynamoDB (PR #67). Esta linha ganha o passo a passo definitivo quando a migração terminar | — |
| O painel | Entrar na Área Restrita e abrir a lista de agendamentos | Os agendamentos aparecem |

Sinais de que algo está errado mesmo com a página abrindo: painel vazio, o
cliente não recebe o lembrete do dia anterior, o alerta diário de estoque para
de chegar no Telegram.

## 2. Onde ver os registros (logs)

Cada função do site grava mensagens no **CloudWatch**, por 14 dias.

1. Console da AWS, com a Região **São Paulo (sa-east-1)** selecionada.
2. **CloudWatch > Grupos de logs**.
3. O grupo de cada função se chama `/aws/lambda/sp-car-clean-<nome>`.

| Quero saber sobre… | Grupo |
|---|---|
| Pagamento que não confirmou | `sp-car-clean-infinitepay-webhook` |
| Backup diário | `sp-car-clean-firebase-backup` |
| Lembrete ao cliente | `sp-car-clean-reminder-check` |
| Alerta de entregas e estoque | `sp-car-clean-admin-alerts` |
| Painel que não grava | `sp-car-clean-admin-data` |
| "Minha Conta" do cliente | `sp-car-clean-me` |
| Chat e IA | `sp-car-clean-ai` |

Procure por linhas com `ERROR`. As mensagens são em português e dizem o que
falhou (por exemplo, "Firebase respondeu HTTP 404").

**Limite conhecido:** hoje **não há alarme**. Uma função que falha registra o
erro, mas ninguém é avisado. Está no backlog (item 8).

O resultado de cada publicação do site fica no GitHub, aba **Actions**. Uma
publicação só acontece se o job `testes` passar.

## 3. Backup e restauração

### O que existe

- Todo dia, às 03h17 de Brasília, a função `firebase-backup` copia o banco
  inteiro para o bucket de backups do projeto, em
  `firebase/AAAA/MM/DD/firebase-<data-hora>.json.gz`.
- Os arquivos são criptografados e apagados sozinhos depois de 180 dias.
- A função **recusa** gravar um backup vazio, truncado ou sem as seções
  principais, para não sobrescrever a confiança num arquivo ruim.

### Como conferir se o backup do dia foi feito

Console da AWS > **S3** > bucket que termina em `backups` > pasta `firebase` >
ano > mês > dia. Deve haver um arquivo com a data de hoje, com algumas dezenas
de KB. Se o último arquivo for de dias atrás, o backup parou: veja o log
`sp-car-clean-firebase-backup`.

### Como ler um backup sem alterar nada

Ler não muda o banco nem o arquivo. Procedimento **verificado em 15/11/2026**
com os três arquivos existentes: todos abriram, eram JSON válido e traziam as
seções esperadas (agendamentos, serviços, estoque, perfis, configurações).

1. No S3, selecione o arquivo e clique em **Baixar**.
2. O arquivo é um `.json.gz`: descompacte (no Windows, com 7-Zip; no Mac, dois
   cliques) e abra o `.json` num editor de texto. Se o navegador já entregar
   o arquivo como texto legível, ele já veio descompactado.
3. As seções de primeiro nível são `bookings` (agendamentos), `services`,
   `stock`, `clientProfiles`, `coupons`, `giftcards`, `config` e outras.

O arquivo contém dados pessoais de clientes (nome, telefone, e-mail, placa).
Não envie por e-mail nem por mensagem, e apague a cópia baixada depois de usar.

### Como restaurar

> **Desatualizado em parte.** O procedimento abaixo é o do Firebase, que foi
> removido em 10/11/2026. Com o banco no DynamoDB, a restauração passa a ser
> pela recuperação a um ponto no tempo da tabela (35 dias) ou pela reimportação
> do backup com `scripts/importar-para-dynamodb.js` (PR #67). Esta seção será
> reescrita quando a migração terminar.

Restaurar **sobrescreve** o banco. Só faça com o banco vazio ou perdido, nunca
"para testar".

- **Para o mesmo banco, se ele voltar:** console do Firebase > Realtime
  Database > menu de três pontos > **Importar JSON** > escolher o `.json`
  descompactado.
- **Para um banco novo:** criar o projeto Firebase, criar o Realtime Database,
  importar o mesmo arquivo, publicar as regras de `database.rules.json`, e
  então trocar o endereço do banco no site (`app.js`, `databaseURL`) e nos
  parâmetros das funções (`FIREBASE_DATABASE_URL` e `FIREBASE_DATABASE_SECRET`
  no SSM). Esse último passo exige publicar o site de novo.

O que se perde numa restauração: tudo que foi gravado depois do horário do
backup usado.

**Este procedimento de restauração ainda não foi ensaiado de ponta a ponta.**
A leitura foi verificada; a importação, não.

## 4. Se o gasto na AWS disparar

1. **Veja o que está custando.** Em **AWS Settings > Billing** está o gasto do
   mês. No console, **Billing and Cost Management > Cost Explorer** mostra por
   serviço.
2. **Confira o limite de gasto.** Se o projeto estiver no plano pago, pode
   haver um spend limit em AWS Settings. Quando ele é atingido o projeto é
   pausado, e o sintoma é "Access Denied" em coisas que funcionavam.
3. **Suspeitos mais prováveis neste projeto**, do mais ao menos provável:

   | Sintoma no Cost Explorer | Causa provável | O que fazer |
   |---|---|---|
   | Lambda ou API Gateway subindo | Alguém chamando as funções em massa | O WAF já limita por IP; veja o log da função mais chamada |
   | CloudFront (transferência) | Muito tráfego ou alguém baixando as fotos em massa | Ver as métricas da distribuição |
   | S3 crescendo | Versões antigas acumulando no bucket do site | Está no relatório da revisão como melhoria |
   | WAF | Custo fixo mensal da proteção, mais requisições | Esperado; não desligar |

4. **A IA não é cobrada pela AWS.** O gasto com os agentes aparece no painel
   do fornecedor do modelo. Cada agente tem um teto mensal de chamadas e se
   desliga sozinho ao atingi-lo, avisando no Telegram.
5. **Para estancar numa emergência,** os agendamentos automáticos podem ser
   pausados pelo Terraform (`schedules_enabled = false`). Isso para lembretes,
   backup e alertas, então é medida temporária.

## 5. Registro de incidentes

### Banco de dados (Firebase) removido — 10/11/2026

- **O que aconteceu:** a dona do projeto excluiu o projeto do Firebase em
  10/11/2026, de propósito, para concluir a migração para a AWS. A migração
  ainda não tinha levado o banco, então tudo que depende de dados parou: o
  painel abre vazio e o site não registra agendamentos.
- **Recuperação:** o backup de 09/11 (íntegro, conferido em 15/11) foi
  importado para a tabela DynamoDB `sp-car-clean-data`. O trabalho está no
  PR #67, que também traz o registro completo do incidente em
  `docs/incidente-firebase-2026-11-14.md` e o que ainda falta da migração.
- **Proteção ao cliente enquanto isso:** desde o PR #70, se a gravação de um
  agendamento falhar o site avisa e aponta o WhatsApp, em vez de mostrar
  "recebemos" sem ter gravado.
- **Lições:** conferir o banco, e não só a página, depois de cada publicação;
  alarme nas funções agendadas (backlog, item 8).
