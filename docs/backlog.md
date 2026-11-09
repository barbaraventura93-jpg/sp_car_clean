# Backlog — SP Car Clean

Decisões e trabalho combinados, ainda não feitos. Cada item diz **o problema
medido**, não só o desejo, para que quem pegar depois não precise redescobrir.

Última atualização: 09/11/2026.

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

## 2. Agentes de IA: mais úteis no dia a dia, sem painel de liga/desliga

**O pedido (08/11/2026):** rever a estrutura de IA para ser mais útil e
assertiva no dia a dia. E a observação de que **não precisaria do painel de
liga/desliga por agente** na Central de IA.

A observação é justa: um painel com um interruptor por agente transfere para a
dona do negócio uma decisão que deveria estar resolvida. Agente que precisa de
interruptor é agente que não convenceu — ou é ligado por padrão porque serve,
ou não deveria existir.

**Já decidido em conversa anterior:** o `concierge` fica. Os demais ficaram
para avaliação no fim do backlog.

**O que esta análise precisa entregar, por agente:** qual decisão do dia ele
muda, o que ele faz quando não tem nada a dizer (silêncio é resposta), e quanto
custa por mês. Agente que não muda decisão sai. Sem interruptor: o que fica,
fica ligado.

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

## 4. Avaliação dos agentes adiados

`upsell`, `reativacao` e `agenda` ficaram para o fim do backlog por decisão de
30/10/2026. Avaliar com o mesmo critério do item 2.

---

## 5. Acesso ao projeto do Firebase/Google Cloud do site

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
