const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }
  if (!originAllowed(event)) return { statusCode: 403, headers: cors, body: JSON.stringify({ ok: false, error: 'origem não permitida' }) };
  if (!rateLimit('create-gift-payment', clientIp(event), { max: 20 })) {
    return { statusCode: 429, headers: cors, body: JSON.stringify({ ok: false, error: 'muitas requisições — tente mais tarde' }) };
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'INFINITEPAY_HANDLE não configurado' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: 'Invalid JSON' }; }

  const { code, amount, buyerName, buyerEmail, buyerPhone } = data;
  if (!code) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'code é obrigatório' }) };
  }

  // Valor autoritativo: lê o valor do gift card gravado no Firebase (o front cria
  // o registro `pending` antes de pedir o link). O valor do cliente é só fallback.
  let faceValue = Number(amount) || 0;
  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  if (dbUrl && dbSecret) {
    try {
      const r = await fetch(`${dbUrl}/giftcards/${encodeURIComponent(code)}.json?auth=${dbSecret}`);
      if (r.ok) {
        const gc = await r.json();
        const dbAmount = Number(gc?.amount) || 0;
        if (dbAmount > 0) faceValue = dbAmount;
      }
    } catch (e) { /* mantém o fallback do cliente */ }
  }
  if (!faceValue || faceValue <= 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'valor do gift card indisponível' }) };
  }
  // Embed card fee so the business receives the full gift card face value
  const feeRate = parseFloat(process.env.INFINITEPAY_FEE_RATE || '0.0315');
  const priceWithFee = Math.ceil(faceValue / (1 - feeRate));
  const amountInCents = priceWithFee * 100;

  const siteUrl = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');
  const redirectUrl = `${siteUrl}/?gift=ok&codigo=${code}`;
  const webhookUrl  = `${siteUrl}/.netlify/functions/infinitepay-webhook`;

  const payload = {
    handle,
    order_nsu: code,
    redirect_url: redirectUrl,
    webhook_url:  webhookUrl,
    items: [{
      description: `Gift Card SP Car Clean – R$ ${faceValue}`,
      quantity: 1,
      price: amountInCents
    }],
    customer: {
      name:  buyerName  || '',
      email: buyerEmail || '',
      phone: (buyerPhone || '').replace(/\D/g, '')
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
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, paymentUrl, priceWithFee }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
