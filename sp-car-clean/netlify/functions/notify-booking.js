exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurado' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

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
    if (!body.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: body }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
