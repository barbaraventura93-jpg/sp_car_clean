exports.handler = async (event) => {
  // Always return 200 so InfinitePay stops retrying regardless of outcome
  const ok = (msg) => ({ statusCode: 200, body: JSON.stringify({ ok: true, msg }) });

  if (event.httpMethod !== 'POST') return ok('ignored');

  let data;
  try { data = JSON.parse(event.body); }
  catch { return ok('invalid json'); }

  const { order_nsu, transaction_nsu, capture_method, paid_amount, status } = data;
  if (!order_nsu) return ok('no order_nsu');

  // Only mark confirmed when payment is actually captured/approved
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

  try {
    // Read current booking to check idempotency
    const readResp = await fetch(
      `${dbUrl}/bookings/${encodeURIComponent(order_nsu)}.json?auth=${dbSecret}`
    );
    const booking = await readResp.json();
    if (!booking) return ok('booking not found');
    if (booking.status === 'confirmed') return ok('already confirmed');

    // Update booking status to confirmed
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
