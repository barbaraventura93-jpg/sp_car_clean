'use strict';

// /api/notify-client — push no celular do cliente quando o serviço dele muda
// (orçamento aprovado, reagendamento, check-in, conclusão, cancelamento...).
// Chamado pelo painel admin junto com o e-mail de cada mudança.
//
// POST (Authorization: Bearer <token do admin>)
//   { bookingId, title, body }
// O destino sai do próprio agendamento no Firebase (código, conta e e-mail do
// cliente) — o painel não escolhe para quem vai.

const { pushBookingUpdate } = require('./lib/webpush');
const { verifyAdmin, bearerToken } = require('./lib/admin-auth');
const { dbGet } = require('./lib/core/firebase');
const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  const reply = (status, body) => ({
    statusCode: status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });
  if (!originAllowed(event)) return reply(403, { ok: false, error: 'origem não permitida' });
  if (!rateLimit('notify-client', clientIp(event), { max: 200 })) {
    return reply(429, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }
  if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

  const bookingId = String(data.bookingId || '').trim();
  if (!/^[A-Za-z0-9-]{4,40}$/.test(bookingId)) return reply(400, { ok: false, error: 'agendamento inválido' });

  let booking;
  try { booking = await dbGet(`/bookings/${encodeURIComponent(bookingId)}`); }
  catch (err) { return reply(502, { ok: false, error: 'falha ao ler o agendamento' }); }
  if (!booking) return reply(404, { ok: false, error: 'agendamento não encontrado' });

  const push = await pushBookingUpdate({ id: bookingId, ...booking }, data.title, data.body);
  return reply(200, { ok: true, push });
};
