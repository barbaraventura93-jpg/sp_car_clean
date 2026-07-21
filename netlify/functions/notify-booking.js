const { sendAdminPush } = require('./lib/fcm');

// Título/corpo curtos da notificação push por tipo de evento.
function buildPush(data) {
  switch (data.type) {
    case 'reschedule':
      return { title: '📅 Pedido de reagendamento', body: `${data.name} · ${data.currentDate} → ${data.newDate}` };
    case 'reschedule-approved':
      return { title: '✅ Reagendamento aprovado', body: `${data.name} · ${data.newDate}` };
    case 'reschedule-rejected':
      return { title: '❌ Reagendamento recusado', body: `${data.name}` };
    case 'client-cancel':
      return { title: '🚫 Cancelamento pelo cliente', body: `${data.name} · ${data.service || ''} · ${data.date || ''}`.trim() };
    case 'price-correction':
      return { title: '💵 Correção de valor', body: `${data.name} · ${data.oldPrice} → ${data.newPrice}` };
    default:
      return { title: '🔔 Nova solicitação', body: `${data.name} · ${data.service || ''} · ${data.date || ''}`.trim() };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  // Push para o celular do admin (best-effort; independente do Telegram).
  const portalLink = `${(process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '')}/?admin`;
  const pushPromise = (async () => {
    try {
      const p = buildPush(data);
      return await sendAdminPush({ title: p.title, body: p.body, link: portalLink });
    } catch (err) {
      return { ok: false, skipped: err.message };
    }
  })();

  if (!botToken || !chatId) {
    // Sem Telegram configurado ainda tentamos entregar o push antes de sair.
    const push = await pushPromise;
    return { statusCode: 200, body: JSON.stringify({ ok: true, telegram: false, push }) };
  }

  const portalUrl = `${process.env.URL || 'https://sp-car-clean.web.app'}/?admin`;
  let text;

  if (data.type === 'reschedule') {
    const { id, name, phone, currentDate, newDate, note } = data;
    text =
      `📅 *Solicitação de Reagendamento — SP Car Clean*\n\n` +
      `📋 *Código:* ${id}\n` +
      `👤 *Cliente:* ${name}\n` +
      `📱 *WhatsApp:* ${phone}\n` +
      `🗓️ *Data atual:* ${currentDate}\n` +
      `🗓️ *Nova data pedida:* ${newDate}` +
      (note ? `\n📝 *Motivo:* ${note}` : '') +
      `\n\n🔗 [Abrir portal admin](${portalUrl})`;

  } else if (data.type === 'reschedule-approved') {
    const { id, name, phone, newDate } = data;
    text =
      `✅ *Reagendamento Aprovado — SP Car Clean*\n\n` +
      `📋 *Código:* ${id}\n` +
      `👤 *Cliente:* ${name}\n` +
      `📱 *WhatsApp:* ${phone}\n` +
      `🗓️ *Nova data confirmada:* ${newDate}\n\n` +
      `🔗 [Abrir portal admin](${portalUrl})`;

  } else if (data.type === 'client-cancel') {
    const { id, name, phone, service, date, refund } = data;
    text =
      `🚫 *Cancelamento pelo Cliente — SP Car Clean*\n\n` +
      `📋 *Código:* ${id}\n` +
      `👤 *Cliente:* ${name}\n` +
      `📱 *WhatsApp:* ${phone}\n` +
      `🔧 *Serviço:* ${service}\n` +
      `📅 *Data do agendamento:* ${date}\n` +
      (refund
        ? `💰 *Reembolso:* ✅ Aplicável \\(cancelamento dentro do prazo\\)`
        : `💰 *Reembolso:* ❌ Não aplicável \\(fora do prazo de 1 dia útil\\)`) +
      `\n\n🔗 [Abrir portal admin](${portalUrl})`;

  } else if (data.type === 'price-correction') {
    const { id, name, oldPrice, newPrice, reason } = data;
    text =
      `💵 *Correção de Valor — SP Car Clean*\n\n` +
      `📋 *Código:* ${id}\n` +
      `👤 *Cliente:* ${name}\n` +
      `💰 *Valor:* ${oldPrice} → ${newPrice}\n` +
      `📝 *Motivo:* ${reason}\n\n` +
      `🔗 [Abrir portal admin](${portalUrl})`;

  } else if (data.type === 'reschedule-rejected') {
    const { id, name, phone } = data;
    text =
      `❌ *Reagendamento Recusado — SP Car Clean*\n\n` +
      `📋 *Código:* ${id}\n` +
      `👤 *Cliente:* ${name}\n` +
      `📱 *WhatsApp:* ${phone}\n` +
      `📌 *Data original mantida.*\n\n` +
      `🔗 [Abrir portal admin](${portalUrl})`;

  } else {
    // novo agendamento (comportamento original)
    const { id, name, phone, car, plate, service, carSize, date, price, obs } = data;
    text =
      `🔔 *Nova Solicitação — SP Car Clean*\n\n` +
      `📋 *Código:* ${id}\n` +
      `👤 *Cliente:* ${name}\n` +
      `📱 *WhatsApp:* ${phone}\n` +
      `🚗 *Veículo:* ${car}${plate ? ' | ' + plate : ''}\n` +
      `🔧 *Serviço:* ${service} \\(${carSize === 'pq' ? 'Pequeno' : 'Grande'}\\)\n` +
      `📅 *Data solicitada:* ${date}\n` +
      `💰 *Valor estimado:* ${price}` +
      (obs ? `\n📝 *Obs:* ${obs}` : '') +
      `\n\n🔗 [Abrir portal admin](${portalUrl})`;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    const body = await resp.json();
    const push = await pushPromise;
    if (!body.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: body, push }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, push }) };
  } catch (err) {
    const push = await pushPromise.catch(() => ({ ok: false }));
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message, push }) };
  }
};
