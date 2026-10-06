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
- **Avisos no celular** (push) a cada mudança do serviço: orçamento aprovado, pagamento confirmado, reagendamento, check-in, conclusão, cancelamento
- **Adicionar à agenda**: botões **Google Agenda** e **Apple / Outlook (.ics)** na confirmação, na consulta por código e em Minha Conta, e **🔁 Agenda sempre atualizada** — o cliente assina a agenda "SP Car Clean — meus agendamentos", que se atualiza sozinha (ver [Google Agenda](#google-agenda))
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
- Fotos armazenadas no **S3 da AWS** (`media/checkin/{bookingId}/`, nome aleatório — servidas pelo CloudFront em `/media/…`)
- Ao finalizar: envia **e-mail** (template_update), **push no celular do cliente** (se ele ativou os avisos) e abre **WhatsApp** com o resumo completo
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
- **Notificação em tempo real via Telegram e push no celular** a cada novo agendamento, reagendamento ou cancelamento
- **Avisos diários no celular** (07h30): serviços com entrega nos próximos dias e produtos abaixo do mínimo no estoque
- **Google Agenda**: todos os agendamentos aparecem sozinhos na agenda do Google do admin a cada 5 min, por um Google Apps Script grátis (ver [Google Agenda](#google-agenda))
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
- **Cupom de aniversário automático**: cron diário na AWS (`birthday-check.js`, EventBridge Scheduler) roda todo dia às 09h00 BRT, detecta aniversariantes do dia, cria cupom no Firebase e envia e-mail personalizado via EmailJS

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
- A criação do cupom do amigo + registro da indicação + e-mails rodam **server-side** na função `create-referral` (usa o `FIREBASE_DATABASE_SECRET`, como o `birthday-check`), sem depender das regras de escrita do cliente
- Percentuais e validade configuráveis por variáveis de ambiente: `REFERRAL_FRIEND_PCT`, `REFERRAL_REFERRER_PCT`, `REFERRAL_VALID_DAYS` (padrões: 15 / 15 / 90 dias)

> **Regras do Realtime Database.** O nó `/referrals` deve ser **legível apenas pelo admin** (contém dados de contato de terceiros). O front carrega `/referrals` só no painel administrativo; a escrita é feita pela função server-side com o token do banco.

### Galeria Antes/Depois (Admin)
- Aba dedicada **📸 Galeria** no painel administrativo
- Upload de foto **ANTES** + foto **DEPOIS** diretamente pelo admin (máx 5 MB cada)
- Barra de progresso durante o upload
- Fotos armazenadas no **S3 da AWS** (`media/gallery/`, upload direto do navegador com URL pré-assinada); URLs e legendas no Firebase Realtime DB
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

### Lembrete automático D-1 (e-mail)
`reminder-check.js` (cron diário na AWS, 10h00 BRT) varre os agendamentos de amanhã com
status ativo e envia um lembrete por e-mail (EmailJS), marcando `reminderSentAt` para não
repetir. As mensagens ao cliente por WhatsApp são enviadas pelo admin via link `wa.me`
(integrações com a API da Meta foram removidas — ver [Backlog](#-backlog--integrações-meta-removidas)).

### Central de IA (Admin + Site)
Camada de agentes de IA (Claude / Anthropic) orquestrada pela função `ai.js`
(gatilho HTTP) e pela função `ai-dispatcher.js` (cron diário na AWS). Cada
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
- **Push diário no celular do admin** (07h30, `admin-alerts`) com os produtos abaixo do
  mínimo cadastrado

### Configurações do sistema (admin)
- WhatsApp, endereço/local de entrega, horários de entrada e saída, máximo de agendamentos por dia
- Troca de senha administrativa
- Segurança do aparelho (abrir direto na tela de senha) e registro de push
- **Google Agenda**: link do script da agenda do admin (e link `.ics` para iPhone/Outlook)
- Limpeza total de dados

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript puro (sem frameworks) |
| Banco de dados | Firebase Realtime Database |
| Armazenamento de imagens e vídeos | AWS S3 (bucket de mídia) + CloudFront em `/media/*` — galeria, carrossel e fotos do check-in |
| Autenticação | Firebase Auth (e-mail + senha) |
| Hosting | AWS S3 + CloudFront |
| Backend | AWS Lambda + API Gateway (HTTP API), segredos no SSM Parameter Store, crons no EventBridge Scheduler |
| Infra como código | Terraform (`infra/`), estado em S3 versionado |
| Domínio | spcarclean.com.br (Registro.br + Route 53, certificado ACM) |
| Pagamento | InfinitePay (PIX + cartão) via funções no Lambda |
| Inteligência Artificial | Claude API (Anthropic) via funções no Lambda (`ai` + `ai-dispatcher`) |
| Notificações | AWS Lambda + EmailJS + Telegram Bot API + Web Push padrão (VAPID, sem Firebase) para o admin **e para os clientes** |
| Agenda | Google Apps Script na conta do admin (lê o feed `calendar-sync` a cada 5 min) + agenda `.ics` assinada pelo cliente — sem Google Cloud nem cartão |
| App instalável | 2 PWAs: **app do cliente** (`manifest.webmanifest`) e **app da gestão** (`admin.webmanifest`) |
| E-mail automático de aniversário | Cron diário na AWS (EventBridge Scheduler → Lambda) + EmailJS REST API |
| Mapa | Leaflet.js + OpenStreetMap + Nominatim (geocoding) |
| Fontes | Google Fonts (Montserrat + Open Sans) |

---

## Configuração rápida

Todas as configurações do site ficam no bloco `CFG` no início do `app.js`
(WhatsApp, endereço, horários e lotação também podem ser alterados pelo painel, em Configurações):

```js
const CFG = {
  whatsapp: '11926697474',                 // número para o botão WhatsApp
  location: 'Rua São José, 301 — Parque Santo Antônio, Guarulhos-SP', // endereço exibido no site
  dropoffTime: '08:00',                    // horário de entrada do veículo
  pickupTime: '18:00',                     // horário de saída
  adminEmail: 'spcarclean0@gmail.com',     // e-mail (login) do administrador
  maxPerDay: 2,                            // máximo de agendamentos por dia
  pointsPerReal: 1,                        // pontos por R$1 gasto
  pointsToReal: 0.10,                      // 1 ponto = R$0,10 de desconto
  minPointsRedeem: 50,                     // mínimo de pontos para resgatar
};
```

> **E-mail do admin: `spcarclean0@gmail.com`.** É o login do painel (o app entra só com a
> senha, nesse e-mail), o e-mail que recebe os avisos internos e o dono da agenda do Google
> sincronizada. Aparece também nas regras do Realtime Database (`database.rules.json`), no
> `ADMIN_EMAIL` das funções e em `functions/lib/admin-auth.js`. Para trocar, mude **todos**
> esses pontos juntos e crie antes a conta nova no Firebase Auth — senão o painel fica
> inacessível.

---

## Deploy

### Pré-requisitos
- Conta AWS com a infraestrutura de `infra/` aplicada (passo a passo em **[`infra/README.md`](infra/README.md)**)
- Projeto [Firebase](https://console.firebase.google.com) com Realtime Database e Auth habilitados (o Storage não é mais usado — fotos e vídeos ficam no S3)
- Domínio no Registro.br com os nameservers do Route 53

Cada merge na `main` publica **funções e site** pelo GitHub Actions (`.github/workflows/deploy-aws.yml`).
Função nova em `functions/` ou recurso novo na AWS exige `terraform apply` **antes** do merge
(ver [`infra/README.md`](infra/README.md)) — é o caso desta versão (bucket de mídia, `upload-url`,
`notify-client`, `calendar-sync`, `admin-alerts`).

### Variáveis de ambiente (SSM Parameter Store)

Os segredos das funções ficam em `/sp-car-clean/<NOME>` no SSM (região `sa-east-1`) e são
gravados com `scripts/aws-put-secrets.sh`. As chaves públicas usadas no build
(`FIREBASE_API_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`) ficam nos
**Secrets do GitHub Actions**.

| Variável | Descrição |
|---|---|
| `FIREBASE_API_KEY` | Chave de API do Firebase (obrigatória — injetada no build) |
| `FIREBASE_DATABASE_URL` | URL do Realtime Database, ex: `https://projeto-default-rtdb.firebaseio.com` |
| `FIREBASE_DATABASE_SECRET` | Token legado do Firebase (webhook InfinitePay + cron de aniversário). **Secreto** |
| `ADMIN_EMAIL` | E-mail do administrador — usado server-side para validar o token do painel (funções `ai`, `push-subscription`, `upload-url`, `notify-client`, `calendar-sync`). Padrão: `spcarclean0@gmail.com` |
| `EMAILJS_SERVICE_ID` | ID do serviço no EmailJS |
| `EMAILJS_PUBLIC_KEY` | Chave pública do EmailJS |
| `EMAILJS_PRIVATE_KEY` | Chave privada do EmailJS (para envio server-side). **Secreto** |
| `EMAILJS_BIRTHDAY_TEMPLATE` | ID do template de e-mail de aniversário no EmailJS |
| `EMAILJS_GIFT_TEMPLATE` | ID do template de e-mail de ativação de gift card (opcional; usa `template_update` como fallback) |
| `TELEGRAM_BOT_TOKEN` | Token do bot de notificações via Telegram. **Secreto** |
| `TELEGRAM_CHAT_ID` | ID do chat para receber as notificações |
| `INFINITEPAY_HANDLE` | InfiniteTag (usuário InfinitePay) para geração de links de pagamento |
| `INFINITEPAY_FEE_RATE` | Taxa a embutir no preço (padrão: `0.0315` = 3,15% crédito à vista) |
| `ANTHROPIC_API_KEY` | Chave da API Claude (Anthropic) — usada server-side pelos agentes da Central de IA. **Secreto** |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Chave privada VAPID do push do admin. **Criada pelo Terraform** (`infra/push.tf`) — não gravar à mão. **Secreto** |
| `REFERRAL_FRIEND_PCT` | (Opcional) % de desconto do cupom do amigo indicado no programa Indique um Amigo (padrão: `15`) |
| `REFERRAL_REFERRER_PCT` | (Opcional) % de desconto do cupom de recompensa para quem indicou (padrão: `15`) |
| `REFERRAL_VALID_DAYS` | (Opcional) Validade em dias dos cupons de indicação (padrão: `90`) |
| `CALENDAR_FEED_SECRET` | (Opcional) Chave que assina os links da agenda (admin e clientes). Sem ela, deriva do segredo do CloudFront. Trocar invalida todos os links já entregues. **Secreto** |
| `ADMIN_ALERT_DAYS` | (Opcional) Quantos dias à frente o aviso diário de entregas olha (padrão: `2`) |

> `MEDIA_BUCKET` e `MEDIA_BASE_URL` (bucket de mídia e endereço `https://<site>/media`) são
> definidos pelo Terraform direto no Lambda — não vão no SSM.

> As variáveis marcadas **Secreto** nunca podem aparecer no front-end nem ser
> commitadas — só existem no SSM Parameter Store (criptografadas) e são lidas
> exclusivamente pelas funções no Lambda. Apenas as chaves realmente públicas
> (`FIREBASE_API_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`)
> são injetadas no HTML pelo `build.js`.

### Firebase Realtime Database — regras de segurança

> **As regras agora são versionadas** em [`database.rules.json`](database.rules.json) e
> referenciadas no `firebase.json`. Publique-as com `firebase deploy --only database`
> (preferível — mantém Console e repositório em sincronia) ou cole o conteúdo do arquivo
> no Console. O bloco abaixo é uma cópia do arquivo versionado, com o e-mail do admin
> (`spcarclean0@gmail.com`).

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
      ".read":  "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      "$id": {
        ".read":  "auth != null && (auth.token.email == 'spcarclean0@gmail.com' || data.child('clientUid').val() == auth.uid || data.child('email').val() == auth.token.email)",
        ".write": "(!data.exists() && newData.exists()) || (data.exists() && newData.exists() && newData.child('id').val() == data.child('id').val() && newData.child('createdAt').val() == data.child('createdAt').val() && newData.child('email').val() == data.child('email').val() && newData.child('name').val() == data.child('name').val() && newData.child('phone').val() == data.child('phone').val() && newData.child('price').val() == data.child('price').val() && newData.child('finalPrice').val() == data.child('finalPrice').val() && newData.child('priceWithFee').val() == data.child('priceWithFee').val() && newData.child('paidAmount').val() == data.child('paidAmount').val() && newData.child('paymentTransactionId').val() == data.child('paymentTransactionId').val() && newData.child('paymentConfirmedAt').val() == data.child('paymentConfirmedAt').val() && (newData.child('status').val() == data.child('status').val() || newData.child('status').val() == 'cancelled'))"
      }
    },
    "dayLoad":        { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "portfolio":      { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "bookingIndex": {
      "$uid": {
        ".read":  "auth != null && (auth.uid == $uid || auth.token.email == 'spcarclean0@gmail.com')",
        ".write": "auth != null && (auth.uid == $uid || auth.token.email == 'spcarclean0@gmail.com')"
      }
    },
    "blocked":        { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "config":         { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "services":       { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "combos":         { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "gallery":        { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "clientNotes":    { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "clientLinks":            { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "clientLinkDismissals":   { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "clientOverrides":        { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "coupons":        { ".read": true, ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "referrals":      { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "waitlist":       { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": true },
    "clientProfiles": {
      ".read":  "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    },
    "feedback": {
      ".read":  true,
      ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      ".indexOn": ["status"],
      "$id": { ".write": "newData.exists()" }
    },
    "giftcards": {
      ".read":  "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      "$code": {
        ".read":  true,
        ".write": "newData.exists()"
      }
    },
    "stock":           { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "stockRecipes":    { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "adminPushTokens": { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "aiConfig": {
      ".read":  "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'",
      "concierge": { "enabled": { ".read": true } }
    },
    "aiUsage":         { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "aiLogs":          { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" },
    "aiRateLimit":     { ".read": "auth != null && auth.token.email == 'spcarclean0@gmail.com'", ".write": "auth != null && auth.token.email == 'spcarclean0@gmail.com'" }
  }
}
```

> As coleções `feedback` (envio de avaliação pelo cliente por código + vitrine pública
> de depoimentos aprovados), `giftcards` (compra/uso por código, gestão admin),
> `stock`/`stockRecipes` (estoque, admin) e `adminPushTokens` (push antigo, sem uso desde a troca para Web Push) fazem
> parte do conjunto — **o Console nega qualquer caminho sem regra**, então o bloco
> acima deve ser aplicado sempre completo, nunca por partes.
>
> As coleções `aiConfig`, `aiUsage` e `aiLogs` alimentam a **Central de IA** do painel
> admin (config dos agentes, consumo mensal e logs). Sem elas o painel quebra com
> `permission_denied at /aiConfig`. A exceção `aiConfig/concierge/enabled` fica com
> leitura pública porque o **widget concierge** do site consulta esse caminho sem login.
> As funções do backend escrevem esses nós via Admin SDK (ignoram estas regras).

### Fotos e vídeos (S3)

Fotos da galeria antes/depois, fotos e vídeos do carrossel "Nossas Obras" e fotos do
check-in ficam no **bucket de mídia da AWS** (`infra/media.tf`), servido pelo mesmo
CloudFront do site em `https://www.spcarclean.com.br/media/...`. O **Firebase Storage não é
mais usado**.

- **Upload:** o painel pede uma URL pré-assinada à função `upload-url` (só com login de
  admin; aceita imagens até 5 MB e vídeos até 30 MB) e envia o arquivo direto do navegador
  para o bucket (`PUT`). A URL pública volta para o Realtime Database como antes.
- **Pastas:** `media/gallery/` (vitrine pública) e `media/checkin/{código}/` (nome com
  sufixo aleatório: a URL não é adivinhável, como era o `?token=` do Firebase).
- **Segurança:** bucket privado, sem listagem; só o CloudFront lê e só a role das funções
  grava. Versionado (versões antigas expiram em 90 dias).

#### Migração do que estava no Firebase Storage

Uma vez só, depois do deploy desta versão, no CloudShell (o script lê
`FIREBASE_DATABASE_URL` e `FIREBASE_DATABASE_SECRET` do SSM e descobre o bucket sozinho):

```bash
cd ~/sp_car_clean
node scripts/migrate-media.js            # simulação: lista o que seria migrado
node scripts/migrate-media.js --apply    # copia para o S3 e troca os links no banco
```

O script varre o banco inteiro atrás de links do Firebase Storage (carrossel, galeria e
fotos do check-in), copia cada arquivo para o S3 e grava o endereço novo em `/media/...`.
Fotos de check-in ganham nome aleatório. Pode rodar de novo com segurança: o que já foi
migrado não é mais link do Firebase, e o que falhar continua com o link antigo.

Depois de conferir o site (carrossel, galeria e um check-in antigo abrindo):

1. Publique as regras **só leitura** do Storage: `firebase deploy --only storage`
   ([`storage.rules`](storage.rules) bloqueia qualquer gravação nova — antes, qualquer
   usuário logado podia gravar).
2. (Opcional) Guarde uma cópia: `gsutil -m cp -r gs://sp-car-clean.firebasestorage.app ./backup-storage`.
3. Apague os arquivos do bucket no Console do Firebase (Storage) para não pagar por eles.

### App instalável: app do cliente e app da gestão

O site tem **dois apps instaláveis** (PWA), baixados direto do site, sem loja de
aplicativos:

| App | Para quem | Manifesto | Abre em | Ícone na tela inicial |
|---|---|---|---|---|
| **App do Cliente** | clientes | `manifest.webmanifest` (`id: /?app=cliente`) | site, com atalhos *Agendar* e *Consultar* | "SP Car Clean" |
| **App da Gestão** | admin/equipe | `admin.webmanifest` (`id: /?utm_source=pwa`) | tela de senha do painel | "SPCC Gestão" |

O `<head>` do `index.html` escolhe o manifesto na hora: a página aberta com `?admin`
oferece o app da gestão; as demais, o do cliente. O app da gestão herdou o `id` do app
antigo, então quem já tinha o app instalado continua com ele (agora como app da gestão).

**Como baixar**

- **Cliente:** botão **📲 Baixar app** no menu do site, no rodapé e na faixa que aparece no
  celular. Link direto para mandar ao cliente: `https://www.spcarclean.com.br/?instalar=1`.
- **Admin:** botão **📲 Instalar app** no topo do painel, ou o link
  `https://www.spcarclean.com.br/?admin&instalar=1`.
- No **Android/Chrome** e no computador aparece o botão **Instalar agora**. No **iPhone**
  (Safari) o site mostra o passo a passo: Compartilhar ⬆️ → **Adicionar à Tela de Início**.
- Aberto **dentro do Instagram/WhatsApp/Facebook** (navegador embutido) não dá para
  instalar: o site detecta e explica como abrir no Safari/Chrome. Esse era o motivo mais
  comum de "não consigo baixar o app" — e, antes, o botão só existia dentro do painel e só
  aparecia no Chrome do Android.

Arquivos do PWA:

| Arquivo | Papel |
|---|---|
| `manifest.webmanifest` | App do cliente: nome, ícones, `display: standalone`, atalhos Agendar/Consultar |
| `admin.webmanifest` | App da gestão: abre direto no painel (`/?admin&app=admin`) |
| `sw.js` | Service worker: cache offline (network-first no HTML, stale-while-revalidate nos assets) e recebimento dos pushes |

O deploy publica `sw.js` e os dois manifestos sem cache longo e com o `Content-Type`
correto (`application/manifest+json`).

#### Notificações push

É **Web Push padrão** (VAPID, sem Firebase). A chave é criada pelo Terraform
(`infra/push.tf`); os aparelhos ficam na tabela DynamoDB `sp-car-clean-push-subscriptions`,
marcados como `admin` ou `client`. No iPhone o push só funciona com o app **instalado**
(iOS 16.4+).

**Admin** — ativa sozinho no login pelo celular (aceitando a permissão):

| Aviso | Quando | Função |
|---|---|---|
| 🔔 Novo agendamento | na hora | `notify-booking` |
| 📅 Pedido de reagendamento / 🚫 cancelamento pelo cliente | na hora | `notify-booking` |
| 🏁 Entregas próximas | todo dia 07h30 — serviços com retirada de hoje até `ADMIN_ALERT_DAYS` dias | `admin-alerts` |
| 📦 Estoque em falta | todo dia 07h30 — produtos abaixo do mínimo cadastrado | `admin-alerts` |

Tudo também vai para o Telegram.

**Cliente** — toca em **🔔 Avisos no celular** (na confirmação do agendamento, na consulta
por código ou em Minha Conta). Sem conta, a inscrição vale para aquele agendamento
(código + e-mail conferidos no servidor); com conta, para todos os agendamentos dela.
Recebe um push a cada mudança do serviço:

- orçamento aprovado / solicitação não aprovada;
- pagamento confirmado (webhook do InfinitePay);
- reagendamento aprovado ou recusado, data alterada, check-in feito, serviço concluído,
  cancelamento — toda mensagem que o painel manda ao cliente por e-mail também vira push
  (`sendEmail` → função `notify-client`).

Tocar no aviso abre a consulta do agendamento (`/?app=cliente&consulta=CÓDIGO`). A função
`notify-client` só aceita chamada do admin e escolhe o destino pelo próprio agendamento —
o painel não consegue mandar push para outra pessoa. A tabela guarda só hashes do código,
da conta e do e-mail do cliente.

#### O app da gestão abre direto na tela de senha

Abrir o **app da gestão** cai **direto na tela de senha do painel**, em tela cheia — sem
passar pelo site, **já na primeira abertura**. O **app do cliente** sempre abre no site.

1. Abriu o app da gestão → tela de senha. Se a sessão do Firebase ainda estiver válida,
   exibe *"Verificando sessão…"* por um instante e entra no painel **sem pedir a senha**.
2. Um login de admin marca o aparelho como sendo da gestão
   (`localStorage` → `spcc.adminDevice`).
3. Sair do painel dentro do app volta para a tela de senha, não para o site.

O link **Ver o site** na tela de senha é uma saída pontual. Num app **antigo** (instalado
antes da separação, sem `?app=` no endereço) vale a regra anterior: num aparelho que
**nunca** fez login de admin, esse link marca `spcc.appSiteOnly` e dali em diante o app
abre no site.

Outros detalhes:

- Para ligar/desligar num aparelho: **Painel → Configurações → Segurança → 📱 Este
  aparelho**, na opção *"Abrir direto na tela de senha"*.
- O atalho **Painel Admin** (`/?admin`) abre a mesma tela em qualquer aparelho, sem
  marcá-lo. No navegador comum, `/?admin` abre o modal de senha sobre o site.
- Nada disso depende de rede: os marcadores ficam em `localStorage`, por aparelho.

### Google Agenda

Sem Google Cloud, sem credencial OAuth e sem cartão. A função `calendar-sync` serve a
agenda em dois formatos, por links assinados (HMAC):

**Admin — Google Apps Script (a cada 5 min).** Um script grátis na conta
spcarclean0@gmail.com ([`scripts/agenda-admin.gs`](scripts/agenda-admin.gs)) lê o feed JSON e
cria, atualiza e apaga os eventos na agenda principal: da entrada (08:00) à retirada (18:00 —
horários de Configurações), com cliente, telefone, veículo, valor e nota. Pendentes aparecem
com ⏳; cancelados, rejeitados e excluídos saem da agenda.

Instalar (uma vez):

1. Painel → **Configurações → 📅 Google Agenda → 📋 Copiar link do script**.
2. Entre com **spcarclean0@gmail.com** em [script.google.com](https://script.google.com) →
   **Novo projeto** → apague o conteúdo e cole o `scripts/agenda-admin.gs`.
3. Troque `COLE_AQUI_O_LINK` pelo link copiado e salve (💾).
4. No menu de funções, escolha **instalar** → **Executar** → autorize. Se o Google avisar
   "app não verificado": **Avançado → Acessar** (o script é seu).

Pronto: roda sozinho a cada 5 minutos (gatilho de tempo). Para forçar, execute
**sincronizar**. Há também o **Link .ics**, para assinar a agenda do admin no iPhone/Outlook.

**Cliente — agenda assinada.** O botão **🔁 Agenda sempre atualizada** (consulta por código)
ou **🔁 Meus agendamentos na agenda** (Minha Conta) gera um link `.ics` só com os
agendamentos daquele e-mail — o servidor só entrega o link a quem prova ser o dono (conta
logada ou código + e-mail). O cliente escolhe **Google Agenda**, **Agenda do iPhone/Mac**
ou **Outlook**, e a agenda "SP Car Clean — meus agendamentos" se atualiza sozinha:
reagendou, muda lá; cancelou, some. O iPhone atualiza a cada hora; o **Google atualiza
agendas assinadas a cada poucas horas** (limite do Google). Para ter o evento na hora,
continuam os botões **📅 Google Agenda** e **🗓️ Apple / Outlook** de cada agendamento.

> Os links funcionam como senha (quem tem o link vê aqueles agendamentos). Para invalidar
> todos, grave um novo `CALENDAR_FEED_SECRET` no SSM e rode o deploy; depois, copie o link
> novo para o Apps Script.

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
├── manifest.webmanifest         # Manifesto do app do cliente (PWA)
├── admin.webmanifest            # Manifesto do app da gestão (PWA)
├── sw.js                        # Service worker: cache offline + push (admin e cliente)
├── package.json
├── firebase.json                # Config Firebase (regras de Database e Storage; hosting migrado p/ AWS)
├── database.rules.json          # Regras de segurança do Realtime Database (versionadas)
├── storage.rules                # Firebase Storage só leitura (fotos migradas para o S3)
├── assets/
│   ├── logo.png                 # Logo oficial (PNG com fundo transparente)
│   └── portfolio/               # Imagens e vídeos do carrossel hero
├── infra/                       # Terraform: S3 (site e mídia), CloudFront, Route 53, ACM, Lambda, API Gateway, crons
├── scripts/                     # aws-put-secrets.sh (SSM), aws-bootstrap-tfstate.sh (estado do Terraform),
│                                # migrate-media.js (fotos antigas do Firebase → S3), agenda-admin.gs (Apps Script da agenda)
└── functions/                   # Backend (AWS Lambda; entrada: lib/aws-adapter.js)
        ├── notify-booking.js        # Notifica o admin (Telegram + push)
        ├── notify-client.js         # Push no celular do cliente quando o serviço muda (chamado pelo painel)
        ├── push-subscription.js     # Chave pública VAPID (GET) e inscrição do aparelho do admin ou do cliente (POST)
        ├── upload-url.js            # URL pré-assinada para o painel enviar fotos/vídeos ao S3
        ├── calendar-sync.js         # Feeds da agenda: JSON p/ o Apps Script do admin e .ics do admin/cliente
        ├── admin-alerts.js          # Cron diário: entregas próximas e estoque em falta (push + Telegram)
        ├── create-payment.js        # Gera link de pagamento InfinitePay (agendamento)
        ├── create-gift-payment.js   # Gera link de pagamento InfinitePay (gift card)
        ├── infinitepay-webhook.js   # Confirma pagamento/ativa gift card e atualiza Firebase
        ├── booking-status.js        # Consulta de status por código + e-mail (leitura server-side)
        ├── birthday-check.js        # Cron diário: detecta aniversariantes, cria cupom e envia e-mail
        ├── reminder-check.js        # Cron diário: lembrete D-1 por e-mail ao cliente
        ├── ai.js                    # Orquestrador HTTP dos agentes de IA (admin + públicos)
        ├── ai-dispatcher.js         # Cron diário: dispara agentes de IA agendados
        └── lib/
            ├── aws-adapter.js       # Entrada no Lambda: segredos do SSM + normalização do evento
            ├── webpush.js           # Web Push: VAPID, criptografia aes128gcm, inscrições (admin/cliente) no DynamoDB
            ├── s3.js                # S3 sem SDK: URL pré-assinada (SigV4) para o upload do painel
            ├── admin-auth.js        # Confere se o login é do admin (único ponto a trocar na Fase 4)
            ├── guard.js             # Rate-limit por IP + checagem de origem (CORS) das funções públicas
            ├── agents/              # Agentes de IA (concierge, relatorio, upsell, orcamento, …)
            └── core/                # Núcleo (claude, firebase, telegram, email, config, logger)
```

> Infra na AWS (Terraform, passo a passo): **`infra/README.md`**.

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
| Notificações push no celular do admin (Web Push padrão, sem Firebase) | ✅ |
| Dois apps instaláveis: app do cliente e app da gestão (com instrução para iPhone e navegadores embutidos) | ✅ |
| Push no celular do cliente a cada mudança do serviço | ✅ |
| Avisos diários ao admin: entregas dos próximos dias e estoque em falta | ✅ |
| Agendamentos no Google Agenda do admin (Apps Script) + agenda assinada do cliente (.ics) | ✅ |
| Fotos e vídeos no S3 da AWS (Firebase Storage desativado) | ✅ |
| App do admin abrindo direto na tela de senha do painel (sem passar pelo site) | ✅ |
| Central de IA com agentes (concierge, relatório, reativação, upsell, etc.) | ✅ |
| Chat Concierge público no site | ✅ |
| Orçamento por foto (IA) | ✅ |
| Gift cards (compra online + ativação por webhook) | ✅ |
| Avaliações do cliente + depoimentos aprovados na vitrine | ✅ |
| Controle de estoque/insumos com previsão de reposição (IA) | ✅ |
| Lembrete automático D-1 do agendamento por e-mail | ✅ |
| Notificações automáticas ao cliente por WhatsApp Cloud API (Meta) | ⏸️ Removido — backlog M1 |
| Webhook de WhatsApp (mensagens do cliente → Telegram do admin) | ⏸️ Removido — backlog M2 |
| Feed do Instagram no site (Instagram Graph API) | ⏸️ Removido — backlog M3 |

---

## Backlog de melhorias

Itens abaixo estão **em aberto** — priorizados por impacto. A ênfase atual é
**segurança do backend**, já que o app move pagamentos e dados pessoais de clientes.

### ✅ Concluído

| # | Item | Onde | O que foi feito |
|---|---|---|---|
| 1 | **Webhook de pagamento sem verificação** | `functions/infinitepay-webhook.js` | O corpo do webhook deixou de ser confiável: antes de confirmar um agendamento ou ativar um gift card, a função consulta o endpoint oficial `POST payment_check` do InfinitePay (autenticado pelo nosso `handle`) e só prossegue se `paid === true`. Confere também o valor pago contra o valor esperado do pedido (`priceWithFee`/`amount`) e faz **fail-closed** — se não conseguir verificar, devolve erro para o InfinitePay reenviar em vez de confirmar às cegas. |
| 2 | **Regra RTDB permitia sobrescrever qualquer agendamento** | `database.rules.json` (`bookings/$id`) | A escrita pública passou de `newData.exists()` (qualquer alteração) para: **criar** um agendamento, ou fazer só as alterações self-service (reagendar/cancelar/feedback). Campos de valor, pagamento e identidade (`price`, `finalPrice`, `priceWithFee`, `paidAmount`, `paymentTransactionId`, `email`, `name`, `phone`, `createdAt`, `id`) ficaram imutáveis sem login, e o `status` só pode ir para `cancelled` — nunca para `approved`/`confirmed`/`completed`. Regra validada com 15 casos (targaryen). |
| 4 | **Regras de segurança não versionadas** | `database.rules.json`, `storage.rules`, `firebase.json` | As regras do Realtime Database e do Storage viviam só neste README (colar manual no Console, sem histórico nem revisão). Agora são **versionadas** em `database.rules.json` e `storage.rules`, referenciadas no `firebase.json`, e publicáveis com `firebase deploy --only database,storage`. (As regras do Storage foram versionadas sem alterar comportamento na época; a leitura de `checkin/**` foi endurecida depois, no item 7.) |
| 3 | **Códigos de reserva/gift card curtos e previsíveis** | `index.html` (`genId`, `genGiftId`) | Os códigos passaram de 6 caracteres gerados com `Math.random()` (`SPC-` ≈ 10⁹, não-criptográfico) para **10 caracteres via CSPRNG** (`crypto.getRandomValues`), num alfabeto de 32 sem ambíguos → **32¹⁰ ≈ 1,1×10¹⁵** combinações. Inviabiliza enumeração/brute force para os **novos** agendamentos e gift cards. Mesma correção aplicada ao `genGiftId`. |
| 3b | **Leitura pública expunha o agendamento inteiro (inclui enumeração de códigos antigos)** | `database.rules.json` (`bookings/$id .read`), `functions/booking-status.js`, `index.html` | `bookings/$id .read` deixou de ser `true`: agora exige login e só o dono (`clientUid == auth.uid` ou `email == auth.token.email`) ou o admin leem — fecha a enumeração, **inclusive dos códigos antigos**. A consulta sem login passou para a função server-side `booking-status` (exige **código + e-mail**, devolve só ao dono verificado, com rate-limit por IP e resposta genérica anti-oráculo). Regra e função validadas (8 + 7 casos). |
| 7 | **Fotos de check-in com leitura pública** | `storage.rules` (`checkin/**`) | A leitura de `checkin/**` passou de `if true` para `if request.auth != null`: o acesso por **caminho bruto** deixou de ser público (bloqueia raspagem/enumeração do bucket). As miniaturas continuam abrindo para o cliente porque o app usa a URL de download com `?token=` (gerada pelo admin no upload) — esse token funciona independentemente das regras, inclusive para o cliente deslogado (link por e-mail/WhatsApp). `gallery/` segue pública (vitrine). |
| 5 | **Funções de pagamento/notificação sem auth nem rate-limit** | `functions/lib/guard.js` (novo), `create-payment.js`, `create-gift-payment.js`, `notify-booking.js` | Helper `guard.js` adiciona **rate-limit por IP** + **checagem de origem (CORS)** às três funções públicas (corta geração de links e disparo de notificações/WhatsApp em massa por terceiros — incluindo abuso do número oficial de WhatsApp). Além disso, `create-payment` e `create-gift-payment` passaram a ler o **valor no Firebase** (preço do agendamento / valor do gift card) em vez de confiar no valor enviado pelo cliente; o webhook (item 1) ainda revalida o valor pago. Validado (8 casos). |
| 6 | **Rate-limit dos agentes de IA públicos era só em memória** | `ai.js`, `ai-dispatcher.js`, `database.rules.json` (`aiRateLimit`) | Além do rate-limit em memória (por instância), o `ai.js` agora faz um rate-limit **persistente e compartilhado** entre instâncias: contador por hora e por IP no Realtime Database via **incremento atômico** (`{".sv":{"increment":1}}`), escrito com o Database Secret. **Fail-open** se o DB não responder (os tetos de orçamento por agente seguem valendo). O `ai-dispatcher` limpa diariamente os buckets antigos. Validado (21ª chamada do mesmo IP → 429). |
| 8 | **Código Firestore legado removido** | antiga pasta `functions/` do Firestore, `firestore.rules`, `functions/lib/syncClient.js` | O conjunto Firestore (Cloud Function `syncClientFromBooking` + regras) não correspondia à arquitetura atual (Realtime Database) e não era referenciado por `firebase.json`/`netlify.toml`/app — código morto. **Removido** para eliminar a confusão (regras que não eram aplicadas, etc.). |
| 9 | **Log de debug versionado** | `firebase-debug.log`, `.gitignore` | `firebase-debug.log` (artefato do `firebase init`) **removido** do repositório e adicionado ao `.gitignore`. |
| 11 | **Cliente só conseguia cadastrar 1 veículo em "Minha Conta"** | `index.html` (`_profileVehicles`) | Causa provável: o Realtime Database devolvia o array `vehicles` como objeto `{0:…,1:…}`, e `Array.isArray()` falhava → o app caía no fallback de 1 veículo (`primaryVehicle`) em 3 telas. Novo helper `_profileVehicles(profile)` aceita **array ou objeto** (e só cai no `primaryVehicle` quando não há lista), usado nas 3 leituras (resumo da conta, form de dados cadastrais, prefill do agendamento). Validado (6 casos). |
| 12 | **Destacar pacotes/combos na seleção de serviços** | `index.html` (`renderBookingStep`, step 1) | No passo 1 do agendamento (só carro — combos usam porte pq/gr), um bloco destacado **"🎁 Pacotes com desconto"** lista os combos públicos ativos com preço regular vs. combo + economia e um botão **"Escolher pacote"** que adiciona os serviços do combo ao agendamento (`applyComboSuggestion`). Estimula a compra de pacotes no momento da escolha. |
| 13 | **Pesquisa + indicação por WhatsApp ao concluir (manual, na hora)** | `index.html` (`markCompleted`; deep-link `?indicar=1`) | Ao marcar como **concluído**, além do e-mail automático da pesquisa, o admin recebe a opção de **abrir o WhatsApp já preenchido** com a **pesquisa** (`?avaliar=CODE`) + o **convite de indicação** (link `?indicar=1`) num texto só, citando o desconto de 15%. O `?indicar=1` é o novo **link de indicação compartilhável** que abre o modal "Indique um amigo" (programa de indicação que já existia — cupom 15% para amigo e para quem indica). |

### 🔵 Backlog — Integrações Meta (removidas)

As integrações com APIs da Meta (WhatsApp Cloud API, Instagram/Facebook Graph API) **não
estavam ligadas** e foram **removidas do código** — o sistema não depende mais da Meta.
Continuam funcionando, por não usarem API da Meta: os links `wa.me` que o admin usa para
falar com o cliente, o link do perfil do Instagram no rodapé e a legenda de Instagram gerada
pela IA (texto para copiar).

Para retomar, o código está no histórico do git no commit `53db58d` (último antes da
remoção; naquele commit as funções ficavam em `netlify/functions/`, hoje em `functions/`) — ex.:
`git show 53db58d:netlify/functions/lib/core/whatsapp.js`.

| # | Item | Arquivos no `53db58d` | O que falta para retomar |
|---|---|---|---|
| M1 | **Mensagens automáticas por WhatsApp Cloud API** (novo agendamento, reagendamento, cancelamento, correção de valor e lembrete D-1) | `netlify/functions/lib/core/whatsapp.js`, trechos de `notify-booking.js` e `reminder-check.js`, `WHATSAPP_SETUP.md` | Número comercial ativo na Cloud API, templates aprovados pela Meta e token permanente (System User) no SSM (`/sp-car-clean/WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`). |
| M2 | **Webhook de entrada do WhatsApp** (mensagens do cliente → Telegram do admin) | `netlify/functions/whatsapp-webhook.js` | Restaurar a função, incluir `whatsapp-webhook` em `http_functions` (`infra/api.tf`) e cadastrar `https://spcarclean.com.br/api/whatsapp-webhook` no painel da Meta. |
| M3 | **Feed do Instagram no site** | `INSTAGRAM_SETUP.md` | App na Meta com Instagram Graph API e token de longa duração (renovação a cada 60 dias). |

### ⚪ Descartado (por design)

| # | Item | Decisão |
|---|---|---|
| 3c | **Tornar `adminNotes` um campo só-admin** | Descartado: o `adminNotes` é, por design, uma observação que o admin **compartilha com o cliente** (aparece como "Nota" na consulta de status e como "Obs" no WhatsApp de aprovação). Não é um segredo interno, então não há o que esconder. Com o item 3b, quem lê já é só o dono verificado (não mais qualquer um com o código). |

### 🟡 Débito técnico / organização

| # | Item | Onde | Observação |
|---|---|---|---|
| 10 | **`index.html` monolítico** | `index.html`, `styles.css`, `build.js` | **Fase 1 concluída:** o CSS principal (~72 KB, ~680 linhas) foi extraído do `<style>` inline para `styles.css` (referenciado por `<link>` e copiado ao `dist/` pelo `build.js`); o `index.html` caiu de ~580 KB para ~508 KB, sem impacto em JS nem nos placeholders de env (que ficam só no bloco `<script>`). **Pendente (fases futuras):** separar o `<script>` da aplicação (~8.400 linhas) em módulos por área (site público vs. painel admin) — refator maior, avaliado a médio prazo. |
| L1 | **Caminho legado `/.netlify/functions/*`** | `infra/main.tf` (CloudFront Function `api_router` + comportamento), `sw.js` | Mantido para app.js antigo em cache e links de pagamento InfinitePay emitidos antes de 28/09/2026 (webhook no caminho antigo). **Remover a partir de dez/2026**: tirar o comportamento `/.netlify/functions/*` e o rewrite da CloudFront Function, e a exceção `/.netlify/` do `sw.js`. |

---

## Licença

Projeto privado — todos os direitos reservados à SP Car Clean.
