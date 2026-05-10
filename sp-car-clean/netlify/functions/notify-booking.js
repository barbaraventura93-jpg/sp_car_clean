exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'CALLMEBOT_API_KEY not set' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { id, name, phone, car, plate, service, carSize, date, price, obs } = data;

  const text = encodeURIComponent(
    `🔔 *Nova Solicitação — SP Car Clean*\n\n` +
    `📋 *Código:* ${id}\n` +
    `👤 *Cliente:* ${name}\n` +
    `📱 *WhatsApp:* ${phone}\n` +
    `🚗 *Veículo:* ${car}${plate ? ' | ' + plate : ''}\n` +
    `🔧 *Serviço:* ${service} (${carSize === 'pq' ? 'Pequeno' : 'Grande'})\n` +
    `📅 *Data solicitada:* ${date}\n` +
    `💰 *Valor estimado:* ${price}` +
    (obs ? `\n📝 *Obs:* ${obs}` : '')
  );

  const url = `https://api.callmebot.com/whatsapp.php?phone=+5511926697474&text=${text}&apikey=${apiKey}`;

  try {
    const resp = await fetch(url);
    const body = await resp.text();
    return { statusCode: 200, body: JSON.stringify({ ok: true, callmebot: body }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
