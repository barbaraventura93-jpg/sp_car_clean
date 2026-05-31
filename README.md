# SP Car Clean — Estética Automotiva Premium

Site institucional + sistema de agendamento online com painel de gestão para a **SP Car Clean**, especializada em estética automotiva em São Paulo, SP.

---

## Funcionalidades

### Site público
- **Vitrine de serviços** com preços por porte de veículo (pequeno/grande) e toggle interativo
- **Carrossel de portfólio** com suporte a imagens e vídeos via `assets/portfolio.json`
- **Depoimentos de clientes** em cards
- **Feed do Instagram** via Instafeed.js (Instagram Graph API)
- **Seção de diferenciais** com estatísticas animadas
- **Botão WhatsApp** direto para contato

### Agendamento (cliente)
- Fluxo em **4 etapas**: serviço → data → dados → confirmação
- Seleção de **múltiplos serviços** no mesmo agendamento com total calculado dinamicamente
- **Calendário interativo** com disponibilidade em tempo real integrado ao Firebase Realtime Database
- **Código de rastreamento único** por agendamento (ex: `SPC-X7K2M`)
- **Consulta de status** pelo código — sem login, acessível ao cliente a qualquer momento
- **Reagendamento self-service**: cliente solicita nova data com justificativa; admin aprova ou rejeita
- **Cancelamento self-service**: política de reembolso calculada automaticamente por dias úteis (reembolso integral se cancelado com mais de 1 dia útil de antecedência)
- **Confirmação automática por e-mail** via EmailJS em cada mudança de status relevante
- Coleta de **bairro e CEP** do cliente para mapeamento geográfico

### Painel Administrativo
- Login seguro com **Firebase Auth** (e-mail + senha)
- **Calendário de agenda**: bloquear dias avulsos ou períodos inteiros
- **Lista de agendamentos** filtrável por status (pendente, aprovado, confirmado, rejeitado, cancelado)
- Aprovar com definição de **preço final**, datas e local de entrega/retirada
- Rejeitar, cancelar e alterar datas de agendamentos a qualquer momento
- **Alerta de capacidade** por dia (`maxPerDay` configurável)
- **Notas do admin** por agendamento (campo interno, não visível ao cliente)
- Contato direto com o cliente via **WhatsApp** a partir do painel
- **Notificação em tempo real via Telegram** a cada novo agendamento, solicitação de reagendamento ou cancelamento
- **Exportação de dados** em JSON

### Ficha de Cliente
- **Agregação automática** de todos os agendamentos por e-mail
- **Busca rápida** por nome, e-mail ou telefone
- **Classificação automática**: Novo / Recorrente / VIP (≥ R$ 1.000 gastos ou ≥ 3 atendimentos)
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
- **Ranking de serviços mais vendidos** em gráfico de barras
- **Indicadores de fidelização**: taxa de retorno, ticket médio, taxa de aprovação
- **Mapa interativo de alcance** (OpenStreetMap via Leaflet, gratuito e sem API key):
  - Marcadores proporcionais ao número de clientes por bairro
  - Círculos de raio 5 km / 10 km / 15 km a partir do centro de São Paulo
  - Ranking de bairros com barra de participação percentual
  - Análise automática de concentração/diversificação da base e sugestão de ações

