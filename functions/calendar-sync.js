'use strict';

// Sincroniza os agendamentos com o Google Agenda do admin.
//  • Cron a cada 15 min (EventBridge Scheduler, infra/api.tf)
//  • POST /api/calendar-sync com o token do admin → botão "Sincronizar agora" do painel
//
// Cada agendamento vira um evento (id fixo derivado do código) da entrada à
// retirada do veículo. Pendentes aparecem com ⏳. Rejeitados, cancelados e
// excluídos saem da agenda. A partir da aprovação o cliente entra como
// convidado (GOOGLE_CALENDAR_INVITE_CLIENTS, padrão ligado): o Google manda o
// convite e mantém o evento atualizado na agenda do cliente — reagendou,
// muda lá; cancelou, some.
//
// Só manda ao Google o que mudou: o hash de cada evento fica em /calendarSync.

const crypto = require('crypto');
const { dbGet, dbPatch } = require('./lib/core/firebase');
const gcal = require('./lib/google-calendar');
const { verifyAdmin, bearerToken } = require('./lib/admin-auth');
const { originAllowed, corsHeaders } = require('./lib/guard');

const SHOWN = ['pending', 'approved', 'confirmed', 'completed'];
const REMOVED = ['rejected', 'cancelled'];
const TZ = 'America/Sao_Paulo';
const PAST_DAYS = 30; // agendamentos que terminaram há mais tempo não são mexidos
// Para antes do teto do Lambda (29 s) e salva o progresso; a próxima rodada continua.
const TIME_BUDGET_MS = 20_000;

const inviteClients = () => !/^(0|false|não|nao|no)$/i.test(process.env.GOOGLE_CALENDAR_INVITE_CLIENTS || 'true');
const ymd = (s) => String(s || '').slice(0, 10);
const fmtBR = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-');
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const validTime = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? t : null);

function serviceLabel(b, services) {
  const ids = (Array.isArray(b.services) && b.services.length ? b.services : [b.service]).filter(Boolean);
  const names = ids.map((id) => (services[id] && services[id].name) || id);
  return names.join(' + ') || 'Serviço';
}

// Evento desejado para o agendamento — ou null se ele não deve estar na agenda.
function buildEvent(b, { services, cfg, site }) {
  const start = ymd(b.startDate || b.date);
  let end = ymd(b.endDate || b.pickup || start);
  if (!validDate(start)) return null;
  if (!validDate(end) || end < start) end = start;

  const pending = b.status === 'pending';
  const dropoff = validTime(cfg.dropoffTime) || '08:00';
  const pickup = validTime(cfg.pickupTime) || '18:00';
  const location = b.approvedLocation || cfg.location || 'SP Car Clean';
  const label = serviceLabel(b, services);
  const price = Number(b.priceWithFee || b.finalPrice || b.price) || 0;

  const event = {
    id: gcal.eventId(b.id),
    status: 'confirmed',
    summary: `${pending ? '⏳ ' : ''}🚗 ${label} — ${b.name || 'Cliente'}`,
    location,
    description: [
      `Código: ${b.id}${pending ? ' (aguardando aprovação)' : ''}`,
      `Serviço(s): ${label}`,
      `Veículo: ${b.car || '-'}${b.plate ? ' | ' + b.plate : ''}`,
      `Cliente: ${b.name || '-'}${b.phone ? ' · ' + b.phone : ''}`,
      price ? `Valor: R$ ${price.toFixed(2).replace('.', ',')}` : null,
      `Entrada: ${fmtBR(start)} às ${dropoff} · Retirada: ${fmtBR(end)} às ${pickup}`,
      b.adminNotes ? `Nota: ${b.adminNotes}` : null,
      '',
      `Acompanhe: ${site}/?consulta=${encodeURIComponent(b.id)}`
    ].filter((l) => l !== null).join('\n'),
    start: { dateTime: `${start}T${dropoff}:00`, timeZone: TZ },
    end: { dateTime: `${end}T${pickup}:00`, timeZone: TZ },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
    extendedProperties: { private: { spccBookingId: String(b.id) } }
  };
  if (!pending && inviteClients() && /@/.test(b.email || '')) {
    event.attendees = [{ email: String(b.email).trim().toLowerCase(), displayName: b.name || undefined }];
  }
  return event;
}

