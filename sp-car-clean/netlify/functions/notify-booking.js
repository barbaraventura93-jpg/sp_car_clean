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

  const { id, name, phone, car, plate, service, carSize, date, price, obs } = data;

  const text =
    `🔔 *Nova Solicitação — SP Car Clean*\n\n` +
    `📋 *Código:* ${id}\n` +
    `👤 *Cliente:* ${name}\n` +
    `📱 *WhatsApp:* ${phone}\n` +
    `🚗 *Veículo:* ${car}${plate ? ' | ' + plate : ''}\n` +
    `🔧 *Serviço:* ${service} \\(${carSize === 'pq' ? 'Pequeno' : 'Grande'}\\)\n` +
    `📅 *Data solicitada:* ${date}\n` +
    `💰 *Valor estimado:* ${price}` +
    (obs ? `\n📝 *Obs:* ${obs}` : '');

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
    return { statusCode: 200, body: JSON.stringify({ ok: true, telegram: body }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
