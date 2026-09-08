// Webhook do WhatsApp Cloud API.
//
// GET  → verificação (handshake exigido pela Meta ao cadastrar a URL).
//        Confere hub.verify_token contra WHATSAPP_VERIFY_TOKEN e devolve
//        hub.challenge.
// POST → eventos. Campos assinados esperados:
//          - messages       → mensagens recebidas dos clientes
//          - message_status → atualizações de entrega/leitura
//          - account_update  → ex.: ACCOUNT_OFFBOARDED / ACCOUNT_RECONNECTED
//        As mensagens recebidas são PERSISTIDAS no Firebase em
//        whatsappMessages/{waId}/{messageId}, associadas ao cliente já
//        cadastrado quando o telefone bate com um registro existente.
//        Também encaminha um aviso para o Telegram do admin (best-effort).
//        Sempre responde 200 rápido, como a Meta exige (ela reenvia se não
//        receber 200 em poucos segundos).
//
// Variável de ambiente necessária:
//   WHATSAPP_VERIFY_TOKEN → uma senha/string que VOCÊ inventa; tem que ser
//                           idêntica no formulário da Meta e aqui no Netlify.

const { sendTelegram }   = require('./lib/core/telegram');
const { normalizePhone } = require('./lib/core/whatsapp');
const { dbGet, dbSet, dbPatch } = require('./lib/core/firebase');

// Extrai um texto legível de qualquer tipo de mensagem recebida.
function extractText(msg) {
  if (msg.type === 'text')        return msg.text?.body || '';
  if (msg.type === 'button')      return msg.button?.text || '(botão)';
  if (msg.type === 'interactive')
    return msg.interactive?.button_reply?.title
        || msg.interactive?.list_reply?.title || '(resposta)';
  return `(${msg.type})`;
}

// Best-effort: encontra o cliente cadastrado cujo telefone bate com o waId.
// Compara em formato normalizado (E.164 sem "+"). Retorna null se não achar
// ou se a leitura falhar — nunca lança (não pode bloquear o 200).
async function findClientByPhone(waId) {
  try {
    const target = normalizePhone(waId);
    if (!target) return null;
    const profiles = await dbGet('/clientProfiles').catch(() => null);
    if (profiles && typeof profiles === 'object') {
      for (const [uid, p] of Object.entries(profiles)) {
        if (p && p.phone && normalizePhone(p.phone) === target) {
          return { uid, name: p.name || null };
        }
      }
    }
  } catch (err) {
    console.error('whatsapp-webhook: lookup de cliente falhou:', err.message);
  }
  return null;
}

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
        const field    = change?.field || '';
        const value    = change?.value || {};
        const messages = value.messages || [];
        const statuses = value.statuses || [];
        const contacts = value.contacts || [];
        const contactName = contacts[0]?.profile?.name || '';

        // --- Mensagens recebidas ---
        for (const msg of messages) {
          const from      = msg.from || 'desconhecido';
          const messageId = msg.id || `${from}-${msg.timestamp || Date.now()}`;
          const texto     = extractText(msg);
          const client    = await findClientByPhone(from);

          // Persiste em whatsappMessages/{waId}/{messageId} (best-effort).
          try {
            await dbSet(`/whatsappMessages/${from}/${messageId}`, {
              from,
              name:       contactName || client?.name || null,
              clientUid:  client?.uid || null,
              type:       msg.type || 'unknown',
              text:       texto,
              timestamp:  msg.timestamp || null,
              receivedAt: new Date().toISOString(),
              direction:  'inbound',
              status:     'received'
            });
          } catch (err) {
            console.error('whatsapp-webhook: falha ao persistir mensagem:', err.message);
          }

          // Aviso para o Telegram do admin (best-effort).
          const nome = (contactName || client?.name) ? `${contactName || client.name} ` : '';
          try {
            await sendTelegram(
              `💬 *WhatsApp — mensagem recebida*\n\n` +
              `👤 ${nome}\\(${from}\\)\n` +
              `📝 ${texto}`
            );
          } catch (err) {
            console.error('whatsapp-webhook: falha no Telegram:', err.message);
          }
        }

        // --- Status de entrega/leitura (message_status) ---
        for (const st of statuses) {
          const id = st.id;
          if (!id) continue;
          try {
            await dbPatch(`/whatsappStatuses/${id}`, {
              status:      st.status || null,
              recipientId: st.recipient_id || null,
              timestamp:   st.timestamp || null,
              updatedAt:   new Date().toISOString()
            });
          } catch (err) {
            console.error('whatsapp-webhook: falha ao persistir status:', err.message);
          }
        }

        // --- account_update (ex.: ACCOUNT_OFFBOARDED / ACCOUNT_RECONNECTED) ---
        if (field === 'account_update') {
          try {
            await dbPatch('/integrations/whatsapp/accountUpdate', {
              event:      value.event || null,
              phoneNumber: value.phone_number || null,
              raw:        value,
              receivedAt: new Date().toISOString()
            });
          } catch (err) {
            console.error('whatsapp-webhook: falha ao persistir account_update:', err.message);
          }
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
