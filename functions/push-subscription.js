'use strict';

// /api/push-subscription — notificações push (Web Push padrão).
// GET  → { publicKey }: chave VAPID pública que o navegador usa para se inscrever.
// POST → cadastra um aparelho. Corpo: { subscription: PushSubscription.toJSON(), ua?, audience? }
//   audience 'admin' (padrão) → exige Authorization: Bearer <token do admin>
//   audience 'client'         → avisos do próprio agendamento. Vale um dos dois (ou ambos):
//     • Authorization: Bearer <token do cliente logado> → todos os agendamentos da conta
//     • { bookingId, email } conferidos no Firebase   → só aquele agendamento (sem conta)

const { publicKey, isValidSubscription, saveSubscription, saveClientSubscription, clientTarget } = require('./lib/webpush');
const { verifyAdmin, lookupUser, bearerToken } = require('./lib/admin-auth');
const { dbGet } = require('./lib/core/firebase');
const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

// Alvos que o cliente provou serem dele (token e/ou código + e-mail do agendamento).
async function clientTargets(event, data) {
  const targets = [];
  const user = await lookupUser(bearerToken(event));
  if (user) targets.push(clientTarget('uid', user.uid), clientTarget('email', user.email));

  const bookingId = String(data.bookingId || '').trim().toUpperCase();
  const email = String(data.email || '').trim().toLowerCase();
  if (/^[A-Z0-9-]{4,40}$/.test(bookingId) && email.includes('@')) {
    const booking = await dbGet(`/bookings/${encodeURIComponent(bookingId)}`).catch(() => null);
    if (booking && String(booking.email || '').trim().toLowerCase() === email) {
      targets.push(clientTarget('booking', bookingId));
    }
  }
  return targets.filter(Boolean);
}

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

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }
  if (!isValidSubscription(data.subscription)) return reply(400, { ok: false, error: 'inscrição inválida' });

  try {
    if (data.audience === 'client') {
      const targets = await clientTargets(event, data);
      if (!targets.length) return reply(403, { ok: false, error: 'não autorizado' });
      await saveClientSubscription(data.subscription, data.ua, targets);
      return reply(200, { ok: true, targets: targets.length });
    }

    if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });
    await saveSubscription(data.subscription, data.ua);
  } catch (err) {
    console.error('push-subscription: falha ao salvar', err.message);
    return reply(500, { ok: false, error: 'falha ao salvar' });
  }
  return reply(200, { ok: true });
};