const hashOf = (event) => crypto.createHash('sha1').update(JSON.stringify(event)).digest('hex');

async function sync() {
  if (!gcal.configured()) return { ok: false, skipped: 'google-calendar-not-configured' };

  const [bookings, state, services, cfg] = await Promise.all([
    dbGet('/bookings'),
    dbGet('/calendarSync').catch(() => null),
    dbGet('/services').catch(() => null),
    dbGet('/config').catch(() => null)
  ]);
  const ctx = {
    services: services || {},
    cfg: cfg || {},
    site: (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '')
  };
  const prev = state || {};
  const all = bookings || {};
  const cutoff = new Date(Date.now() - PAST_DAYS * 86400000).toISOString().slice(0, 10);
  const updates = {};
  const stats = { upserted: 0, deleted: 0, unchanged: 0, errors: [], partial: false };
  const deadline = Date.now() + TIME_BUDGET_MS;

  for (const [key, raw] of Object.entries(all)) {
    if (Date.now() > deadline) { stats.partial = true; break; }
    if (!raw || typeof raw !== 'object') continue;
    const b = { id: raw.id || key, ...raw };
    const had = prev[key];
    const sendUpdates = had && had.invited ? 'all' : 'none';

    try {
      if (REMOVED.includes(b.status)) {
        if (had) {
          await gcal.deleteEvent(had.eventId || gcal.eventId(b.id), sendUpdates);
          updates[key] = null;
          stats.deleted++;
        }
        continue;
      }
      if (!SHOWN.includes(b.status)) continue;
      if (ymd(b.endDate || b.pickup || b.startDate || b.date) < cutoff && !had) continue;

      const event = buildEvent(b, ctx);
      if (!event) continue;
      const hash = hashOf(event);
      if (had && had.hash === hash) { stats.unchanged++; continue; }

      // Avisa o Google (e o cliente) quando há convidado agora ou havia antes.
      const invited = Boolean(event.attendees);
      await gcal.upsertEvent(event, invited || (had && had.invited) ? 'all' : 'none');
      updates[key] = { hash, eventId: event.id, invited, at: new Date().toISOString() };
      stats.upserted++;
    } catch (err) {
      stats.errors.push({ id: b.id, error: err.message });
      if (/OAuth/.test(err.message)) break; // token inválido: não adianta seguir
    }
  }

  // Agendamentos excluídos do banco → remove o evento.
  for (const [key, had] of Object.entries(prev)) {
    if (Date.now() > deadline) { stats.partial = true; break; }
    if (all[key] || !had) continue;
    try {
      await gcal.deleteEvent(had.eventId, had.invited ? 'all' : 'none');
      updates[key] = null;
      stats.deleted++;
    } catch (err) { stats.errors.push({ id: key, error: err.message }); }
  }

  if (Object.keys(updates).length) await dbPatch('/calendarSync', updates);
  if (stats.errors.length) console.error('calendar-sync: erros', JSON.stringify(stats.errors).slice(0, 2000));
  console.log(`calendar-sync: ${stats.upserted} atualizado(s), ${stats.deleted} removido(s), ${stats.unchanged} sem mudança`);
  return { ok: stats.errors.length === 0, ...stats };
}

exports.handler = async (event) => {
  // Cron (EventBridge Scheduler): não é HTTP.
  if (!event || !event.httpMethod) return sync();

  const cors = { ...corsHeaders(event), 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  const reply = (status, body) => ({ statusCode: status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });
  if (!originAllowed(event)) return reply(403, { ok: false, error: 'origem não permitida' });
  if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });

  try {
    return reply(200, await sync());
  } catch (err) {
    console.error('calendar-sync:', err.message);
    return reply(500, { ok: false, error: err.message });
  }
};

exports._test = { buildEvent, hashOf };
