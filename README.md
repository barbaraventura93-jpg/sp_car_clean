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
- **Consulta de status** pelo código — sem login, acessível ao cliente a qualquer momento
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
- **Notas do admin** por agendamento (campo interno, não visível ao cliente)
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

### Configurações do sistema (admin)
- WhatsApp, endereço/local de entrega, horários de entrada e saída, máximo de agendamentos por dia
- Troca de senha administrativa
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
| Notificações | Netlify Functions + EmailJS + Telegram Bot API |
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
| `FIREBASE_DATABASE_SECRET` | Token legado do Firebase (webhook InfinitePay + cron de aniversário) |
| `EMAILJS_SERVICE_ID` | ID do serviço no EmailJS |
| `EMAILJS_PUBLIC_KEY` | Chave pública do EmailJS |
| `EMAILJS_PRIVATE_KEY` | Chave privada do EmailJS (para envio server-side) |
| `EMAILJS_BIRTHDAY_TEMPLATE` | ID do template de e-mail de aniversário no EmailJS |
| `TELEGRAM_BOT_TOKEN` | Token do bot de notificações via Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat para receber as notificações |
| `INFINITEPAY_HANDLE` | InfiniteTag (usuário InfinitePay) para geração de links de pagamento |
| `INFINITEPAY_FEE_RATE` | Taxa a embutir no preço (padrão: `0.0315` = 3,15% crédito à vista) |

### Firebase Realtime Database — regras de segurança

```json
{
  "rules": {
    "bookings":       { ".read": true, ".write": true },
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
    "waitlist":       { ".read": "auth != null && auth.token.email == 'ADMIN_EMAIL'", ".write": true },
    "clientProfiles": {
      "$uid": {
        ".read": "auth != null && (auth.uid == $uid || auth.token.email == 'ADMIN_EMAIL')",
        ".write": "auth != null && (auth.uid == $uid || auth.token.email == 'ADMIN_EMAIL')"
      }
    }
  }
}
```

### Firebase Storage — regras de segurança

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /gallery/{file} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /checkin/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

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
├── package.json
├── netlify.toml                 # Config Netlify (build, publish, functions, cron)
├── assets/
│   ├── logo.png                 # Logo oficial (PNG com fundo transparente)
│   └── portfolio/               # Imagens e vídeos do carrossel hero
└── netlify/
    └── functions/
        ├── create-payment.js        # Gera link de pagamento InfinitePay
        ├── infinitepay-webhook.js   # Confirma pagamento e atualiza Firebase
        └── birthday-check.js        # Cron diário: detecta aniversariantes, cria cupom e envia e-mail
```

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

---

## Licença

Projeto privado — todos os direitos reservados à SP Car Clean.
