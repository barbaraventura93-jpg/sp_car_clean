// Cron diário — lembrete do dia anterior.
// Roda todo dia às 10:00 BRT (13:00 UTC) — EventBridge Scheduler, infra/api.tf.
//
// Varre /bookings no Firebase, encontra agendamentos marcados para AMANHÃ
// (horário de Brasília) com status ativo e avisa o cliente por e-mail (EmailJS).
// Marca `reminderSentAt` para não enviar o mesmo lembrete duas vezes.
//
// Variáveis: FIREBASE_DATABASE_URL, FIREBASE_DATABASE_SECRET,
//            EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY (opcional)

const { dbGet, dbPatch } = require('./lib/core/firebase');
const { sendEmail } = require('./lib/core/email');

// Status que ainda merecem lembrete (agendamento de pé).
const ACTIVE_STATUSES = ['approved', 'confirmed'];

const UPDATE_TEMPLATE = process.env.EMAILJS_UPDATE_TEMPLATE || 'template_update';

function emailConfigured() {
  return Boolean(process.env.EMAILJS_SERVICE_ID && process.env.EMAILJS_PUBLIC_KEY);
}

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

async function sendReminderEmail(b, dataFmt) {
  const firstName = (b.name || 'Cliente').split(' ')[0];
  await sendEmail({
    templateId: UPDATE_TEMPLATE,
    params: {
      to_email:   b.email,
      to_name:    b.name || 'Cliente',
      booking_id: b.id,
      titulo:     '⏰ Lembrete do seu agendamento — SP Car Clean',
      mensagem:
        `Olá ${firstName}! ⏰\n\n` +
        `Passando para lembrar que você tem um agendamento na SP Car Clean amanhã, ${dataFmt}.\n\n` +
        `📋 Código: ${b.id}\n\n` +
        `Se precisar remarcar ou cancelar, acesse "Meus agendamentos" no site. Até amanhã! 🚗✨\n\n` +
        `— — — — —\n` +
        `📍 Rua São José, 301 — Parque Santo Antônio, Guarulhos-SP\n` +
        `🕗 Entrada 08:00 · Retirada até 18:00\n` +
        `📱 WhatsApp: (11) 92669-7474`
    }
  });
}

exports.handler = async () => {
  if (!emailConfigured()) {
    console.log('reminder-check: e-mail não configurado — nada a enviar');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no_channel_configured' }) };
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
    if (bookingDate !== target)              { continue; }
    if (!ACTIVE_STATUSES.includes(b.status)) { continue; }
    if (b.reminderSentAt === target)         { skipped++; continue; } // já lembrado

    if (!b.email) { skipped++; continue; }

    try {
      await sendReminderEmail(b, fmtBR(bookingDate));
    } catch (e) {
      errors.push({ id: b.id || key, canal: 'email', reason: e.message });
      continue;
    }

    sent++;
    // Marca para dedupe (best-effort; não falha o fluxo se o patch der erro).
    try { await dbPatch(`/bookings/${b.id || key}`, { reminderSentAt: target }); }
    catch (e) { console.warn('reminder-check: falha ao marcar reminderSentAt:', e.message); }
  }

  console.log(`reminder-check: ${sent} lembrete(s) para ${target} (skipped ${skipped})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, date: target, sent, skipped, errors }) };
};
