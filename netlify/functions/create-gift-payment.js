exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'INFINITEPAY_HANDLE não configurado' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { code, amount, buyerName, buyerEmail, buyerPhone } = data;
  if (!code || !amount || amount <= 0) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'code e amount são obrigatórios' }) };
  }

  // Embed card fee so the business receives the full gift card face value
  const feeRate = parseFloat(process.env.INFINITEPAY_FEE_RATE || '0.0315');
  const priceWithFee = Math.ceil(amount / (1 - feeRate));
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
      description: `Gift Card SP Car Clean – R$ ${amount}`,
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
      return { statusCode: resp.status, body: JSON.stringify({ ok: false, error: result }) };
    }
    const paymentUrl = result.link || result.url || result.payment_url || result.checkout_url || '';
    return { statusCode: 200, body: JSON.stringify({ ok: true, paymentUrl, priceWithFee }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
