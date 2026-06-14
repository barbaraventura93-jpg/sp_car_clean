exports.handler = async (event) => {
  // Always return 200 so InfinitePay stops retrying regardless of outcome
  const ok = (msg) => ({ statusCode: 200, body: JSON.stringify({ ok: true, msg }) });

  if (event.httpMethod !== 'POST') return ok('ignored');

  let data;
  try { data = JSON.parse(event.body); }
  catch { return ok('invalid json'); }

  const { order_nsu, transaction_nsu, capture_method, paid_amount, status } = data;
  if (!order_nsu) return ok('no order_nsu');

  // Only act when payment is actually captured/approved
  const paidStatuses = ['paid', 'approved', 'captured', 'succeeded', 'complete', 'completed'];
  if (status && !paidStatuses.includes(String(status).toLowerCase())) {
    return ok(`status ${status} ignored`);
  }

  const dbUrl = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  if (!dbUrl || !dbSecret) {
    console.error('infinitepay-webhook: FIREBASE_DATABASE_URL ou FIREBASE_DATABASE_SECRET não configurado');
    return ok('db not configured');
  }

  // ── Gift Card activation ────────────────────────────────────────────────
  if (String(order_nsu).startsWith('GIFT-')) {
    try {
      const gcResp = await fetch(
        `${dbUrl}/giftcards/${encodeURIComponent(order_nsu)}.json?auth=${dbSecret}`
      );
      const gc = await gcResp.json();
      if (!gc) return ok('gift card not found');
      if (gc.status === 'active') return ok('gift card already active');

      await fetch(
        `${dbUrl}/giftcards/${encodeURIComponent(order_nsu)}.json?auth=${dbSecret}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'active',
            balance: gc.amount,
            activatedAt: new Date().toISOString(),
            paymentTransactionId: transaction_nsu || '',
            paymentMethod: capture_method || '',
            paidAmount: paid_amount || gc.amount
          })
        }
      );

      // Send e-mail to buyer via EmailJS REST
      const sjsService  = process.env.EMAILJS_SERVICE_ID;
      const sjsPublic   = process.env.EMAILJS_PUBLIC_KEY;
      const sjsPrivate  = process.env.EMAILJS_PRIVATE_KEY;
      const sjsTemplate = process.env.EMAILJS_GIFT_TEMPLATE || process.env.EMAILJS_SERVICE_ID && 'template_update';
      const siteUrl     = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

      if (sjsService && sjsPublic && sjsTemplate && gc.buyerEmail) {
        const recipientLine = gc.recipientName ? `\n\nDestinatário: ${gc.recipientName}` : '';
        const messageLine   = gc.message ? `\nMensagem: "${gc.message}"` : '';
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id:  sjsService,
            template_id: sjsTemplate,
            user_id:     sjsPublic,
            ...(sjsPrivate ? { accessToken: sjsPrivate } : {}),
            template_params: {
              to_name:      gc.buyerName || 'Cliente',
              to_email:     gc.buyerEmail,
              booking_id:   order_nsu,
              service:      `🎁 Gift Card SP Car Clean – R$ ${gc.amount}`,
              status_label: 'Ativo e pronto para usar',
              price:        `R$ ${gc.amount}`,
              msg: `Seu gift card foi ativado com sucesso!${recipientLine}${messageLine}\n\nCódigo: ${order_nsu}\nSaldo: R$ ${gc.amount}\n\nPara usar: acesse ${siteUrl} e insira o código no campo "Gift Card" ao finalizar o agendamento.`
            }
          })
        }).catch(e => console.error('gift card email error:', e.message));
      }

      return ok('gift card activated');
    } catch (err) {
      console.error('infinitepay-webhook gift card error:', err.message);
      return ok('gift card error handled');
    }
  }

  // ── Regular booking confirmation ────────────────────────────────────────
  try {
    const readResp = await fetch(
      `${dbUrl}/bookings/${encodeURIComponent(order_nsu)}.json?auth=${dbSecret}`
    );
    const booking = await readResp.json();
    if (!booking) return ok('booking not found');
    if (booking.status === 'confirmed') return ok('already confirmed');

    await fetch(
      `${dbUrl}/bookings/${encodeURIComponent(order_nsu)}.json?auth=${dbSecret}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'confirmed',
          paymentConfirmedAt: new Date().toISOString(),
          paymentTransactionId: transaction_nsu || '',
          paymentMethod: capture_method || '',
          paidAmount: paid_amount || 0
        })
      }
    );
    return ok('confirmed');
  } catch (err) {
    console.error('infinitepay-webhook error:', err.message);
    return ok('error handled');
  }
};
