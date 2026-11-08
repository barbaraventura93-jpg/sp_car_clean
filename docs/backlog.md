# Backlog — SP Car Clean

Decisões e trabalho combinados, ainda não feitos. Cada item diz **o problema
medido**, não só o desejo, para que quem pegar depois não precise redescobrir.

Última atualização: 08/11/2026.

---

## 1. Fotos do site vindas do Google Drive — CONSTRUÍDO, falta instalar

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

A regra do negócio virou a estrutura de pastas, porque o nome do arquivo não diz
nada (`IMG_20261020_095116.jpg`):

| pasta no Drive | vira |
|---|---|
| `Site/Carrossel` | item do carrossel — o caso "só o depois" |
| `Site/Antes e Depois` | par `X antes.jpg` + `X depois.jpg` — os dois juntos |

Arquivo sem par, ou com nome fora do padrão, é **pulado e registrado no log** —
nunca adivinhado. Foto de "antes" entrando como resultado é o contrário de uma
vitrine.

### O que falta, e é dela

1. Criar as duas pastas no Drive e mover para lá as fotos que devem aparecer
2. Gerar um segredo e guardá-lo em `/sp-car-clean/DRIVE_SYNC_SECRET` (SecureString)
3. Instalar o Apps Script e rodar `testar()` — ensaio que não envia nada

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

## 3. Estoque: preço pela unidade de compra, não pela unidade de uso

**O pedido (08/11/2026):** "eu compro em galão de 5 l e sei o preço do galão de
5 l, não deveria ter que ficar fazendo a conversão para o cálculo do uso".

**O problema está medido, e é menor do que parece.** O modelo JÁ tem os campos:

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

**Conserto:** passar a pedir o **preço da unidade de compra** ("Galão 5L custa
R$ 180") e derivar `costPerUnit = preço ÷ purchaseConversionFactor`, mostrando
o valor derivado ao lado como conferência. O campo por unidade-base continua
existindo para quem compra a granel, mas deixa de ser o caminho principal.

Dado antigo não quebra: `costPerUnit` continua sendo o que as receitas leem.

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
