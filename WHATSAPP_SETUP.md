# WhatsApp Cloud API — Guia de Contratação e Configuração

Este guia ativa o envio automático de mensagens **ao cliente**, saindo do
**número oficial da loja**, via **WhatsApp Cloud API (Meta)** — o caminho
oficial e mais barato (sem intermediário/BSP).

O código já está pronto no projeto:
- `netlify/functions/lib/core/whatsapp.js` — módulo de envio (templates)
- `netlify/functions/notify-booking.js` — dispara o WhatsApp junto com o
  push/Telegram, para cada tipo de evento.

Enquanto as variáveis de ambiente não forem preenchidas, **nada é enviado**
(o fluxo de agendamento continua funcionando normalmente).

---

## 1. Custos (resumo)

Modelo atual da Meta é **por mensagem**. O que a loja envia (confirmação,
cancelamento, reagendamento, correção de valor) é categoria **Utilidade**:

| Item | Custo aprox. (Brasil) |
|---|---|
| Mensagem de **Utilidade** | ~US$ 0,008 (~R$ 0,04) por mensagem |
| Hospedagem da Cloud API | **Grátis** (direto na Meta) |
| Intermediário (BSP) | R$ 0 se usar a Meta direto |

> Ex.: 200 agendamentos/mês × 2 mensagens ≈ 400 msgs ≈ **~R$ 16/mês**.
> Preços mudam — confira a tabela oficial vigente da Meta antes de fechar.

---

## 2. ⚠️ Antes de começar — o número

Ao conectar um número na Cloud API, ele **deixa de funcionar no app comum do
WhatsApp / WhatsApp Business**. Recomendação:

- Use um **número dedicado** (um chip novo/segundo número) só para os envios
  automáticos, e **mantenha o WhatsApp atual da loja no celular** para o
  atendimento manual.

O número precisa poder receber SMS/ligação para o código de verificação.

---

## 3. Passo a passo de contratação

1. **Conta Meta Business**
   - Acesse https://business.facebook.com e crie/entre no Gerenciador de Negócios.
   - Recomendado: fazer a **verificação do negócio** (com CNPJ) —
     libera limites maiores de envio.

2. **App de desenvolvedor**
   - Acesse https://developers.facebook.com → *Meus Apps* → *Criar app*.
   - Tipo do app: **Empresa (Business)**.
   - No app, adicione o produto **WhatsApp**.

3. **Conectar o número da loja**
   - Em *WhatsApp → Configuração da API*, adicione o **número dedicado** e
     confirme o código recebido por SMS/ligação.
   - Anote o **Phone Number ID** (um número longo — NÃO é o telefone em si).
   - Anote também o **WhatsApp Business Account ID (WABA ID)**.

4. **Token de acesso permanente** (System User)
   - Em *Configurações do Negócio → Usuários → Usuários do sistema*, crie um
     **System User** (função Admin).
   - Clique em *Gerar novo token*, selecione o app, marque as permissões
     **`whatsapp_business_messaging`** e **`whatsapp_business_management`**.
   - Escolha expiração **"Nunca"** e copie o token (guarde com segurança —
     ele não é exibido de novo).

5. **Cadastrar os templates de mensagem** (obrigatório)
   - Em *WhatsApp → Modelos de mensagem (Templates)* → *Criar modelo*.
   - Categoria: **Utilidade (Utility)**. Idioma: **Português (BR) / `pt_BR`**.
   - Crie os 5 modelos abaixo, com o corpo EXATO (as variáveis `{{1}}`, `{{2}}`…
     têm que ficar na mesma ordem que o código envia). Depois de criados,
     aguarde a **aprovação da Meta** (costuma levar de minutos a algumas horas).

---

## 4. Templates a cadastrar

Nome do template (exato) → corpo sugerido. Você pode mudar o texto, **mas não
a quantidade/ordem das variáveis**.

### `agendamento_recebido`  — variáveis: nome, serviço, data, código
```
Olá {{1}}! Recebemos sua solicitação de agendamento na SP Car Clean. ✨

🔧 Serviço: {{2}}
📅 Data: {{3}}
📋 Código: {{4}}

Assim que confirmarmos, avisamos por aqui. Obrigado! 🚗
```