### Configurações do sistema (admin)
- WhatsApp, endereço/local de entrega, horários de entrada e saída, máximo de agendamentos por dia
- Troca de senha administrativa
- Limpeza total de dados

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript puro (sem frameworks) |
| Banco de dados em tempo real | Firebase Realtime Database |
| Dados de clientes | Firebase Realtime Database (`/clients`, `/clientNotes`) |
| Autenticação | Firebase Auth (e-mail + senha) |
| Hosting | Netlify |
| Notificações | Netlify Functions + EmailJS + Telegram Bot API |
| Mapa | Leaflet.js + OpenStreetMap + Nominatim (geocoding) |
| Feed social | Instafeed.js (Instagram Graph API) |
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
};
```

---

## Deploy

### Pré-requisitos
- Conta [Netlify](https://netlify.com) com repositório conectado
- Projeto [Firebase](https://console.firebase.google.com) com Realtime Database e Auth habilitados
- Variáveis de ambiente configuradas no painel do Netlify (ver tabela abaixo)

### Variáveis de ambiente (Netlify)

| Variável | Descrição |
|---|---|
| `FIREBASE_API_KEY` | Chave de API do Firebase (obrigatória — injetada no build) |
| `EMAILJS_SERVICE_ID` | ID do serviço no EmailJS |
| `EMAILJS_PUBLIC_KEY` | Chave pública do EmailJS |
| `TELEGRAM_BOT_TOKEN` | Token do bot de notificações via Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat para receber as notificações |
| `INFINITEPAY_HANDLE` | InfiniteTag (usuário InfinitePay) para geração de links de pagamento |
| `INFINITEPAY_FEE_RATE` | Taxa a embutir no preço (padrão: `0.0315` = 3,15% crédito à vista) |
| `FIREBASE_DATABASE_URL` | URL do Realtime Database, ex: `https://projeto-default-rtdb.firebaseio.com` |
| `FIREBASE_DATABASE_SECRET` | Token legado do Firebase para atualização via webhook (Console → Project Settings → Service Accounts → Database secrets) |

### Build

```bash
# Variável obrigatória para build local
FIREBASE_API_KEY=AIzaSy... node build.js

# Serve a pasta dist localmente
npx serve dist
```

O build injeta a `FIREBASE_API_KEY` (e opcionalmente as chaves de EmailJS) no HTML e copia os assets para `dist/`, que é a pasta publicada pelo Netlify.

O deploy em produção é **automático** a cada `git push` na branch `main`.

---

## Estrutura do projeto

```
sp-car-clean/
├── index.html                   # Aplicação completa (site público + painel admin)
├── build.js                     # Script de build — injeta variáveis de ambiente
├── package.json
├── netlify.toml                 # Config Netlify (build, publish, functions)
├── firebase.json                # Config Firebase Hosting
├── firestore.rules              # Regras de segurança do Firestore
├── assets/
│   ├── portfolio/               # Imagens e vídeos do portfólio
│   └── portfolio.json           # Manifesto das mídias do carrossel
├── functions/                   # Firebase Cloud Functions
│   ├── index.js                 # Trigger: sincroniza bookings → /clients (Firestore)
│   └── lib/syncClient.js        # Lógica de agregação e cálculo de VIP
├── netlify/
│   └── functions/
│       └── notify-booking.js    # Função serverless de notificação (Telegram + e-mail)
└── scripts/
    └── backfill.js              # Script de migração: popula /clients a partir de bookings
```

---

## Adicionando itens ao portfólio

1. Coloque o arquivo em `assets/portfolio/` (JPG, PNG ou MP4)
2. Adicione a entrada em `assets/portfolio.json`:

```json
{
  "id": 4,
  "type": "image",
  "title": "Nome do serviço",
  "url": "/assets/portfolio/foto.jpg",
  "thumb": "/assets/portfolio/foto.jpg"
}
```

3. Faça commit e push — o deploy é automático.

> Consulte `PORTFOLIO_README.md` para mais detalhes sobre formatos e tamanhos recomendados.

---

## Instagram Feed

O feed usa a **Instagram Graph API** via Instafeed.js. Para ativar, substitua o token no `index.html`:

```js
const accessToken = 'seu_token_aqui';
```

> Consulte `INSTAGRAM_SETUP.md` para o passo a passo completo de geração do token.

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
| Lista de espera | 🔜 |
| Galeria antes/depois por atendimento | 🔜 |
| Pagamento online via InfinitePay (PIX + cartão) | ✅ |
| Gráficos de receita por período | 🔜 |
| FAQ por serviço | 🔜 |

---

## Licença

Projeto privado — todos os direitos reservados à SP Car Clean.
