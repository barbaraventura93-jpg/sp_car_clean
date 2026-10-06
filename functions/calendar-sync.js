'use strict';

// Agendamentos na agenda — sem Google Cloud nem cartão de crédito.
//
//  • Admin: um Google Apps Script na conta do admin (scripts/agenda-admin.gs)
//    lê o feed JSON a cada 5 min e cria/atualiza/apaga os eventos na agenda dele.
//      GET /api/calendar-sync?feed=admin&token=…            → JSON para o Apps Script
//      GET /api/calendar-sync?feed=admin&token=…&format=ics → mesma agenda em .ics
//  • Cliente: assina a "agenda dos meus agendamentos" (.ics) no Google Agenda,
//    iPhone ou Outlook — a agenda se atualiza sozinha.
//      GET /api/calendar-sync?feed=client&e=…&sig=…         → .ics só com os agendamentos dele
//
//  POST (gera os links; quem pede precisa provar quem é):
//    { action: 'admin-links' }   + Authorization do admin
//    { action: 'client-link', bookingId?, email? } + (token do cliente | código + e-mail)
//
// Os links levam uma assinatura HMAC (CALENDAR_FEED_SECRET no SSM; sem ele,
// deriva do segredo de origem do CloudFront, que já existe no Lambda).

const crypto = require('crypto');
const { dbGet } = require('./lib/core/firebase');
const { verifyAdmin, lookupUser, bearerToken } = require('./lib/admin-auth');
const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

const SHOWN = ['pending', 'approved', 'confirmed', 'completed'];
const REMOVED = ['rejected', 'cancelled'];
const PAST_DAYS = 30; // o feed do admin traz o que terminou há até 30 dias

