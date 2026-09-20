const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }
  if (!originAllowed(event)) return { statusCode: 403, headers: cors, body: JSON.stringify({ ok: false, error: 'origem não permitida' }) };
  if (!rateLimit('create-payment', clientIp(event), { max: 20 })) {
    return { statusCode: 429, headers: cors, body: JSON.stringify({ ok: false, error: 'muitas requisições — tente mais tarde' }) };
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'INFINITEPAY_HANDLE não configurado' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: 'Invalid JSON' }; }

  const { bookingId, finalPrice, customerName, customerEmail, customerPhone, service } = data;
  if (!bookingId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'bookingId é obrigatório' }) };
  }

  // Valor autoritativo: buscamos o preço no Firebase (definido pelo admin ao
  // aprovar) em vez de confiar no `finalPrice` enviado pelo cliente. O valor do
  // cliente só é usado como fallback se o registro ainda não tiver preço (ex.:
  // corrida com a escrita do painel). O webhook (item 1) ainda revalida o valor
  // efetivamente pago.
  let price = Number(finalPrice) || 0;
  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  if (dbUrl && dbSecret) {
    try {
      const r = await fetch(`${dbUrl}/bookings/${encodeURIComponent(bookingId)}.json?auth=${dbSecret}`);
      if (r.ok) {
        const bk = await r.json();
        const dbPrice = Number(bk?.finalPrice) || Number(bk?.price) || 0;
        if (dbPrice > 0) price = dbPrice;
      }
    } catch (e) { /* mantém o fallback do cliente */ }
  }
  if (!price || price <= 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'preço do agendamento indisponível' }) };
  }

  // Embed card fee into price and round up so the business receives the full amount
  const feeRate = parseFloat(process.env.INFINITEPAY_FEE_RATE || '0.0315');
  const priceWithFee = Math.ceil(price / (1 - feeRate));
  const amountInCents = priceWithFee * 100;

  const siteUrl = (process.env.URL || 'https://sp-car-clean.netlify.app').replace(/\/$/, '');
  const redirectUrl = `${siteUrl}/?pagamento=ok&codigo=${bookingId}`;
  const webhookUrl = `${siteUrl}/.netlify/functions/infinitepay-webhook`;

  const payload = {
    handle,
    order_nsu: bookingId,
    redirect_url: redirectUrl,
    webhook_url: webhookUrl,
    items: [{
      description: service || 'Serviço SP Car Clean',
      quantity: 1,
      price: amountInCents
    }],
    customer: {
      name: customerName || '',
      email: customerEmail || '',
      phone: (customerPhone || '').replace(/\D/g, '')
    }
  };

  try {
    const resp = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    if (!resp.ok) {
      return { statusCode: resp.status, headers: cors, body: JSON.stringify({ ok: false, error: result }) };
    }
    const paymentUrl = result.link || result.url || result.payment_url || result.checkout_url || '';
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, paymentUrl, priceWithFee })
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
