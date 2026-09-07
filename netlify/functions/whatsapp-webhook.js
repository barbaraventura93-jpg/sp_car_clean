// Webhook do WhatsApp Cloud API.
//
// GET  → verificação (handshake exigido pela Meta ao cadastrar a URL).
//        Confere hub.verify_token contra WHATSAPP_VERIFY_TOKEN e devolve
//        hub.challenge.
// POST → eventos (mensagens recebidas dos clientes e status de entrega).
//        Encaminha mensagens de texto recebidas para o Telegram do admin
//        (best-effort) e sempre responde 200 rápido, como a Meta exige.
//
// Variável de ambiente necessária:
//   WHATSAPP_VERIFY_TOKEN → uma senha/string que VOCÊ inventa; tem que ser
//                           idêntica no formulário da Meta e aqui no Netlify.

const { sendTelegram } = require('./lib/core/telegram');

exports.handler = async (event) => {
  // ---- Verificação (GET) ----
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode      = params['hub.mode'];
    const token     = params['hub.verify_token'];
    const challenge = params['hub.challenge'];
    const expected  = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && expected && token === expected) {
      return { statusCode: 200, body: challenge || '' };
    }
    return { statusCode: 403, body: 'Verification failed' };
  }

  // ---- Eventos (POST) ----
  if (event.httpMethod === 'POST') {
    try {
      const payload = JSON.parse(event.body || '{}');
      const changes = payload?.entry?.[0]?.changes || [];

      for (const change of changes) {
        const value    = change?.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];
        const contactName = contacts[0]?.profile?.name || '';

        for (const msg of messages) {
          const from = msg.from || 'desconhecido';
          let texto;
          if (msg.type === 'text')          texto = msg.text?.body || '';
          else if (msg.type === 'button')   texto = msg.button?.text || '(botão)';
          else if (msg.type === 'interactive')
            texto = msg.interactive?.button_reply?.title
                 || msg.interactive?.list_reply?.title || '(resposta)';
          else                              texto = `(${msg.type})`;

          const nome = contactName ? `${contactName} ` : '';
          await sendTelegram(
            `💬 *WhatsApp — mensagem recebida*\n\n` +
            `👤 ${nome}\\(${from}\\)\n` +
            `📝 ${texto}`
          );
        }
      }
    } catch (err) {
      console.error('whatsapp-webhook: erro processando evento:', err.message);
      // Ainda assim respondemos 200 para a Meta não re-enfileirar sem parar.
    }
    return { statusCode: 200, body: 'EVENT_RECEIVED' };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
