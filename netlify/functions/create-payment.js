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

  const { bookingId, finalPrice, customerName, customerEmail, customerPhone, service } = data;
  if (!bookingId || !finalPrice) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'bookingId e finalPrice são obrigatórios' }) };
  }

  // Embed card fee into price and round up so the business receives the full amount
  const feeRate = parseFloat(process.env.INFINITEPAY_FEE_RATE || '0.0315');
  const priceWithFee = Math.ceil(finalPrice / (1 - feeRate));
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
      return { statusCode: resp.status, body: JSON.stringify({ ok: false, error: result }) };
    }
    const paymentUrl = result.link || result.url || result.payment_url || result.checkout_url || '';
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, paymentUrl, priceWithFee })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
