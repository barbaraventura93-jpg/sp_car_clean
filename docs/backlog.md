# Backlog — SP Car Clean

Decisões e trabalho combinados, ainda não feitos. Cada item diz **o problema
medido**, não só o desejo, para que quem pegar depois não precise redescobrir.

Última atualização: 14/11/2026.

---

## 1. Fotos do site vindas do Google Drive — PAUSADO pela Bárbara em 09/11/2026

**Estado:** construído, testado em dois ensaios no acervo real, e **pausado antes
de ligar o gatilho**. Nada roda sozinho: sem gatilho criado, o Apps Script só
executa quando alguém aperta Executar, e `testar()` não envia nada.

Para retomar: colar `scripts/drive-sync.gs` do `main` no Apps Script, salvar,
rodar `testar()` e conferir a lista. O esperado, com as correções já mescladas,
é **3 pares** (Up, e os dois de Higienização de tecido), 2 no carrossel e 175
pulados. Depois disso, criar o gatilho diário de `sincronizar`.

O que os ensaios já provaram: o sufixo de tamanho do `thumbnailLink` funciona
(miniaturas de 322 a 722 KB), zero erros em 180 arquivos, e o relatório fecha a
conta. O risco técnico que estava em aberto neste desenho está fechado.

Dois defeitos saíram dos ensaios e já estão corrigidos no `main`: o carrossel
substituía as 7 fotos estáticas em vez de somar (PR #59), e arquivo sem ponto no
nome era descartado como formato desconhecido, jogando fora dois pares bons.

### O desenho (registro)

**Decidido em 08/11/2026.** O argumento que fechou a questão: o admin já joga as
fotos no Drive para o Instagram e não vai lembrar de voltar ao site. Tela que
depende de lembrar é tela que fica desatualizada.

### Por que NÃO foi pelo Google Cloud

O desenho inicial era uma Lambda com conta de serviço. A documentação do Google
derrubou isso: para carga que roda **fora** do Google Cloud — a nossa Lambda está
na AWS — ela recomenda Workload Identity Federation em vez de chave, porque chave
não expira e carrega ônus de segurança. E organizações criadas depois de
maio/2024 já vêm com **criação de chave bloqueada por padrão**: daria para fazer
todos os passos e descobrir no fim que o botão não existe.

Somado a isso, o projeto do site não aparece no console do Google Cloud da conta
dela (ver item 5), então depender do Cloud era depender de um acesso que ela não
tem hoje.

### O que foi construído

**Apps Script** (`scripts/drive-sync.gs`) na conta Google que é dona das pastas.
Lê o Drive com a própria conta: **sem conta de serviço, sem chave, sem projeto no
Google Cloud**. Gatilho diário, que a documentação descreve como "semelhante a um
cron job no Unix" e que "sempre roda sob a conta de quem o criou".

**`functions/drive-sync.js`** recebe e grava. E ninguém redimensiona imagem:

> As funções deste projeto não têm dependência de terceiros — o `lib/s3.js` chega
> a assinar SigV4 à mão para não usar o SDK — e decodificar JPEG exige
> biblioteca. Então quem reduz é o próprio Google: o Apps Script pede a
> **miniatura grande** do arquivo, que chega com algumas centenas de KB e já
> re-codificada, o que também descarta o EXIF (e com ele o GPS de foto tirada na
> casa do cliente).

A fonte são as **pastas de serviço que já existem** — não precisa criar pasta
nenhuma. Decidido em 08/11/2026, corrigindo um desenho meu que pedia duas pastas
novas:

> "O carrossel deveria buscar as fotos já existentes nas pastas de Depois de
> forma variada, e o antes e depois deveria buscar as fotos com nome antes e
> depois se referenciando ao mesmo processo nas pastas, sem ter que criar mais
> uma pasta para isso."

| o que entra | de onde |
|---|---|
| cartão de antes e depois | mesma pasta + mesmo nome base, com "antes" e "depois" — mesmo processo |
| carrossel | fotos de resultado, **intercalando as pastas**: no máximo 2 por serviço, 12 no total |

A **pasta é o serviço**, e é dela que sai a legenda: "Polimento Carro" em vez de
"Img 20261020 095116". O nome do arquivo só entra quando acrescenta informação —
"Polimento Carro — Fusca preto".

O que a estrutura real do Drive ensinou, e que eu teria errado supondo:

- **`Projeto PickupCorsa Uva Antes`** — o *nome da pasta* diz "Antes". Tudo nela
  é foto de antes, e pasta cujo nome termina em "antes" nunca alimenta o
  carrossel.
- **`Unsplash`** é banco de imagem de terceiros e **`Arquivo`** é arquivo morto:
  nenhum dos dois é trabalho dela. Ficam fora por padrão.
- Foto com "processo" ou "andamento" no nome é serviço em andamento, não
  resultado.

Nunca entra: "antes" sem par, qualquer foto de pasta de "antes", serviço em
andamento, e vídeo (dezenas ou centenas de MB; reduzir exigiria transcodificar).

**O limite honesto do automático:** foto com nome de câmera
(`IMG_20261020_095116.jpg`) não diz se é antes ou depois, e é tratada como
resultado. Se uma foto de "antes" estiver com nome de câmera, ela aparece como
resultado. Por isso o `testar()` lista tudo com pasta, nome e legenda: a
curadoria é de quem conhece as fotos. Renomear, ou pôr a pasta no `IGNORAR`,
resolve.

### O que falta, e é dela

1. Gerar um segredo e guardá-lo em `/sp-car-clean/DRIVE_SYNC_SECRET` (SecureString)
2. Instalar o Apps Script e rodar `testar()` — ensaio que não envia nada
3. Ler a lista do ensaio e dizer o que não deveria estar lá

Nenhuma pasta precisa ser criada ou movida.

### O risco conhecido, por escrito

O sufixo de tamanho do `thumbnailLink` **não está na documentação do Google**. É
a única parte deste desenho que não dá para confirmar sem rodar. Por isso o
`testar()` existe e imprime o tamanho real de cada miniatura: é o ensaio que
confirma antes de ligar o gatilho. Se a miniatura vier pequena demais, o plano B
é redimensionar no servidor — e aí a conversa sobre dependência volta.

A função **estoura em vez de mandar o original** se a miniatura falhar: original
de 23 MB seria recusado de um jeito bem menos claro.

## 2. Agentes de IA: mais úteis no dia a dia, sem painel de liga/desliga — AVALIADO em 14/11/2026, aguardando decisão

**O pedido (08/11/2026):** rever a estrutura de IA para ser mais útil e
assertiva no dia a dia. E a observação de que **não precisaria do painel de
liga/desliga por agente** na Central de IA.

A observação é justa: um painel com um interruptor por agente transfere para a
dona do negócio uma decisão que deveria estar resolvida. Agente que precisa de
interruptor é agente que não convenceu — ou é ligado por padrão porque serve,
ou não deveria existir.

**Já decidido em conversa anterior:** o `concierge` fica.

### A avaliação, por agente

O critério é o do pedido: qual decisão do dia ele muda, o que faz quando não
tem nada a dizer, e quanto custa. O custo está em **chamadas por mês** (o teto
configurado em `functions/lib/core/config.js`) e no tamanho máximo da resposta;
o valor em reais depende do preço do modelo no mês e deve ser lido no painel da
Anthropic, não estimado aqui de memória. Não tive acesso ao uso real
(`aiUsage` fica no banco), então "quanto é usado" está **não verificado**.

| Agente | Decisão que muda | Quando não tem nada a dizer | Teto mensal | Recomendação |
|---|---|---|---|---|
| `concierge` (chat do site) | A do cliente: qual serviço agendar. Responde na hora, com o catálogo e os preços reais | Só fala quando o cliente pergunta | 500 chamadas, resposta até 600 tokens | **Fica** (já decidido) |
| `orcamento` (foto do carro) | A do cliente: qual serviço serve para aquele estado do carro | Só roda quando o cliente envia foto | 200, até 512 | **Fica.** É o único que faz algo que regra fixa não faz (olhar a foto) |
| `satisfacao` (avaliações) | A sua: ligar para um cliente insatisfeito no mesmo dia | Fica em silêncio se não houve avaliação nova. É o comportamento certo | 60, até 400 | **Fica, sem a IA no alerta.** O alerta de nota baixa não precisa de IA: nota ≤ 3 já é o sinal. A IA só resume o comentário; manter se você lê o resumo |
| `checkin` (descrição de avarias) | Nenhuma decisão; economiza digitação no check-in | Só roda quando você pede | 150, até 400 | **Fica**, se você usa. É ferramenta, não agente: não precisa de interruptor |
| `conteudo` (legenda do Instagram) | Nenhuma decisão do negócio; economiza escrever legenda | Só roda quando você pede | 60, até 512 | **Fica**, se você usa. Mesma observação do `checkin` |
| `relatorio` (resumo semanal) | Pouca: repete números que o painel já mostra | **Manda mesmo sem novidade**, toda segunda | 10, até 800 | **Sai, ou vira relatório sem IA.** Os números já são calculados antes de chamar a IA; ela só redige |
| `insumos` (previsão de reposição) | A sua: o que comprar | **Manda "Estoque OK" mesmo sem nada a dizer** | 10, até 400 | **Sai.** Duplica dois avisos que já existem sem IA: o alerta diário de estoque abaixo do mínimo (`admin-alerts`) e a coluna "Dura até" da tela de Estoque (item 3) |
| `ping` | Nenhuma: é teste de conexão | — | 10 | **Sai da Central.** Vira uma checagem interna |

### O que proponho, se você concordar

1. **Tirar o painel de liga/desliga.** O que fica, fica ligado. O teto mensal
   de chamadas continua existindo por baixo, como proteção de custo, e avisa no
   Telegram se for atingido.
2. **Remover `relatorio`, `insumos` e `ping`** (e os do item 4, ver lá).
3. **Manter `concierge` e `orcamento` para o cliente**, e `satisfacao`,
   `checkin` e `conteudo` como ferramentas do painel.

Isso é mudança visível no painel (some a Central de IA como está hoje), então
**só faço com a sua confirmação**.

### Cuidados de segurança já aplicados (PR #65, 13/11/2026)

O agente de estoque era chamável por qualquer visitante, e a conversa do chat
não tinha teto de tamanho. Corrigido: agentes públicos em lista de permissão,
tetos na entrada, e o erro técnico não volta mais ao cliente.

Sobre texto de cliente entrando em prompt: no `concierge` e no `orcamento` a
IA só enxerga o catálogo público e a conversa do próprio visitante, e não tem
como executar nada, então o pior caso é ela responder bobagem ao próprio autor.
No `satisfacao` e no `agenda` o texto do cliente (comentário, nome) entra no
prompt e o resultado vai para o seu Telegram: um comentário malicioso poderia
distorcer o resumo, mas não acessa dado nem dispara ação.

**Próxima ação: da Bárbara** — dizer se concorda com a lista acima.

---

## 2.1 Reativação automática e descadastro de marketing — FEITO em 13/11/2026

Pedido de 12/11/2026, literal: *"Reativação de inativos não recuso os e-mails,
se ele enviasse automaticamente os e-mails num padrão seria melhor, mas tem que
ter uma funcionalidade do cliente se descadastrar, caso não queira mais receber
e-mails de marketing"*.

**O que mudou.** O agente `reativacao` tinha um modo só: gerava textos e
esperava revisão — revisão que nunca acontecia, então nenhum e-mail saía. Agora
tem dois. Pelo painel, continua gerando para revisão. Pelo cron de terça
(`weekly:tue:08`), escolhe, escreve e **envia**.

**O "padrão" do envio automático**, que são as travas que precisam valer sempre
(cada uma com teste em `scripts/test-reativacao-auto.js`):

| Trava | Valor | Por que |
|---|---|---|
| Inatividade | 90 dias | abaixo disso o cliente não está inativo, está entre serviços |
| Intervalo mínimo | 90 dias por e-mail | é o que separa reativação de spam |
| Teto por execução | 8 e-mails | 1 chamada de IA por cliente; 8×4 semanas cabe no orçamento de 60/mês |
| Link de descadastro | obrigatório | sem segredo para assinar o link, **não envia** |

A última é a mais importante: se o `FIREBASE_DATABASE_SECRET` faltar, o agente
aborta em vez de mandar marketing sem saída. O mesmo vale se o EmailJS não
estiver configurado — ele não finge que enviou.

**O descadastro.** Não existia nada parecido no projeto — nenhum opt-out em
lugar nenhum — e o e-mail de aniversário já saía automático desde sempre. Agora:

- `functions/unsubscribe.js` — página pública, **um clique, sem login**. Quem
  recebeu o e-mail não necessariamente tem conta, e pedir senha para parar de
  receber marketing é o mesmo que não oferecer saída.
- O link leva um HMAC do endereço. Sem ele, qualquer um descadastraria o e-mail
  de qualquer um, e a página viraria oráculo de *"este endereço é cliente?"*.
  Link inválido e e-mail inexistente dão a **mesma** resposta, por isso.
- Reativação **e aniversário** respeitam a lista. Lembrete de agendamento,
  confirmação de pagamento e indicação **não** — são transacionais, o cliente
  pediu, e continuam saindo para quem se descadastrou.

**Ponto aberto, dependente da dona:** o e-mail de aniversário usa um template
fixo do EmailJS (com campos de cupom). O link de saída já vai no parâmetro
`unsubscribe_url`, mas **só aparece no corpo quando o template imprimir essa
variável** — é uma edição no painel do EmailJS, fora do código. Enquanto isso
não for feito, o aniversário já deixa de ser enviado a quem se descadastrou,
mas quem recebe não vê o link. A reativação não tem esse problema: usa o
template de corpo livre (`template_update`), e o rodapé é montado no código.

**Trava nova de infra.** `unsubscribe.js` existia desde o commit anterior e
**não estava registrada no Terraform** — sem rota, o link do rodapé daria 404,
sem erro em lugar nenhum. O `test-infra-estatico.js` ganhou a regra: toda função
em `functions/` precisa de rota HTTP ou cron.

⚠️ **O `terraform apply` tem de rodar ANTES do merge deste PR** — função nova
precisa existir na infra, e o CI só valida, não aplica.

---

## 3. Estoque: preço pela unidade de compra — FEITO em 09/11/2026

**Entregue, e maior do que o item original.** O pedido foi refinado em
09/11/2026: *"deixar um campo de múltiplo de compra e outro de unidade de compra
(kg, L, ml, g), e outro de preço de compra, e com esses ele já vai fazer os
cálculos para a unidade de medida de uso por produto"* e *"emendar isso no
cálculo de custo por serviço ao invés de incluir manualmente"*.

**No insumo:** três campos — múltiplo (5), unidade de compra (L) e preço
(R$ 180). O sistema converte sozinho, porque sabe que 1 L são 1000 ml, e mostra
a conta inteira: *"Calculado: R$ 180,00 ÷ (5 L = 5000 ml) = R$ 0,0360 por ml"*.
Ela não digita 5000 em lugar nenhum. A lista de unidades oferecida é só a da
mesma família do uso: kg não aparece para um insumo medido em ml, porque
converter massa em volume exigiria a densidade do produto.

**No serviço:** o custo era digitado à mão (`pricing.pq.cost`) enquanto a tela
de Estoque calculava o mesmo número pelas receitas — dois números para a mesma
coisa, e a margem dos cards saía do digitado. Agora o formulário de serviço tem
a seção **Insumos consumidos** (insumo, quantidade do pequeno, quantidade do
grande) e o custo vem de `Σ quantidade × custo por unidade`.

Isso fechou um buraco que ninguém tinha notado: a receita só existia para os 9
serviços que já vinham prontos (`RECIPE_DEFAULTS`), e **não havia tela nenhuma
para criar outra**. Serviço novo nascia sem uso cadastrado, sem como cadastrar,
e sem custo. A baixa automática de estoque (`deductStock`) também não o
alcançava.

**Sem opção de informar o custo à mão, nas duas telas** (pedido explícito,
repetido: *"sempre fazer o cálculo do custo pelos insumos, não deve ter essa
flag"*). Duas origens para o mesmo número é como o custo do serviço passa a
discordar do que foi pago. Quem compra a granel usa múltiplo 1 e o preço de uma
unidade — mão de obra vira "1 h custa R$ 35", que dá exatamente o mesmo custo
que estava salvo. Insumo antigo abre já assim, então tirar a opção não obrigou
a recadastrar nada.

**Saldo e mínimo passaram a ser contados na unidade de compra, com decimal**:
"17,5 L", não "17500 ml". A tela mostra as duas leituras e quantas embalagens
são. O armazenado continua em unidade de uso, que é onde a receita desconta.

**Quando comprar.** O saldo já era baixado pelas vendas (`deductStock`, ao
concluir o agendamento). O que faltava era projetar: `consumoPorDia` mede o
ritmo real nos serviços **concluídos** dos últimos 60 dias — janela larga
porque insumo de polimento pareceria ter consumo zero num mês fraco — e
`previsaoCompra` diz em quantos dias o insumo chega no mínimo. A tela ganhou a
coluna "Dura até" e um aviso de **comprar nos próximos 14 dias**. Sem consumo
medido não inventa prazo: diz "sem consumo registrado", que é diferente de
"acaba hoje".

Um defeito foi corrigido junto: dois serviços do mesmo agendamento usando o
mesmo insumo faziam o segundo **sobrescrever** o primeiro na baixa — o consumo
de um sumia, e o sistema achava ter mais produto do que a prateleira.

`costPerUnit` continua sendo o que as receitas leem: dado antigo não mudou, e
abrir a tela de um produto antigo não altera o custo salvo.

Um defeito foi encontrado pelo próprio teste e corrigido antes de entregar:
quem desligasse o cálculo, digitasse um custo e depois registrasse o preço pago
via o valor digitado ser sobrescrito sem aviso. Agora o automático só pode
apagar valor vindo do banco ou campo vazio, nunca o que a pessoa acabou de
escrever.

**Fica como possível evolução:** a reposição ("📥 Repor") é o momento natural de
atualizar o preço, porque é quando ela compra. Hoje ela só lança quantidade. Um
campo "preço pago neste lote" ali manteria o custo sempre atual sem ninguém ter
que lembrar de abrir o cadastro.

### O problema, como estava medido (registro)

O modelo JÁ tinha os campos:

- `purchaseUnitLabel` — "Galão 5L"
- `purchaseConversionFactor` — 5000 (ml por galão)

E a **reposição** já usa: dá para lançar entrada em galões e o sistema
multiplica pelo fator (`app.js`, `stockRestock`).

O que não acompanhou foi o **custo**. O campo editável é `costPerUnit`, em
unidade-base, com passo de `0.0001`:

```
Custo por ml:  [ 0.0360 ]
```

Ou seja: sabendo que o galão custa R$ 180, a pessoa tem que calcular
180 ÷ 5000 = 0,036 à mão. É exatamente a conversão que ela não deveria fazer.

Era exatamente a conversão que ela não deveria fazer. É o que foi consertado
acima.

---

## 4. Avaliação dos agentes adiados — AVALIADO em 14/11/2026, aguardando decisão

`upsell`, `reativacao` e `agenda` ficaram para o fim do backlog por decisão de
30/10/2026. Avaliados com o mesmo critério do item 2.

| Agente | Decisão que muda | Quando não tem nada a dizer | Teto mensal | Recomendação |
|---|---|---|---|---|
| `upsell` (sugere um complemento no agendamento) | A do cliente: acrescentar um serviço | Fica em silêncio se não achar complemento | 300, até 120 tokens | **Não fazer / remover.** O site já sugere o combo que falta sem IA ("adicione X e ganhe o combo"), com desconto real. A sugestão da IA concorre com essa e não tem desconto para oferecer. É também o agente público que mais chama (um por agendamento) |
| `reativacao` (mensagem para cliente sumido há 90+ dias) | A sua: quem chamar de volta e com que texto | Só roda quando você seleciona clientes | 60, até 400 por cliente | **Fazer depois, com condição.** A parte útil é a lista de quem sumiu, que não precisa de IA. A IA só personaliza o texto. Vale quando houver base de clientes para justificar; hoje são poucos |
| `agenda` (ranqueia a lista de espera quando abre vaga) | A sua: quem avisar primeiro | Fica em silêncio se não há ninguém na espera para a data | 30, até 512 | **Não fazer agora.** Com lista de espera pequena, a ordem de chegada resolve e é justa de explicar ao cliente. Reavaliar se a lista passar de uns 10 nomes por data |

**Resumo:** remover `upsell`; manter `reativacao` e `agenda` desligados até
haver volume que os justifique, e nesse dia reavaliar com números de uso.

**Próxima ação: da Bárbara** — confirmar, junto com o item 2.

---

## 5. Acesso ao projeto do Firebase/Google Cloud do site — ABERTO, depende da Bárbara

O projeto **não aparece** no console do Google Cloud da conta da Bárbara. Mas ele
**existe e está vivo**: em 08/11/2026 a leitura com o segredo respondeu 200, a
leitura das regras respondeu 200, e a publicação de regras novas funcionou — nada
disso é possível em projeto apagado. Um projeto inexistente devolve 404.

Número do projeto: **726947312422** (está no `app.js`). O id é `sp-car-clean`.

O que isso significa hoje: ninguém pode trocar as regras pelo console, rodar o
segredo do banco, ver consumo, ou recuperar o projeto. O único caminho é o
segredo guardado no SSM. Funciona, mas é ponto único de falha.

Hipótese não descartada: o projeto foi criado em **outra conta Google**. As
pastas do Drive têm dois donos (`barbaraventura93@` e `sidrpeixoto@`), e o e-mail
administrativo do site é um terceiro (`spcarclean0@`). Vale procurar pelo número
do projeto logada em cada uma.

Mitigações já em pé: backup diário no S3, e a migração para DynamoDB, que elimina
a dependência.

### O risco de seguir sem o acesso (atualizado em 14/11/2026)

- **As regras do banco só podem ser publicadas com o segredo.** As regras
  novas (PR #64) estão no repositório e ainda não valem (ver item 6).
- **O segredo é uma credencial que ignora todas as regras** e não tem como ser
  trocada sem o console. Se vazar, não há como revogá-la.
- **Ninguém vê consumo nem cobrança** do projeto Google.
- **Se o Google desativar o projeto** por inatividade do dono ou problema de
  cobrança, o site perde o banco sem aviso. O backup diário no S3 permite
  reconstruir, mas não há procedimento ensaiado.

### O caminho, em passos simples

1. Entre em https://console.firebase.google.com com **cada uma** das três
   contas Google (a sua, a do Sid e a do e-mail administrativo do site).
2. Em cada uma, veja se aparece um projeto chamado **sp-car-clean**.
3. Na conta em que aparecer: **Configurações do projeto > Usuários e
   permissões > Adicionar membro**, e adicione a sua conta como **Proprietário**.
4. Me avise qual conta era. A partir daí dá para trocar o segredo e publicar
   regras pelo console.

Se não aparecer em nenhuma das três, o projeto está numa conta desconhecida e
o caminho passa a ser concluir a migração dos dados para o DynamoDB.

**Próxima ação: da Bárbara.**

---

## 6. Publicar as regras novas do banco — ABERTO, depende de acesso

**O problema medido (13/11/2026):** as regras em produção deixam um visitante,
sem login, apagar a lista de espera inteira, ler todas as avaliações
(inclusive as internas) e a lista de cupons, e criar agendamento já
"confirmado". No emulador, 28 de 88 casos de teste falham com as regras
antigas; com as novas (PR #64, já na `main`), nenhum.

**O que falta:** publicar. Precisa do segredo do banco, guardado no SSM, que a
credencial atual da revisão não lê. Passo a passo em
`docs/acoes-da-barbara.md`.

**Próxima ação: da Bárbara** — autorizar a leitura do segredo, ou resolver o item 5.

---

## 7. Preço, cupom, gift card e pontos calculados no servidor — ABERTO

**O problema medido (09/11/2026):** o preço final de um agendamento, com cupom
e gift card já abatidos, é calculado e gravado pelo navegador. O servidor não
confere. Marcar um cupom como usado depende de uma escrita que as regras negam
ao visitante, então cupom de uso único não é baixado. Os pontos de fidelidade
saem do preço que o próprio cliente gravou. Achados S-05, S-07 e S-08 de
`docs/revisao-2026-11-09.md`.

Hoje a barreira é a sua conferência manual de cada pedido antes de aprovar.

**O que resolveria:** uma função no servidor que cria o agendamento, calcula o
preço, baixa o cupom e o gift card numa operação só. É o maior item que
sobrou da revisão.

**Muda para o cliente:** os pontos passariam a cair só depois do pagamento
confirmado ou da conclusão do serviço.

**Próxima ação: da Bárbara** — aprovar o escopo antes de eu começar.

---

## 8. Infra: alarmes, cabeçalhos de segurança e segunda etapa no login admin — ABERTO

**O problema medido (14/11/2026, lido na AWS):** nenhum alarme configurado, então
um backup diário ou um lembrete que falhe passa em silêncio. O login não tem
verificação em duas etapas, com 2 contas de admin. O site não envia política de
segurança de conteúdo (CSP), que seria a segunda barreira contra o defeito
corrigido no PR #63.

**Custo:** os 10 primeiros alarmes são gratuitos; os demais, US$ 0,10 por mês
cada. CSP e verificação em duas etapas por aplicativo não têm custo.

**Muda para a admin:** passa a digitar um código do aplicativo autenticador ao entrar.

**O que falta:** escrever o Terraform e você aplicar. O `terraform plan` ainda
não rodou: a credencial atual não lê API Gateway, SSM nem Route 53.

**Próxima ação: minha** (escrever), depois **da Bárbara** (aplicar).

---

## 9. `functions/lib/feriados.js` não é usado por ninguém — ABERTO

**O problema medido (09/11/2026):** o arquivo calcula feriados nacionais e de
Guarulhos, mas nenhuma função nem o site o chama, e ele não tem teste. O prazo
de entrega mostrado ao cliente não considera feriado nem domingo.

**Decisão necessária:** ligar ao cálculo do prazo (com teste), ou remover o arquivo.

**Próxima ação: da Bárbara** — o prazo deve pular feriado?
