// Netlify Scheduled Function — lembrete do dia anterior via WhatsApp.
// Roda todo dia às 10:00 BRT (13:00 UTC). Config em netlify.toml:
//   [functions."reminder-check"] schedule = "0 13 * * *"
//
// Varre /bookings no Firebase, encontra agendamentos marcados para AMANHÃ
// (horário de Brasília) com status ativo e telefone, e dispara o template
// `lembrete_agendamento` ao cliente. Marca `reminderSentAt` para não enviar
// o mesmo lembrete duas vezes.
//
// Reaproveita as variáveis já existentes:
//   FIREBASE_DATABASE_URL, FIREBASE_DATABASE_SECRET (como o birthday-check)
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (como o notify-booking)

const { dbGet, dbPatch }        = require('./lib/core/firebase');
const { sendWhatsAppTemplate, isConfigured } = require('./lib/core/whatsapp');

// Status que ainda merecem lembrete (agendamento de pé).
const ACTIVE_STATUSES = ['approved', 'confirmed'];

// Data de "amanhã" no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
function tomorrowBRT() {
  const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  brtNow.setUTCDate(brtNow.getUTCDate() + 1);
  return brtNow.toISOString().slice(0, 10); // YYYY-MM-DD
}

function fmtBR(ymd) {
  if (!ymd || ymd.length < 10) return ymd || '-';
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

exports.handler = async () => {
  if (!isConfigured()) {
    console.log('reminder-check: WhatsApp não configurado — nada a enviar');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'whatsapp_not_configured' }) };
  }

  const target = tomorrowBRT();

  let bookings;
  try {
    bookings = await dbGet('/bookings');
  } catch (err) {
    console.error('reminder-check: erro lendo bookings:', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }

  if (!bookings || typeof bookings !== 'object') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, date: target, sent: 0 }) };
  }

  let sent = 0, skipped = 0;
  const errors = [];

  for (const [key, b] of Object.entries(bookings)) {
    if (!b || typeof b !== 'object') continue;
    const bookingDate = (b.startDate || b.date || '').slice(0, 10);
    if (bookingDate !== target)                 { continue; }
    if (!ACTIVE_STATUSES.includes(b.status))    { continue; }
    if (!b.phone)                               { skipped++; continue; }
    if (b.reminderSentAt === target)            { skipped++; continue; } // já lembrado

    const res = await sendWhatsAppTemplate('reminder', {
      name:  b.name || 'Cliente',
      phone: b.phone,
      date:  fmtBR(bookingDate)
    });

    if (res.ok) {
      sent++;
      // Marca para dedupe (best-effort; não falha o fluxo se o patch der erro).
      try { await dbPatch(`/bookings/${b.id || key}`, { reminderSentAt: target }); }
      catch (e) { console.warn('reminder-check: falha ao marcar reminderSentAt:', e.message); }
    } else {
      errors.push({ id: b.id || key, reason: res.error || res.skipped });
    }
  }

  console.log(`reminder-check: ${sent} lembrete(s) para ${target} (skipped ${skipped})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, date: target, sent, skipped, errors }) };
};
