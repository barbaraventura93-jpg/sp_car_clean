# Backlog — SP Car Clean

Decisões e trabalho combinados, ainda não feitos. Cada item diz **o problema
medido**, não só o desejo, para que quem pegar depois não precise redescobrir.

Última atualização: 08/11/2026.

---

## 1. Fotos do site vindas do Google Drive, sem tela de upload

**O pedido (08/11/2026):** tirar a tela de input de fotos do painel e puxar do
Drive. O argumento é de operação, e é bom: o admin já joga as fotos no Drive
para os posts do Instagram, e não vai lembrar de voltar ao site para subir de
novo. Uma tela que depende de lembrar é uma tela que fica desatualizada.

**O que já está medido:**

- A pasta é `SP Car Clean_Fotos Instagram`, com subpastas por serviço (Lavagem
  Detalhada Carros/Motos, Polimento Carro/Moto, Higienização de Tecidos,
  Lavagem de Motor, Retirada de Insulfilm, Arquivo).
- Os arquivos vão de 84 KB a 23 MB; vídeos chegam a 1,5 GB.
- Os nomes são inconsistentes: alguns dizem "antes"/"depois" (`Up Antes.jpg`,
  `fusca-preto depois 1.jpg`), a maioria é nome de câmera
  (`IMG_20261020_095116.jpg`), e vários são literalmente `image.jpg`.
- No acervo inteiro, só **12 fotos** têm "depois" no nome e **nenhuma** tem
  "antes e depois". Os compostos que o site mostra foram feitos fora do Drive.

**Desenho proposto:** uma Lambda em cron diário que lê uma pasta designada,
pega o que é novo, redimensiona, grava no bucket de mídia e atualiza
`/portfolio` e `/gallery`. A pessoa continua fazendo o que já faz — jogar foto
no Drive — e o site acompanha sozinho.

**O bloqueio real, que precisa de decisão:** a Lambda precisa de credencial do
Google. Duas formas:

| forma | como funciona | o que exige |
|---|---|---|
| conta de serviço | compartilhar a pasta com o e-mail da conta de serviço | criar a conta no Google Cloud e guardar o JSON no SSM |
| token OAuth | autorizar uma vez no navegador, guardar o refresh token | criar um cliente OAuth no Google Cloud |

As duas passam pelo **console do Google Cloud**. O console do Firebase já não
mostra o projeto, então é preciso confirmar se o acesso ao Google Cloud
(`console.cloud.google.com`) ainda funciona para o projeto `sp-car-clean` — o
banco responde, então o projeto existe.

**Por que não dá para fazer de dentro de uma sessão do Claude:** o conector do
Drive devolve o arquivo como texto base64 pela conversa. Para fotos de
megabytes isso é inviável, e não há credencial do Google no ambiente para
transferir direto para disco.

**Convenção que o automático vai exigir:** como o nome do arquivo não diz se é
antes ou depois, a pasta precisa dizer. Por exemplo `Site/Carrossel` (só fotos
do resultado) e `Site/Antes e Depois` (pares `X antes.jpg` / `X depois.jpg`).
É uma disciplina pequena, e substitui a tela de upload.

**Enquanto não houver automático:** a tela de upload fica. Ela já otimiza
sozinha (foto de 20 MB vira ~650 KB, sem EXIF), o que era o impedimento para o
acervo do Drive ser usado.

---

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
