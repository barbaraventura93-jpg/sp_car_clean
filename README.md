# SP Car Clean — Estética Automotiva Premium

Site institucional + sistema de agendamento online com painel de gestão para a **SP Car Clean**, especializada em estética automotiva em São Paulo, SP.

🌐 **[www.spcarclean.com.br](https://www.spcarclean.com.br)**

---

## Funcionalidades

### Site público
- **Vitrine de serviços** com preços por porte de veículo (pequeno/grande) e toggle interativo
- **Dois botões por card de serviço**: "Agendar →" e "❓ Dúvidas" — FAQ abre em modal dedicado sem interferir no agendamento
- **Carrossel de portfólio** no hero com suporte a imagens e vídeos
- **Galeria Antes/Depois** com slider interativo drag/touch — visitante arrasta para comparar antes e depois de cada serviço
- **Depoimentos de clientes** em cards
- **Seção de diferenciais** com estatísticas animadas
- **Botão WhatsApp** direto para contato

### FAQ por serviço
- Cada serviço pode ter perguntas e respostas cadastradas pelo admin
- Botão "❓ Dúvidas" no card abre modal com todas as perguntas daquele serviço
- Modal inclui botão direto para agendar ao final da leitura
- Admin gerencia as perguntas pelo painel (aba Serviços → editar → seção FAQ)
- Seed de perguntas frequentes realistas disponível com 1 clique ("💬 Seed FAQs")

### Conta do Cliente
- **Criação de conta opcional** no step 3 do agendamento (e-mail + senha)
- **Login** direto no menu "Minha Conta" com recuperação de senha
- **Pré-preenchimento automático** do formulário quando o cliente está logado
- **Histórico completo** de agendamentos, veículos e saldo de pontos de fidelidade
- **Badge de pontos** (⭐ X pts + valor em R$) visível na conta
- **Data de nascimento** salva no perfil — base para cupom de aniversário automático
- Admin pode **migrar agendamentos antigos** por e-mail ao UID da conta (botão em Configurações)

### Agendamento (cliente)
- Fluxo em **4 etapas**: serviço → data → dados → confirmação
- Seleção de **múltiplos serviços** no mesmo agendamento com total calculado dinamicamente
- **Sugestão inteligente de combo**: se os serviços escolhidos fizerem parte de um combo com desconto, o sistema sugere aplicá-lo com 1 clique
- **Campo de cupom de desconto** no step 3 com validação em tempo real
- **Calendário interativo** com disponibilidade em tempo real integrado ao Firebase Realtime Database
- Dias esgotados aparecem em laranja com opção de **entrar na lista de espera**
- **Código de rastreamento único** por agendamento (ex: `SPC-X7K2M`)
- **Consulta de status** por código + e-mail — sem login, via função server-side (`booking-status`) que protege os dados pessoais
- **Reagendamento self-service**: cliente solicita nova data com justificativa; admin aprova ou rejeita
- **Cancelamento self-service**: política de reembolso calculada automaticamente por dias úteis
- **Confirmação automática por e-mail** via EmailJS em cada mudança de status relevante
- Coleta de **bairro e CEP** do cliente para mapeamento geográfico
- **Pagamento online via InfinitePay** (PIX + cartão de crédito): link de pagamento gerado automaticamente no momento da aprovação; webhook confirma o pagamento no Firebase

### Lista de Espera
- Cliente entra na lista de espera de dias esgotados diretamente pelo calendário
- Dados salvos em `/waitlist` no Firebase (nome, telefone, e-mail, data desejada)
- Aba **⏳ Lista de Espera** no painel admin com todos os inscritos
- Ao cancelar um agendamento, admin é perguntado se deseja notificar o primeiro da lista via WhatsApp
- Botão de notificação individual por entrada na lista
- Botão de remoção de entradas já atendidas

### Check-in do Veículo (Admin)
- Botão **📋 Check-in** no detalhe de cada agendamento aprovado ou confirmado
- Modal com **19 pontos de inspeção** (para-choques, portas, teto, vidros, rodas, bancos, painel, tapetes etc.)
- Cada item tem toggle **OK / Avaria** — itens com avaria expandem campo de descrição + upload de foto
- Registro de **km no odômetro** e **nível de combustível** na entrada
- Campo de observações gerais (acessórios, objetos no interior etc.)
- Fotos armazenadas no **Firebase Storage** (`checkin/{bookingId}/`)
- Ao finalizar: envia **e-mail** (template_update) e abre **WhatsApp** ao cliente com o resumo completo
- Resumo do check-in visível no detalhe do agendamento (admin) e em **Minha Conta** (cliente) com miniaturas clicáveis
- Badge **"📋 check-in"** na lista de agendamentos do admin
- Após check-in concluído, cliente **não pode mais reagendar ou cancelar** — veículo já entregue
- Admin também **não pode cancelar** após check-in; apenas reagendar a data de retirada (com aviso automático ao cliente)

### Painel Administrativo
- Login seguro com **Firebase Auth** (e-mail + senha)
- **Calendário de agenda**: bloquear dias avulsos ou períodos inteiros
- **Lista de agendamentos** filtrável por status (pendente, aprovado, confirmado, rejeitado, cancelado)
- Aprovar com definição de **preço final**, datas e local de entrega/retirada
- Rejeitar e cancelar agendamentos — **cancelamento bloqueado após check-in** (veículo já em serviço)
- **Alterar datas**: antes do check-in altera início + conclusão; após check-in altera apenas a data de retirada e envia e-mail automático ao cliente com a nova previsão
- **Alerta de capacidade** por dia (`maxPerDay` configurável)
- **Nota do agendamento** (`adminNotes`): observação escrita na aprovação e **compartilhada com o cliente** — aparece como "Nota" na consulta de status e como "Obs" no WhatsApp de aprovação
- Contato direto com o cliente via **WhatsApp** a partir do painel
- **Notificação em tempo real via Telegram** a cada novo agendamento, reagendamento ou cancelamento
- **Exportação de dados** em JSON

### Agendamento Manual pelo Admin
- Botão **➕ Novo agendamento** na aba de Agendamentos
- Registra clientes que chegaram por WhatsApp, telefone ou presencialmente
- **Seleção de múltiplos serviços** no mesmo agendamento: grade de checkboxes agrupados por categoria; valor total calculado automaticamente pela soma dos preços (editável)
- Prazo de conclusão calculado com base no maior `daysExtra` entre os serviços selecionados
- **Lookup automático por e-mail**: busca conta em `/clientProfiles` (pré-preenche nome, telefone, veículo) e vincula pontos de fidelidade se o cliente tiver conta
- Status inicial configurável: **Aprovado**, **Confirmado** ou **🏁 Concluído** (registro histórico de serviços passados — aceita datas retroativas)
- Se `confirmed` ou `completed` com conta vinculada → `_awardPoints()` concedido imediatamente
- Checkbox para enviar **e-mail de confirmação** ao cliente via EmailJS
- Checkbox para abrir **WhatsApp** com resumo do agendamento (lista todos os serviços quando múltiplos)
- Booking salvo com `createdByAdmin: true` e entra no mesmo pipeline: agenda, Ficha de Cliente, estatísticas, check-in, survey e InfinitePay

### Serviços (Admin)
- Aba dedicada **🔧 Serviços** no painel administrativo
- Cadastrar, editar, excluir e ativar/desativar serviços sem tocar no código
- Campos: nome, ícone, categoria, descrição, dias extras, ativo/inativo
- **Preço de custo + preço de venda** por porte (carro pequeno e grande)
- **Margem calculada automaticamente** em R$ e percentual por serviço
- **Perguntas frequentes (FAQ)** por serviço: editor de Q&A no formulário de edição; seed de 9 serviços com perguntas realistas disponível com 1 clique
- Toggle ativo/inativo: remove da vitrine pública instantaneamente sem perder histórico
- Importar os 9 serviços padrão com 1 clique (seed inicial)
- Vitrine pública lê do Firebase em tempo real — mudanças aparecem no site sem redeploy
- Agendamentos existentes **não são afetados** por mudanças de preço (valor congelado no registro)

### Combos e Pacotes (Admin + Site)
- **Seção pública `#combos`** com cards mostrando preço regular vs. preço do combo e badge de economia
- Aba **Combos** no painel administrativo com CRUD completo (criar, editar, excluir, ativar/desativar)
- Preço do combo **calculado automaticamente** a partir dos serviços incluídos + desconto percentual configurável
- Combos inativos **não aparecem** na vitrine pública sem necessidade de redeploy

### Programa de Fidelidade e Cupons (Admin + Cliente)

**Pontos de fidelidade**
- Pontos concedidos automaticamente ao confirmar pagamento (`_awardPoints()`)
- Taxa configurável no painel admin: pontos por R$, valor de conversão, mínimo para resgate
- Admin pode **ajustar pontos manualmente** na ficha do cliente

**Cupons de desconto**
- CRUD completo de cupons em `/coupons` no Firebase, gerenciado pelo admin
- Validação em tempo real no step 3 do agendamento; desconto aplicado antes de salvar
- Cupom marcado como **usado** após aplicação (uso único ou múltiplo configurável)
- **Cupom de aniversário manual**: gerado com 1 clique na ficha do cliente (10% de desconto, válido até o dia 28 do mês seguinte) — envio automático via WhatsApp ao gerar
- **Cupom de aniversário automático**: Netlify Scheduled Function (`birthday-check.js`) roda todo dia às 09h00 BRT, detecta aniversariantes do dia, cria cupom no Firebase e envia e-mail personalizado via EmailJS

**Reativação de clientes inativos**
- Painel de inativos (>60 dias sem visita confirmada) com contagem de dias desde o último atendimento
- Botão **WhatsApp** com mensagem de reativação pré-formatada
- Botão para **gerar cupom personalizado** por cliente inativo direto do painel

### Indique um Amigo (Referral)
- Ao **concluir um serviço**, o cliente é convidado a indicar um amigo na tela de pesquisa de satisfação (e também em **Minha Conta**, para quem já tem atendimento concluído)
- Formulário coleta **nome, e-mail e telefone** do amigo; o benefício fica **explícito na tela e no e-mail** de indicação
- O **amigo indicado** recebe automaticamente por e-mail um **cupom de desconto** (padrão 15%) nominal ao seu e-mail, válido no primeiro serviço
- O amigo entra na base de clientes numa categoria **🌱 Oportunidade** (visível na aba **Clientes**, com origem "indicado por…")
- Quando o amigo **fecha o primeiro serviço** (booking `confirmed`/`completed`), quem indicou recebe **automaticamente** um **cupom de agradecimento** (padrão 15%) por e-mail
- Aba **🤝 Indicações** no painel admin: lista todas as indicações, status (aguardando/convertida), cupons gerados e **taxa de conversão**
- A criação do cupom do amigo + registro da indicação + e-mails rodam **server-side** na Netlify Function `create-referral` (usa o `FIREBASE_DATABASE_SECRET`, como o `birthday-check`), sem depender das regras de escrita do cliente
- Percentuais e validade configuráveis por variáveis de ambiente: `REFERRAL_FRIEND_PCT`, `REFERRAL_REFERRER_PCT`, `REFERRAL_VALID_DAYS` (padrões: 15 / 15 / 90 dias)

> **Regras do Realtime Database.** O nó `/referrals` deve ser **legível apenas pelo admin** (contém dados de contato de terceiros). O front carrega `/referrals` só no painel administrativo; a escrita é feita pela função server-side com o token do banco.

### Galeria Antes/Depois (Admin)
- Aba dedicada **📸 Galeria** no painel administrativo
- Upload de foto **ANTES** + foto **DEPOIS** diretamente pelo admin (máx 5 MB cada)
- Barra de progresso durante o upload
- Fotos armazenadas no **Firebase Storage**; URLs e legendas no Firebase Realtime DB
- Lista de comparações salvas com thumbnails e botão de remoção
- Galeria pública atualiza em tempo real após cada adição ou remoção, sem redeploy

### Ficha de Cliente
- **Agregação automática** de todos os agendamentos por e-mail
- **Busca rápida** por nome, e-mail ou telefone
- **Classificação automática**: Novo / Recorrente / VIP (≥ R$ 1.000 gastos ou ≥ 3 atendimentos)
- `lastVisit` calculado apenas com agendamentos concluídos (confirmed/approved/completed) — não considera datas futuras ou pendentes
- Cada ficha exibe 5 blocos:

| Bloco | Conteúdo |
|---|---|
| Identificação | Nome, telefone, e-mail, bairro, CEP, classificação |
| Frota de veículos | Modelo, placa + campo de observações por veículo (película, cor, histórico) |
| Histórico de atendimentos | Data, serviço, veículo, valor pago, status |
| Preferências e observações | Campo livre editável pelo atendente, salvo no Firebase |
| Resumo financeiro | Total gasto, primeiro e último atendimento, frequência média de retorno |

### Estatísticas e Análise Geográfica
- Cards de resumo: total de solicitações, receita projetada, ticket médio, taxa de retorno
- **Gráfico de receita mensal** (barras CSS puro, sem biblioteca externa) com seletor de ano — exibe receita confirmada mês a mês
- **Ranking de serviços mais vendidos** em gráfico de barras
- **Indicadores de fidelização**: taxa de retorno, ticket médio, taxa de aprovação
- **Mapa interativo de alcance** (OpenStreetMap via Leaflet, gratuito e sem API key):
  - Marcadores proporcionais ao número de clientes por bairro
  - Círculos de raio 5 km / 10 km / 15 km a partir do centro de São Paulo
  - Ranking de bairros com barra de participação percentual

### Notificações automáticas por WhatsApp (Cloud API)
Além do link `wa.me` manual, a loja envia **mensagens oficiais pelo WhatsApp Cloud API
da Meta**, saindo do número comercial, via `notify-booking.js` (helper `lib/core/whatsapp.js`).

- **Mensagens de template ao cliente** a cada evento: novo agendamento, reagendamento
  aprovado/recusado, cancelamento e correção de valor (best-effort — não bloqueia o fluxo)
- **Lembrete automático D-1**: `reminder-check.js` (Netlify Scheduled Function, 10h00 BRT)
  varre os agendamentos de amanhã com status ativo e dispara o template `lembrete_agendamento`,
  marcando `reminderSentAt` para não repetir
- **Webhook de entrada** (`whatsapp-webhook.js`): responde o handshake de verificação da Meta
  e encaminha as mensagens recebidas dos clientes para o **Telegram** do admin
- Nomes dos templates e idioma são configuráveis por variáveis de ambiente (`WA_TPL_*`,
  `WHATSAPP_TEMPLATE_LANG`). Passo a passo completo em **[`WHATSAPP_SETUP.md`](WHATSAPP_SETUP.md)**

### Central de IA (Admin + Site)
Camada de agentes de IA (Claude / Anthropic) orquestrada pela Netlify Function `ai.js`
(gatilho HTTP) e pela Scheduled Function `ai-dispatcher.js` (gatilho cron diário). Cada
agente tem **orçamento mensal de chamadas** e limite de tokens configuráveis, e
auto-desliga ao estourar o teto (avisa via Telegram).

- **Central de IA** no painel admin: liga/desliga agentes, define agenda (diária/semanal),
  acompanha consumo mensal (`aiUsage`) e logs (`aiLogs`)
- **Agentes admin** (exigem token do Firebase Auth do administrador): Relatório Semanal,
  Reativação de Inativos, Otimizador de Agenda, Análise de Satisfação, Descrição de
  Check-in, Legendas para Galeria, Ping (teste de conectividade)
- **Agentes públicos** (rate-limit por IP): **Chat Concierge** (widget de dúvidas e
  recomendação de serviços no site), **Orçamento por Foto** e **Sugestão de Complemento**
  (upsell no agendamento)
- O widget concierge do site consulta apenas `aiConfig/concierge/enabled` (leitura pública);
  todo o processamento de IA acontece server-side — a `ANTHROPIC_API_KEY` nunca chega ao navegador

### Gift Cards (Site + Admin)
- Compra de **vale-presente** pelo site com pagamento via InfinitePay
  (`create-gift-payment.js` gera o link; o webhook `infinitepay-webhook.js` ativa o cartão)
- Cada gift card tem **código único**, valor de face e saldo; ao ativar, o comprador recebe
  e-mail automático (EmailJS) com o código e instruções
- Aplicação do gift card no fluxo de agendamento; gestão (emissão/consulta) no painel admin
- Dados em `/giftcards` no Firebase (ativação pública por código, gestão restrita ao admin)

### Avaliações e Depoimentos (Cliente + Site + Admin)
- Após a conclusão, o cliente avalia o atendimento por **código de reserva** (survey)
- Avaliações ficam em `/feedback`; o admin **aprova** as que viram **depoimentos públicos**
  na vitrine do site
- Alertas de nota baixa via agente de IA **Análise de Satisfação** (Telegram)

### Controle de Estoque e Insumos (Admin)
- Cadastro de **itens de estoque** (`/stock`) e **receitas de consumo por serviço**
  (`/stockRecipes`) — quanto de cada insumo cada serviço consome
- Agente de IA **Previsão de Reposição** cruza a agenda com o estoque e alerta sobre itens
  prestes a acabar

### Configurações do sistema (admin)
- WhatsApp, endereço/local de entrega, horários de entrada e saída, máximo de agendamentos por dia
- Troca de senha administrativa
- Segurança do aparelho (abrir direto na tela de senha) e registro de push
- Limpeza total de dados

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript puro (sem frameworks) |
| Banco de dados | Firebase Realtime Database |
| Armazenamento de imagens | Firebase Storage (galeria antes/depois) |
| Autenticação | Firebase Auth (e-mail + senha) |
| Hosting | Netlify |
| Domínio | www.spcarclean.com.br (Registro.br + Netlify DNS) |
| Pagamento | InfinitePay (PIX + cartão) via Netlify Function |
| Inteligência Artificial | Claude API (Anthropic) via Netlify Functions (`ai` + `ai-dispatcher`) |
| Notificações | Netlify Functions + EmailJS + Telegram Bot API + WhatsApp Cloud API (Meta) |
| E-mail automático de aniversário | Netlify Scheduled Function (cron diário) + EmailJS REST API |
| Mapa | Leaflet.js + OpenStreetMap + Nominatim (geocoding) |
| Fontes | Google Fonts (Montserrat + Open Sans) |

---

## Configuração rápida

Todas as configurações do site ficam no bloco `CFG` dentro do `index.html`:

```js
const CFG = {
  whatsapp:    '11926697474',       // número para o botão WhatsApp
  location:    'São Paulo, SP',     // endereço exibido no site
  dropoffTime: '08:00',             // horário de entrada do veículo
  pickupTime:  '18:00',             // horário de saída
  adminEmail:  'seu@email.com',     // e-mail do administrador
  maxPerDay:   2,                   // máximo de agendamentos por dia
  pointsPerReal: 1,                 // pontos concedidos por R$ gasto
  pointsValue:   0.05,              // valor em R$ de cada ponto
  pointsMin:     100,               // mínimo de pontos para resgate
};
```

---

## Deploy

### Pré-requisitos
- Conta [Netlify](https://netlify.com) com repositório conectado
- Projeto [Firebase](https://console.firebase.google.com) com Realtime Database, Auth e Storage habilitados (plano Blaze)
- Domínio configurado no Registro.br apontando para o Netlify

### Variáveis de ambiente (Netlify)

| Variável | Descrição |
|---|---|
| `FIREBASE_API_KEY` | Chave de API do Firebase (obrigatória — injetada no build) |
| `FIREBASE_DATABASE_URL` | URL do Realtime Database, ex: `https://projeto-default-rtdb.firebaseio.com` |
| `FIREBASE_DATABASE_SECRET` | Token legado do Firebase (webhook InfinitePay + cron de aniversário). **Secreto** |
| `ADMIN_EMAIL` | E-mail do administrador — usado server-side pela função `ai` para validar o token do painel (padrão: `spcarclean0@gmail.com`) |
| `EMAILJS_SERVICE_ID` | ID do serviço no EmailJS |
| `EMAILJS_PUBLIC_KEY` | Chave pública do EmailJS |
| `EMAILJS_PRIVATE_KEY` | Chave privada do EmailJS (para envio server-side). **Secreto** |
| `EMAILJS_BIRTHDAY_TEMPLATE` | ID do template de e-mail de aniversário no EmailJS |
| `EMAILJS_GIFT_TEMPLATE` | ID do template de e-mail de ativação de gift card (opcional; usa `template_update` como fallback) |
| `TELEGRAM_BOT_TOKEN` | Token do bot de notificações via Telegram. **Secreto** |
| `TELEGRAM_CHAT_ID` | ID do chat para receber as notificações |
| `WHATSAPP_TOKEN` | Token de acesso do WhatsApp Cloud API (Meta). **Secreto** — ver [`WHATSAPP_SETUP.md`](WHATSAPP_SETUP.md) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número comercial do WhatsApp Cloud API |
| `WHATSAPP_VERIFY_TOKEN` | String que você inventa para o handshake do webhook da Meta. **Secreto** |
| `WHATSAPP_GRAPH_VERSION` | Versão da Graph API (opcional; ex.: `v21.0`) |
| `WHATSAPP_TEMPLATE_LANG` | Idioma dos templates (opcional; ex.: `pt_BR`) |
| `WA_TPL_NEW_BOOKING`, `WA_TPL_RESCHEDULE_APPROVED`, `WA_TPL_RESCHEDULE_REJECTED`, `WA_TPL_CANCEL`, `WA_TPL_PRICE`, `WA_TPL_REMINDER` | Nomes dos templates aprovados na Meta para cada evento (opcionais; têm padrão) |
| `INFINITEPAY_HANDLE` | InfiniteTag (usuário InfinitePay) para geração de links de pagamento |
| `INFINITEPAY_FEE_RATE` | Taxa a embutir no preço (padrão: `0.0315` = 3,15% crédito à vista) |
| `ANTHROPIC_API_KEY` | Chave da API Claude (Anthropic) — usada server-side pelos agentes da Central de IA. **Secreto** |
| `FIREBASE_VAPID_KEY` | Chave pública Web Push (certificado do Firebase Cloud Messaging) — injetada no build; habilita o registro de push no celular do admin |
| `FCM_SERVICE_ACCOUNT` | JSON (ou base64 do JSON) da service account do Firebase — usado **apenas server-side** pela função `notify-booking` para enviar os pushes. **Secreto: nunca commitar** |
| `REFERRAL_FRIEND_PCT` | (Opcional) % de desconto do cupom do amigo indicado no programa Indique um Amigo (padrão: `15`) |
| `REFERRAL_REFERRER_PCT` | (Opcional) % de desconto do cupom de recompensa para quem indicou (padrão: `15`) |
| `REFERRAL_VALID_DAYS` | (Opcional) Validade em dias dos cupons de indicação (padrão: `90`) |

> As variáveis marcadas **Secreto** nunca podem aparecer no front-end nem ser
> commitadas — só existem como variáveis de ambiente do Netlify e são lidas
> exclusivamente dentro das Netlify Functions. Apenas as chaves realmente públicas
> (`FIREBASE_API_KEY`, `FIREBASE_VAPID_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`)
> são injetadas no HTML — por isso constam no `SECRETS_SCAN_OMIT_KEYS` do `netlify.toml`.
> Os arquivos de documentação (`WHATSAPP_SETUP.md`, `DEPLOY_GUIDE.md`, etc.) citam nomes
> de variáveis em exemplos e **não** são publicados no site, então ficam em
> `SECRETS_SCAN_OMIT_PATHS` para não quebrarem o build.

### Firebase Realtime Database — regras de segurança

> **As regras agora são versionadas** em [`database.rules.json`](database.rules.json) e
> referenciadas no `firebase.json`. Publique-as com `firebase deploy --only database`
> (preferível — mantém Console e repositório em sincronia) ou cole o conteúdo do arquivo
> no Console. O bloco abaixo é uma cópia comentada; o arquivo versionado usa o e-mail real
> do admin em vez do placeholder `ADMIN_EMAIL`.

> **Privacidade dos agendamentos.** A coleção `bookings` **não** é mais legível
> publicamente (isso expunha nome, telefone, e-mail e bairro de todos os clientes).
> A disponibilidade do calendário vem do nó público `dayLoad` (só a lotação por dia,
> sem dado pessoal), mantido automaticamente pelo painel admin. **A leitura de
> `bookings/$id` deixou de ser pública (item 3b):** agora exige login e só o dono
> (`clientUid == auth.uid` ou `email == auth.token.email`) ou o admin conseguem ler —
> isso fecha a enumeração de códigos, inclusive os antigos. A **consulta por código
> sem login** passou a ser feita pela função server-side `booking-status`
> (código + e-mail, sem campos internos). O cliente logado vê o próprio histórico pelo
> índice `bookingIndex/$uid`.
>
> **Escrita protegida (item 2 do backlog).** Sem login, `bookings/$id` só aceita
> **criar** um agendamento ou as alterações self-service (reagendar/cancelar/feedback):
> valor, pagamento e identidade (`price`/`finalPrice`/`priceWithFee`/`paidAmount`/
> `paymentTransactionId`/`email`/`name`/`phone`/`createdAt`/`id`) são imutáveis e o
> `status` só pode virar `cancelled`. Admin (login) e webhook (Database Secret) escrevem
> tudo pela regra do pai.
>
> ⚠️ **Ordem de ativação:** (1) publique o site (com as regras antigas o calendário
> segue contando ao vivo, por fallback); (2) aplique as regras novas no Console;
> (3) **faça login como admin imediatamente** — é esse login que grava o `dayLoad`
> inicial. Entre os passos 2 e 3 o calendário público mostra os dias como disponíveis,
> então execute-os em sequência. Depois, no painel admin, rode **"Vincular
> agendamentos"** (Configurações) para indexar o histórico dos clientes logados.

```json
{
  "rules": {
    "bookings": {
      ".read":  "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      "$id": {
        ".read":  "auth != null && (auth.token.email == 'ADMIN_EMAIL' || data.child('clientUid').val() == auth.uid || data.child('email').val() == auth.token.email)",
        ".write": "(!data.exists() && newData.exists()) || (data.exists() && newData.exists() && newData.child('id').val() == data.child('id').val() && newData.child('createdAt').val() == data.child('createdAt').val() && newData.child('email').val() == data.child('email').val() && newData.child('name').val() == data.child('name').val() && newData.child('phone').val() == data.child('phone').val() && newData.child('price').val() == data.child('price').val() && newData.child('finalPrice').val() == data.child('finalPrice').val() && newData.child('priceWithFee').val() == data.child('priceWithFee').val() && newData.child('paidAmount').val() == data.child('paidAmount').val() && newData.child('paymentTransactionId').val() == data.child('paymentTransactionId').val() && newData.child('paymentConfirmedAt').val() == data.child('paymentConfirmedAt').val() && (newData.child('status').val() == data.child('status').val() || newData.child('status').val() == 'cancelled'))"
      }
    },
    "dayLoad":        { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "portfolio":      { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "bookingIndex": {
      "$uid": {
        ".read":  "auth != null && (auth.uid == $uid || auth.token.email == 'ADMIN_EMAIL')",
        ".write": "auth != null && (auth.uid == $uid || auth.token.email == 'ADMIN_EMAIL')"
      }
    },
    "blocked":        { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "config":         { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "services":       { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "combos":         { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "gallery":        { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "clientNotes":    { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "clientLinks":            { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "clientLinkDismissals":   { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "clientOverrides":        { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "coupons":        { ".read": true, ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "referrals":      { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "waitlist":       { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": true },
    "clientProfiles": {
      ".read":  "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    },
    "feedback": {
      ".read":  true,
      ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      ".indexOn": ["status"],
      "$id": { ".write": "newData.exists()" }
    },
    "giftcards": {
      ".read":  "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      "$code": {
        ".read":  true,
        ".write": "newData.exists()"
      }
    },
    "stock":           { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "stockRecipes":    { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "adminPushTokens": { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "aiConfig": {
      ".read":  "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'",
      "concierge": { "enabled": { ".read": true } }
    },
    "aiUsage":         { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "aiLogs":          { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" },
    "aiRateLimit":     { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'" }
  }
}
```

> As coleções `feedback` (envio de avaliação pelo cliente por código + vitrine pública
> de depoimentos aprovados), `giftcards` (compra/uso por código, gestão admin),
> `stock`/`stockRecipes` (estoque, admin) e `adminPushTokens` (push do painel) fazem
> parte do conjunto — **o Console nega qualquer caminho sem regra**, então o bloco
> acima deve ser aplicado sempre completo, nunca por partes.
>
> As coleções `aiConfig`, `aiUsage` e `aiLogs` alimentam a **Central de IA** do painel
> admin (config dos agentes, consumo mensal e logs). Sem elas o painel quebra com
> `permission_denied at /aiConfig`. A exceção `aiConfig/concierge/enabled` fica com
> leitura pública porque o **widget concierge** do site consulta esse caminho sem login.
> As funções Netlify escrevem esses nós via Admin SDK (ignoram estas regras).

### Firebase Storage — regras de segurança

> **Versionadas** em [`storage.rules`](storage.rules) e referenciadas no `firebase.json`.
> Publique com `firebase deploy --only storage` (ou cole no Console). O bloco abaixo é
> uma cópia do arquivo versionado.

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /gallery/{file} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /checkin/{allPaths=**} {
      allow read: if request.auth != null;   // item 7: bloqueia acesso por caminho bruto; URLs com ?token continuam abrindo
      allow write: if request.auth != null;
    }
  }
}
```

### App instalável (PWA) e notificações push

O site é um **PWA**: admin e cliente podem instalá-lo na tela inicial do celular
("Adicionar à tela de início" no iPhone, "Instalar app" no Android/desktop) e abri-lo
em tela cheia, como um app nativo — sem loja de aplicativos.

Arquivos que compõem o PWA:

| Arquivo | Papel |
|---|---|
| `manifest.webmanifest` | Nome, ícones, cor de tema, `display: standalone` e atalhos (Admin / Agendar) |
| `sw.js` | Service worker de cache offline (network-first no HTML, stale-while-revalidate nos assets) |
| `firebase-messaging-sw.js` | Service worker do Firebase Cloud Messaging — recebe push com o app fechado |

**Notificações push do admin** (novo agendamento, reagendamento, cancelamento, etc.)
chegam direto no celular, além do Telegram. Para habilitar:

1. No **Firebase Console → Cloud Messaging**, gere um **par de chaves Web Push** e copie
   a chave pública para a env `FIREBASE_VAPID_KEY` (Netlify). Sem ela, o app funciona
   normalmente, apenas sem push.
2. Baixe uma **service account** (Configurações do projeto → Contas de serviço → Gerar
   nova chave privada) e cole o JSON na env `FCM_SERVICE_ACCOUNT` (aceita JSON puro ou
   base64). Essa chave é **secreta** — só é lida server-side pela função `notify-booking`.
3. Adicione a regra do Realtime Database abaixo. O admin registra o token do dispositivo
   ao fazer login; a função lê os tokens via REST (Database Secret) e envia o push.

```json
"adminPushTokens": {
  ".read":  "auth != null && auth.token.email == 'ADMIN_EMAIL'",
  ".write": "auth != null && auth.token.email == 'ADMIN_EMAIL'"
}
```

O admin ativa o push tocando em **📲 Instalar app** e aceitando as notificações no
primeiro login pelo celular.

#### O app do admin abre direto na tela de senha

Abrir o app instalado cai **direto na tela de senha do painel**, em tela cheia — sem
passar pelo site, **já na primeira abertura**. O app é o painel de gestão: o botão
**📲 Instalar app** só aparece dentro do painel.

1. Abriu o app → tela de senha. Se a sessão do Firebase ainda estiver válida, exibe
   *"Verificando sessão…"* por um instante e entra no painel **sem pedir a senha**.
2. Um login de admin marca o aparelho como sendo da gestão
   (`localStorage` → `spcc.adminDevice`).
3. Sair do painel dentro do app volta para a tela de senha, não para o site.

Quem instalou o app sem ser da gestão tem o link **Ver o site** na própria tela de
senha. Num aparelho que **nunca** fez login de admin, esse link também marca
`spcc.appSiteOnly` — dali em diante o app abre no site, como um visitante. Num
aparelho da gestão o link é só uma saída pontual: o app continua abrindo no painel.

Outros detalhes:

- Para ligar/desligar num aparelho: **Painel → Configurações → Segurança → 📱 Este
  aparelho**, na opção *"Abrir direto na tela de senha"*.
- O atalho **Painel Admin** do app (`/?admin`) abre a mesma tela em qualquer aparelho,
  sem marcá-lo. No navegador comum, `/?admin` abre o modal de senha sobre o site.
- Nada disso depende de rede: os marcadores ficam em `localStorage`, por aparelho.

### Build

```bash
# Variável obrigatória para build local
FIREBASE_API_KEY=AIzaSy... node build.js

# Serve a pasta dist localmente
npx serve dist
```

O build injeta a `FIREBASE_API_KEY` no HTML e copia os assets para `dist/`. O deploy em produção é **automático** a cada `git push` na branch `main`.

---

## Estrutura do projeto

```
sp-car-clean/
├── index.html                   # Aplicação completa (site público + painel admin)
├── build.js                     # Script de build — injeta variáveis de ambiente
├── manifest.webmanifest         # Manifesto do PWA (app instalável)
├── sw.js                        # Service worker de cache offline
├── firebase-messaging-sw.js     # Service worker de push (Firebase Cloud Messaging)
├── package.json
├── netlify.toml                 # Config Netlify (build, publish, functions, cron)
├── firebase.json                # Config Firebase (hosting + regras de Database e Storage)
├── database.rules.json          # Regras de segurança do Realtime Database (versionadas)
├── storage.rules                # Regras de segurança do Firebase Storage (versionadas)
├── assets/
│   ├── logo.png                 # Logo oficial (PNG com fundo transparente)
│   └── portfolio/               # Imagens e vídeos do carrossel hero
└── netlify/
    └── functions/
        ├── notify-booking.js        # Notifica admin (Telegram + push FCM) e cliente (WhatsApp)
        ├── create-payment.js        # Gera link de pagamento InfinitePay (agendamento)
        ├── create-gift-payment.js   # Gera link de pagamento InfinitePay (gift card)
        ├── infinitepay-webhook.js   # Confirma pagamento/ativa gift card e atualiza Firebase
        ├── booking-status.js        # Consulta de status por código + e-mail (leitura server-side)
        ├── whatsapp-webhook.js      # Webhook do WhatsApp Cloud API (verificação + mensagens → Telegram)
        ├── birthday-check.js        # Cron diário: detecta aniversariantes, cria cupom e envia e-mail
        ├── reminder-check.js        # Cron diário: lembrete D-1 por WhatsApp ao cliente
        ├── ai.js                    # Orquestrador HTTP dos agentes de IA (admin + públicos)
        ├── ai-dispatcher.js         # Cron diário: dispara agentes de IA agendados
        └── lib/
            ├── fcm.js               # Helper de envio de push (OAuth2 + FCM HTTP v1)
            ├── guard.js             # Rate-limit por IP + checagem de origem (CORS) das funções públicas
            ├── agents/              # Agentes de IA (concierge, relatorio, upsell, orcamento, …)
            └── core/                # Núcleo (claude, firebase, telegram, email, whatsapp, config, logger)
```

> Docs de setup complementares na raiz: **`WHATSAPP_SETUP.md`** (WhatsApp Cloud API),
> `DEPLOY_GUIDE.md`, `INSTAGRAM_SETUP.md`.

---

## Roadmap

| Funcionalidade | Status |
|---|---|
| Vitrine de serviços + agendamento em 4 etapas | ✅ |
| Calendário interativo com bloqueio de datas | ✅ |
| Código de rastreamento único por agendamento | ✅ |
| Consulta de status self-service | ✅ |
| Reagendamento self-service | ✅ |
| Cancelamento self-service com política de reembolso | ✅ |
| Confirmação automática por e-mail | ✅ |
| Notificação em tempo real via Telegram | ✅ |
| Painel admin completo | ✅ |
| Ficha de cliente com histórico e frota | ✅ |
| Classificação automática VIP / Recorrente | ✅ |
| Mapa de alcance geográfico por bairro | ✅ |
| Observações por veículo (película, cor, histórico) | ✅ |
| Estatísticas de receita e fidelização | ✅ |
| Gráfico de receita mensal por ano | ✅ |
| Pagamento online via InfinitePay (PIX + cartão) | ✅ |
| Galeria antes/depois com slider interativo | ✅ |
| Gestão da galeria pelo painel admin | ✅ |
| Domínio customizado (www.spcarclean.com.br) | ✅ |
| CRUD de serviços com preços e margens pelo admin | ✅ |
| Exclusão individual de agendamentos de teste | ✅ |
| Conta do cliente com login e histórico | ✅ |
| Combos e pacotes com desconto + sugestão inteligente | ✅ |
| Programa de pontos de fidelidade | ✅ |
| Cupons de desconto com CRUD pelo admin | ✅ |
| Cupom de aniversário (1 clique + envio WhatsApp automático) | ✅ |
| Cupom de aniversário automático por e-mail (cron diário) | ✅ |
| Painel de reativação de clientes inativos | ✅ |
| Lista de espera para dias esgotados | ✅ |
| FAQ por serviço com modal dedicado | ✅ |
| Check-in do veículo com fotos e notificação ao cliente | ✅ |
| Cancelamento bloqueado pelo admin após check-in (somente reagendar retirada) | ✅ |
| Agendamento manual pelo admin (presencial / WhatsApp / telefone) | ✅ |
| Múltiplos serviços por agendamento manual com total calculado automaticamente | ✅ |
| Registro histórico com data retroativa e status "Concluído" direto | ✅ |
| App instalável na tela inicial (PWA) — admin e cliente | ✅ |
| Notificações push no celular do admin (Firebase Cloud Messaging) | ✅ |
| App do admin abrindo direto na tela de senha do painel (sem passar pelo site) | ✅ |
| Central de IA com agentes (concierge, relatório, reativação, upsell, etc.) | ✅ |
| Chat Concierge público no site | ✅ |
| Orçamento por foto (IA) | ✅ |
| Gift cards (compra online + ativação por webhook) | ✅ |
| Avaliações do cliente + depoimentos aprovados na vitrine | ✅ |
| Controle de estoque/insumos com previsão de reposição (IA) | ✅ |
| Notificações automáticas ao cliente por WhatsApp Cloud API | ✅ |
| Lembrete automático D-1 do agendamento por WhatsApp | ✅ |
| Webhook de WhatsApp (mensagens do cliente → Telegram do admin) | ✅ |

---

## Backlog de melhorias

Itens abaixo estão **em aberto** — priorizados por impacto. A ênfase atual é
**segurança do backend**, já que o app move pagamentos e dados pessoais de clientes.

### ✅ Concluído

| # | Item | Onde | O que foi feito |
|---|---|---|---|
| 1 | **Webhook de pagamento sem verificação** | `netlify/functions/infinitepay-webhook.js` | O corpo do webhook deixou de ser confiável: antes de confirmar um agendamento ou ativar um gift card, a função consulta o endpoint oficial `POST payment_check` do InfinitePay (autenticado pelo nosso `handle`) e só prossegue se `paid === true`. Confere também o valor pago contra o valor esperado do pedido (`priceWithFee`/`amount`) e faz **fail-closed** — se não conseguir verificar, devolve erro para o InfinitePay reenviar em vez de confirmar às cegas. |
| 2 | **Regra RTDB permitia sobrescrever qualquer agendamento** | `database.rules.json` (`bookings/$id`) | A escrita pública passou de `newData.exists()` (qualquer alteração) para: **criar** um agendamento, ou fazer só as alterações self-service (reagendar/cancelar/feedback). Campos de valor, pagamento e identidade (`price`, `finalPrice`, `priceWithFee`, `paidAmount`, `paymentTransactionId`, `email`, `name`, `phone`, `createdAt`, `id`) ficaram imutáveis sem login, e o `status` só pode ir para `cancelled` — nunca para `approved`/`confirmed`/`completed`. Regra validada com 15 casos (targaryen). |
| 4 | **Regras de segurança não versionadas** | `database.rules.json`, `storage.rules`, `firebase.json` | As regras do Realtime Database e do Storage viviam só neste README (colar manual no Console, sem histórico nem revisão). Agora são **versionadas** em `database.rules.json` e `storage.rules`, referenciadas no `firebase.json`, e publicáveis com `firebase deploy --only database,storage`. (As regras do Storage foram versionadas sem alterar comportamento na época; a leitura de `checkin/**` foi endurecida depois, no item 7.) |
| 3 | **Códigos de reserva/gift card curtos e previsíveis** | `index.html` (`genId`, `genGiftId`) | Os códigos passaram de 6 caracteres gerados com `Math.random()` (`SPC-` ≈ 10⁹, não-criptográfico) para **10 caracteres via CSPRNG** (`crypto.getRandomValues`), num alfabeto de 32 sem ambíguos → **32¹⁰ ≈ 1,1×10¹⁵** combinações. Inviabiliza enumeração/brute force para os **novos** agendamentos e gift cards. Mesma correção aplicada ao `genGiftId`. |
| 3b | **Leitura pública expunha o agendamento inteiro (inclui enumeração de códigos antigos)** | `database.rules.json` (`bookings/$id .read`), `netlify/functions/booking-status.js`, `index.html` | `bookings/$id .read` deixou de ser `true`: agora exige login e só o dono (`clientUid == auth.uid` ou `email == auth.token.email`) ou o admin leem — fecha a enumeração, **inclusive dos códigos antigos**. A consulta sem login passou para a função server-side `booking-status` (exige **código + e-mail**, devolve só ao dono verificado, com rate-limit por IP e resposta genérica anti-oráculo). Regra e função validadas (8 + 7 casos). |
| 7 | **Fotos de check-in com leitura pública** | `storage.rules` (`checkin/**`) | A leitura de `checkin/**` passou de `if true` para `if request.auth != null`: o acesso por **caminho bruto** deixou de ser público (bloqueia raspagem/enumeração do bucket). As miniaturas continuam abrindo para o cliente porque o app usa a URL de download com `?token=` (gerada pelo admin no upload) — esse token funciona independentemente das regras, inclusive para o cliente deslogado (link por e-mail/WhatsApp). `gallery/` segue pública (vitrine). |
| 5 | **Funções de pagamento/notificação sem auth nem rate-limit** | `netlify/functions/lib/guard.js` (novo), `create-payment.js`, `create-gift-payment.js`, `notify-booking.js` | Helper `guard.js` adiciona **rate-limit por IP** + **checagem de origem (CORS)** às três funções públicas (corta geração de links e disparo de notificações/WhatsApp em massa por terceiros — incluindo abuso do número oficial de WhatsApp). Além disso, `create-payment` e `create-gift-payment` passaram a ler o **valor no Firebase** (preço do agendamento / valor do gift card) em vez de confiar no valor enviado pelo cliente; o webhook (item 1) ainda revalida o valor pago. Validado (8 casos). |
| 6 | **Rate-limit dos agentes de IA públicos era só em memória** | `ai.js`, `ai-dispatcher.js`, `database.rules.json` (`aiRateLimit`) | Além do rate-limit em memória (por instância), o `ai.js` agora faz um rate-limit **persistente e compartilhado** entre instâncias: contador por hora e por IP no Realtime Database via **incremento atômico** (`{".sv":{"increment":1}}`), escrito com o Database Secret. **Fail-open** se o DB não responder (os tetos de orçamento por agente seguem valendo). O `ai-dispatcher` limpa diariamente os buckets antigos. Validado (21ª chamada do mesmo IP → 429). |
| 8 | **Código Firestore legado removido** | `functions/`, `firestore.rules`, `functions/lib/syncClient.js` | O conjunto Firestore (Cloud Function `syncClientFromBooking` + regras) não correspondia à arquitetura atual (Realtime Database) e não era referenciado por `firebase.json`/`netlify.toml`/app — código morto. **Removido** para eliminar a confusão (regras que não eram aplicadas, etc.). |
| 9 | **Log de debug versionado** | `firebase-debug.log`, `.gitignore` | `firebase-debug.log` (artefato do `firebase init`) **removido** do repositório e adicionado ao `.gitignore`. |
| 11 | **Cliente só conseguia cadastrar 1 veículo em "Minha Conta"** | `index.html` (`_profileVehicles`) | Causa provável: o Realtime Database devolvia o array `vehicles` como objeto `{0:…,1:…}`, e `Array.isArray()` falhava → o app caía no fallback de 1 veículo (`primaryVehicle`) em 3 telas. Novo helper `_profileVehicles(profile)` aceita **array ou objeto** (e só cai no `primaryVehicle` quando não há lista), usado nas 3 leituras (resumo da conta, form de dados cadastrais, prefill do agendamento). Validado (6 casos). |
| 12 | **Destacar pacotes/combos na seleção de serviços** | `index.html` (`renderBookingStep`, step 1) | No passo 1 do agendamento (só carro — combos usam porte pq/gr), um bloco destacado **"🎁 Pacotes com desconto"** lista os combos públicos ativos com preço regular vs. combo + economia e um botão **"Escolher pacote"** que adiciona os serviços do combo ao agendamento (`applyComboSuggestion`). Estimula a compra de pacotes no momento da escolha. |
| 13 | **Pesquisa + indicação por WhatsApp ao concluir (manual, na hora)** | `index.html` (`markCompleted`; deep-link `?indicar=1`) | Ao marcar como **concluído**, além do e-mail automático da pesquisa, o admin recebe a opção de **abrir o WhatsApp já preenchido** com a **pesquisa** (`?avaliar=CODE`) + o **convite de indicação** (link `?indicar=1`) num texto só, citando o desconto de 15%. O `?indicar=1` é o novo **link de indicação compartilhável** que abre o modal "Indique um amigo" (programa de indicação que já existia — cupom 15% para amigo e para quem indica). |

### ⚪ Descartado (por design)

| # | Item | Decisão |
|---|---|---|
| 3c | **Tornar `adminNotes` um campo só-admin** | Descartado: o `adminNotes` é, por design, uma observação que o admin **compartilha com o cliente** (aparece como "Nota" na consulta de status e como "Obs" no WhatsApp de aprovação). Não é um segredo interno, então não há o que esconder. Com o item 3b, quem lê já é só o dono verificado (não mais qualquer um com o código). |

### 🟡 Débito técnico / organização

| # | Item | Onde | Observação |
|---|---|---|---|
| 10 | **`index.html` monolítico (~540 KB)** | `index.html` | Site público + painel admin no mesmo arquivo dificultam manutenção e revisão. Avaliar separação/módulos a médio prazo. |

---

## Licença

Projeto privado — todos os direitos reservados à SP Car Clean.
