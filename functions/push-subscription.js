'use strict';

// /api/push-subscription — notificações push do admin (Web Push padrão).
// GET  → { publicKey }: chave VAPID pública que o navegador usa para se inscrever.
// POST → cadastra o aparelho do admin. Exige Authorization: Bearer <token do admin>.
//        Corpo: { subscription: PushSubscription.toJSON(), ua?: string }

const { publicKey, isValidSubscription, saveSubscription } = require('./lib/webpush');
const { verifyAdmin, bearerToken } = require('./lib/admin-auth');
const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  const reply = (status, body) => ({
    statusCode: status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  if (event.httpMethod === 'GET') {
    const key = publicKey();
    return key ? reply(200, { publicKey: key }) : reply(503, { ok: false, error: 'push não configurado' });
  }

  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });
  if (!originAllowed(event)) return reply(403, { ok: false, error: 'origem não permitida' });
  if (!rateLimit('push-subscription', clientIp(event), { max: 20 })) {
    return reply(429, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }
  if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }
  if (!isValidSubscription(data.subscription)) return reply(400, { ok: false, error: 'inscrição inválida' });

  try {
    await saveSubscription(data.subscription, data.ua);
  } catch (err) {
    console.error('push-subscription: falha ao salvar', err.message);
    return reply(500, { ok: false, error: 'falha ao salvar' });
  }
  return reply(200, { ok: true });
};
