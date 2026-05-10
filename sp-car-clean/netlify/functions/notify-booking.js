exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token      = process.env.ZAPI_TOKEN;

  if (!instanceId || !token) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'ZAPI_INSTANCE_ID ou ZAPI_TOKEN não configurado' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { id, name, phone, car, plate, service, carSize, date, price, obs } = data;

  const message =
    `🔔 *Nova Solicitação — SP Car Clean*\n\n` +
    `📋 *Código:* ${id}\n` +
    `👤 *Cliente:* ${name}\n` +
    `📱 *WhatsApp:* ${phone}\n` +
    `🚗 *Veículo:* ${car}${plate ? ' | ' + plate : ''}\n` +
    `🔧 *Serviço:* ${service} (${carSize === 'pq' ? 'Pequeno' : 'Grande'})\n` +
    `📅 *Data solicitada:* ${date}\n` +
    `💰 *Valor estimado:* ${price}` +
    (obs ? `\n📝 *Obs:* ${obs}` : '');

  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5511926697474', message })
    });
    const body = await resp.json();
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: body }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, zapi: body }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
