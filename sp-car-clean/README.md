# 🚗 SP Car Clean — Estética Automotiva Premium

Site institucional + sistema de agendamento online com painel de gestão para a **SP Car Clean**, especializada em estética automotiva em São Paulo, SP.

---

## ✨ Funcionalidades

### Site público
- **Vitrine de serviços** com preços por porte de veículo (pequeno/grande) e toggle interativo
- **Carrossel de portfólio** com suporte a imagens e vídeos via `assets/portfolio.json`
- **Depoimentos de clientes** em cards
- **Feed do Instagram** via Instafeed.js
- **Seção de diferenciais** com estatísticas animadas
- **Botão WhatsApp** direto para contato

### Agendamento (cliente)
- Fluxo em **4 etapas**: serviço → data → dados → confirmação
- **Calendário interativo** com disponibilidade em tempo real (integrado ao Firebase)
- Código de rastreamento único por agendamento (ex: `SPC-X7K2M`)
- **Consulta de status** pelo código
- **Reagendamento self-service**: cliente pode solicitar nova data com modal dedicado
- **Cancelamento self-service**: com política de reembolso calculada automaticamente por dias úteis
- **Confirmação automática por e-mail** via EmailJS

### Painel Administrativo (`/área-restrita`)
- Login seguro com **Firebase Auth**
- **Calendário de agenda**: bloquear dias avulsos ou por período
- **Lista de agendamentos** com filtro por status (pendente, aprovado, confirmado, rejeitado, cancelado)
- Aprovar, rejeitar, cancelar e alterar datas de agendamentos
- **Alerta de capacidade** por dia (`maxPerDay` configurável)
- Contato direto com o cliente via WhatsApp a partir do painel
- **Estatísticas**: total de agendamentos, receita projetada, ticket médio e taxa de retorno
- **Exportação de dados** em JSON

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript puro |
| Banco de dados | Firebase Realtime Database |
| Autenticação | Firebase Auth |
| Hosting | Netlify + Firebase Hosting |
| CI/CD | GitHub Actions |
| Notificações | Netlify Functions + EmailJS |
| Feed social | Instafeed.js (Instagram Graph API) |
| Fontes | Google Fonts (Montserrat + Open Sans) |

---

## ⚙️ Configuração rápida

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

## 🚀 Deploy

### Pré-requisitos
- Conta [Netlify](https://netlify.com)
- Projeto [Firebase](https://console.firebase.google.com) com Realtime Database e Auth habilitados
- Variável de ambiente `FIREBASE_API_KEY` configurada no Netlify

### Variáveis de ambiente (Netlify)

| Variável | Descrição |
|---|---|
| `FIREBASE_API_KEY` | Chave de API do Firebase (injetada no build) |

### Build

```bash
# Local
npm run build        # gera a pasta dist/

# Produção (automático via GitHub Actions ao fazer push na main)
git push origin main
```

O build injeta a `FIREBASE_API_KEY` no HTML e copia os assets para `dist/`, que é a pasta publicada.

### URLs de produção
- **Netlify**: `https://sp-car-clean.netlify.app`
- **Firebase Hosting**: `https://sp-car-clean.web.app`

---

## 📁 Estrutura do projeto

```
sp-car-clean/
├── index.html              # Aplicação completa (site + admin)
├── build.js                # Script de build (injeta env vars)
├── package.json
├── firebase.json           # Config Firebase Hosting
├── netlify.toml            # Config Netlify (build + functions)
├── assets/
│   ├── portfolio/          # Imagens e vídeos do portfólio
│   └── portfolio.json      # Manifesto das mídias do carrossel
└── netlify/
    └── functions/
        └── notify-booking/ # Função de notificação de agendamentos
```

---

## 🖼️ Adicionando itens ao portfólio

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

## 📸 Instagram Feed

O feed do Instagram usa a **Instagram Graph API** via Instafeed.js. Para ativar, substitua o token no `index.html`:

```js
const accessToken = 'seu_token_aqui';
```

> Consulte `INSTAGRAM_SETUP.md` para o passo a passo completo de geração do token.

---

## 📋 Roadmap

| Funcionalidade | Status |
|---|---|
| Vitrine de serviços + agendamento em 4 etapas | ✅ |
| Painel admin completo | ✅ |
| Reagendamento self-service | ✅ |
| Cancelamento self-service | ✅ |
| Confirmação automática por e-mail | ✅ |
| Lista de espera | 🔜 |
| Galeria antes/depois | 🔜 |
| FAQ por serviço | 🔜 |
| Pagamento online (PIX + cartão) | 🔜 |
| Ficha de cliente com histórico | 🔜 |
| Gráficos de receita por período | 🔜 |

---

## 📄 Licença

Projeto privado — todos os direitos reservados à SP Car Clean.