const ymd = (s) => String(s || '').slice(0, 10);
const fmtBR = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-');
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const validTime = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? t : null);
const siteUrl = () => (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

// ── Assinaturas dos links ────────────────────────────────────────────────
function feedSecret() {
  const s = process.env.CALENDAR_FEED_SECRET || process.env.ORIGIN_VERIFY_SECRET;
  if (!s) throw new Error('segredo do feed não configurado');
  return s;
}
const sign = (what, len) => crypto.createHmac('sha256', feedSecret()).update(what).digest('hex').slice(0, len);
const adminToken = () => sign('agenda-admin', 40);
const clientSig = (email) => sign('agenda-cliente:' + email, 32);
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function adminLinks() {
  const base = `${siteUrl()}/api/calendar-sync?feed=admin&token=${adminToken()}`;
  return { json: base, ics: `${base}&format=ics` };
}
function clientLinks(email) {
  const e = Buffer.from(email).toString('base64url');
  const ics = `${siteUrl()}/api/calendar-sync?feed=client&e=${e}&sig=${clientSig(email)}`;
  const webcal = ics.replace(/^https:/, 'webcal:');
  return { ics, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

// ── Eventos ──────────────────────────────────────────────────────────────
function serviceLabel(b, services) {
  const ids = (Array.isArray(b.services) && b.services.length ? b.services : [b.service]).filter(Boolean);
  return ids.map((id) => (services[id] && services[id].name) || id).join(' + ') || 'Serviço';
}

/** Evento do agendamento (horário de Brasília, UTC-3) — ou null sem data válida. */
function buildEvent(b, { services, cfg }, audience) {
  const start = ymd(b.startDate || b.date);
  let end = ymd(b.endDate || b.pickup || start);
  if (!validDate(start)) return null;
  if (!validDate(end) || end < start) end = start;

  const pending = b.status === 'pending';
  const dropoff = validTime(cfg.dropoffTime) || '08:00';
  const pickup = validTime(cfg.pickupTime) || '18:00';
  const label = serviceLabel(b, services);
  const price = Number(b.priceWithFee || b.finalPrice || b.price) || 0;
  const lines = audience === 'admin'
    ? [
        `Código: ${b.id}${pending ? ' (aguardando aprovação)' : ''}`,
        `Serviço(s): ${label}`,
        `Veículo: ${b.car || '-'}${b.plate ? ' | ' + b.plate : ''}`,
        `Cliente: ${b.name || '-'}${b.phone ? ' · ' + b.phone : ''}`,
        price ? `Valor: R$ ${price.toFixed(2).replace('.', ',')}` : null,
        b.adminNotes ? `Nota: ${b.adminNotes}` : null
      ]
    : [
        `Código: ${b.id}`,
        pending ? 'Aguardando aprovação — a data pode mudar.' : null,
        `Serviço(s): ${label}`,
        `Veículo: ${b.car || '-'}${b.plate ? ' | ' + b.plate : ''}`
      ];
  lines.push(`Entrada: ${fmtBR(start)} às ${dropoff} · Retirada: ${fmtBR(end)} às ${pickup}`, '',
    `Acompanhe: ${siteUrl()}/?consulta=${encodeURIComponent(b.id)}`);

  const event = {
    id: String(b.id),
    title: audience === 'admin'
      ? `${pending ? '⏳ ' : ''}🚗 ${label} — ${b.name || 'Cliente'}`
      : `${pending ? '⏳ ' : b.status === 'completed' ? '✅ ' : ''}SP Car Clean — ${label}`,
    start: `${start}T${dropoff}:00-03:00`,
    end: `${end}T${pickup}:00-03:00`,
    location: b.approvedLocation || cfg.location || 'SP Car Clean',
    description: lines.filter((l) => l !== null).join('\n')
  };
  event.hash = crypto.createHash('sha1').update(JSON.stringify(event)).digest('hex').slice(0, 16);
  return event;
}

async function loadData() {
  const [bookings, services, cfg] = await Promise.all([
    dbGet('/bookings'),
    dbGet('/services').catch(() => null),
    dbGet('/config').catch(() => null)
  ]);
  const list = Object.entries(bookings || {})
    .filter(([, b]) => b && typeof b === 'object')
    .map(([key, b]) => ({ ...b, id: b.id || key }));
  return { list, ctx: { services: services || {}, cfg: cfg || {} } };
}

// Feed do Apps Script: eventos atuais + ids que ainda existem (o que sumir daqui
// é apagado da agenda; o que só ficou antigo fica como está).
async function adminFeed() {
  const { list, ctx } = await loadData();
  const cutoff = new Date(Date.now() - PAST_DAYS * 86400000).toISOString().slice(0, 10);
  const shown = list.filter((b) => SHOWN.includes(b.status));
  return {
    generatedAt: new Date().toISOString(),
    ids: list.filter((b) => !REMOVED.includes(b.status)).map((b) => b.id),
    events: shown
      .filter((b) => ymd(b.endDate || b.pickup || b.startDate || b.date) >= cutoff)
      .map((b) => buildEvent(b, ctx, 'admin'))
      .filter(Boolean)
  };
}

// ── iCalendar ────────────────────────────────────────────────────────────
const icsEsc = (v) => String(v).replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '');
// Linhas de até 75 octetos (RFC 5545), continuação com espaço.
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

function toIcs(events, calName) {
  const stamp = icsDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SP Car Clean//Agenda//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(calName)}`, 'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@spcarclean.com.br`, `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEsc(e.title)}`, `LOCATION:${icsEsc(e.location)}`, `DESCRIPTION:${icsEsc(e.description)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:Lembrete SP Car Clean', 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const icsResponse = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
  body
});

// ── Handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Cron antigo (Google Calendar API) desativado: nada a fazer.
  if (!event || !event.httpMethod) return { ok: true, skipped: 'feed-mode' };

  const cors = { ...corsHeaders(event), 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  const reply = (status, body) => ({ statusCode: status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      if (!rateLimit('calendar-feed', clientIp(event), { max: 240 })) return reply(429, { ok: false, error: 'muitas requisições' });

      if (q.feed === 'admin') {
        if (!safeEqual(q.token, adminToken())) return reply(403, { ok: false, error: 'link inválido' });
        const feed = await adminFeed();
        if (q.format === 'ics') return icsResponse(toIcs(feed.events, 'SP Car Clean — agendamentos'));
        return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(feed) };
      }

      if (q.feed === 'client') {
        let email = '';
        try { email = Buffer.from(String(q.e || ''), 'base64url').toString('utf8').trim().toLowerCase(); } catch { /* inválido */ }
        if (!email.includes('@') || !safeEqual(q.sig, clientSig(email))) return reply(403, { ok: false, error: 'link inválido' });
        const { list, ctx } = await loadData();
        const events = list
          .filter((b) => SHOWN.includes(b.status) && String(b.email || '').trim().toLowerCase() === email)
          .map((b) => buildEvent(b, ctx, 'client'))
          .filter(Boolean);
        return icsResponse(toIcs(events, 'SP Car Clean — meus agendamentos'));
      }
      return reply(400, { ok: false, error: 'feed inválido' });
    }

    if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });
    if (!originAllowed(event)) return reply(403, { ok: false, error: 'origem não permitida' });
    if (!rateLimit('calendar-links', clientIp(event), { max: 30 })) return reply(429, { ok: false, error: 'muitas requisições' });

    let data;
    try { data = JSON.parse(event.body || '{}'); } catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

    if (data.action === 'admin-links') {
      if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });
      return reply(200, { ok: true, ...adminLinks() });
    }

    if (data.action === 'client-link') {
      // Conta logada → e-mail da conta; sem conta → código + e-mail conferidos no agendamento.
      const user = await lookupUser(bearerToken(event));
      let email = user && user.email;
      if (!email) {
        const id = String(data.bookingId || '').trim().toUpperCase();
        const wanted = String(data.email || '').trim().toLowerCase();
        if (/^[A-Z0-9-]{4,40}$/.test(id) && wanted.includes('@')) {
          const b = await dbGet(`/bookings/${encodeURIComponent(id)}`).catch(() => null);
          if (b && String(b.email || '').trim().toLowerCase() === wanted) email = wanted;
        }
      }
      if (!email) return reply(403, { ok: false, error: 'não autorizado' });
      return reply(200, { ok: true, ...clientLinks(email) });
    }

    return reply(400, { ok: false, error: 'ação inválida' });
  } catch (err) {
    console.error('calendar-sync:', err.message);
    return reply(500, { ok: false, error: 'falha ao gerar a agenda' });
  }
};

exports._test = { buildEvent, toIcs, adminToken, clientSig, clientLinks };