### `reagendamento_aprovado`  — variáveis: nome, nova data, código
```
Boa notícia, {{1}}! Seu reagendamento foi aprovado. ✅

🗓️ Nova data confirmada: {{2}}
📋 Código: {{3}}

Aguardamos você na SP Car Clean!
```

### `reagendamento_recusado`  — variáveis: nome, código
```
Olá {{1}}, infelizmente não conseguimos aprovar o reagendamento do agendamento {{2}}. A data original será mantida. Qualquer dúvida, estamos à disposição. — SP Car Clean
```

### `cancelamento_confirmado`  — variáveis: nome, serviço, data, código
```
Olá {{1}}, confirmamos o cancelamento do seu agendamento na SP Car Clean.

🔧 Serviço: {{2}}
📅 Data: {{3}}
📋 Código: {{4}}

Se precisar, é só agendar novamente. Até breve! 🚗
```

### `correcao_valor`  — variáveis: nome, valor antigo, valor novo, código
```
Olá {{1}}, houve um ajuste no valor do seu agendamento na SP Car Clean.

💰 Valor: {{2}} → {{3}}
📋 Código: {{4}}

Qualquer dúvida, fale com a gente. Obrigado!
```

> Se preferir usar OUTROS nomes de template, você pode sobrescrever cada um
> por variável de ambiente (ver tabela abaixo) sem mexer no código.

---

## 5. Configurar as variáveis no Netlify

No painel do Netlify: **Site settings → Environment variables** → adicione:

| Variável | Obrigatória | Valor |
|---|---|---|
| `WHATSAPP_TOKEN` | ✅ | Token permanente do System User (passo 4) |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | Phone Number ID (passo 3) |
| `WHATSAPP_TEMPLATE_LANG` | ➖ | Idioma dos templates (padrão `pt_BR`) |
| `WHATSAPP_GRAPH_VERSION` | ➖ | Versão da Graph API (padrão `v21.0`) |
| `WA_TPL_NEW_BOOKING` | ➖ | Nome do template de novo agendamento |
| `WA_TPL_RESCHEDULE_APPROVED` | ➖ | Template de reagendamento aprovado |
| `WA_TPL_RESCHEDULE_REJECTED` | ➖ | Template de reagendamento recusado |
| `WA_TPL_CANCEL` | ➖ | Template de cancelamento |
| `WA_TPL_PRICE` | ➖ | Template de correção de valor |

Depois de salvar, faça um **redeploy** do site no Netlify para as funções
lerem as novas variáveis.

---

## 6. Testar

1. Faça um agendamento de teste no site com **seu próprio número** no campo
   de telefone.
2. Você deve receber a mensagem `agendamento_recebido` no WhatsApp.
3. Para depurar, veja a resposta da função `notify-booking` (aba *Functions*
   → logs no Netlify): o campo `whatsapp` traz `{ ok: true, id: ... }` em caso
   de sucesso, ou `{ ok:false, skipped/error: ... }` explicando o motivo
   (ex.: `not_configured`, `no_phone`, ou o erro retornado pela Meta).

### Formato do telefone
O código normaliza automaticamente para o padrão internacional do Brasil
(`55` + DDD + número). Números salvos como `(11) 98765-4321` viram
`5511987654321`. Certifique-se de que os clientes informem **DDD**.

---

## 7. Como funciona no código (referência rápida)

- `notify-booking.js` recebe o evento do site e, além do push/Telegram para o
  admin, chama `sendWhatsAppTemplate(type, data)` para o cliente.
- O mapa de `type → template + parâmetros` fica em `whatsapp.js` (constante
  `TEMPLATES`). Para adicionar um novo tipo de mensagem, basta adicionar uma
  entrada nesse mapa e cadastrar o template correspondente na Meta.
- `sendWhatsAppText()` existe para respostas de texto livre, mas só funciona
  **dentro da janela de 24h** (após o cliente ter escrito primeiro).
