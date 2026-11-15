# Histórico de melhorias — SP Car Clean

Registro do que já foi concluído, das integrações removidas e das decisões
antigas. Veio do `README.md` em 15/11/2026, sem alteração de conteúdo. **Não é
o backlog:** o que está em aberto fica em [`backlog.md`](backlog.md). Algumas
linhas citam o estado da época (por exemplo, Firebase Auth e `index.html`
monolítico) e não foram atualizadas, por serem registro histórico.

## ✅ Concluído

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

## 🔵 Backlog — Integrações Meta (removidas)

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

## ⚪ Descartado (por design)

| # | Item | Decisão |
|---|---|---|
| 3c | **Tornar `adminNotes` um campo só-admin** | Descartado: o `adminNotes` é, por design, uma observação que o admin **compartilha com o cliente** (aparece como "Nota" na consulta de status e como "Obs" no WhatsApp de aprovação). Não é um segredo interno, então não há o que esconder. Com o item 3b, quem lê já é só o dono verificado (não mais qualquer um com o código). |

## 🟡 Débito técnico / organização

| # | Item | Onde | Observação |
|---|---|---|---|
| 10 | **`index.html` monolítico** | `index.html`, `styles.css`, `build.js` | **Fase 1 concluída:** o CSS principal (~72 KB, ~680 linhas) foi extraído do `<style>` inline para `styles.css` (referenciado por `<link>` e copiado ao `dist/` pelo `build.js`); o `index.html` caiu de ~580 KB para ~508 KB, sem impacto em JS nem nos placeholders de env (que ficam só no bloco `<script>`). **Pendente (fases futuras):** separar o `<script>` da aplicação (~8.400 linhas) em módulos por área (site público vs. painel admin) — refator maior, avaliado a médio prazo. |
| L1 | **Caminho legado `/.netlify/functions/*`** | `infra/main.tf` (CloudFront Function `api_router` + comportamento), `sw.js` | Mantido para app.js antigo em cache e links de pagamento InfinitePay emitidos antes de 28/09/2026 (webhook no caminho antigo). **Remover a partir de dez/2026**: tirar o comportamento `/.netlify/functions/*` e o rewrite da CloudFront Function, e a exceção `/.netlify/` do `sw.js`. |
