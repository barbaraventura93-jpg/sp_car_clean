'use strict';

// Webhook do InfinitePay — confirma agendamento / ativa gift card.
//
// SEGURANÇA: o corpo do webhook, por si só, NÃO é confiável — qualquer um que
// conheça um código de reserva poderia forjar um POST com `status:paid`. Antes de
// alterar qualquer coisa no Firebase, consultamos o endpoint oficial
// `payment_check` do InfinitePay (autenticado pelo nosso `handle`) para confirmar
// que a transação realmente existe e foi paga, e conferimos o valor pago contra o
// valor esperado do pedido. Falha em verificar → devolvemos erro para o InfinitePay
// reenviar, em vez de confirmar às cegas (fail-closed).

const PAYMENT_CHECK_URL = 'https://api.checkout.infinitepay.io/payment_check';
const PAID_STATUSES     = ['paid', 'approved', 'captured', 'succeeded', 'complete', 'completed'];
const CHECK_TIMEOUT_MS  = 8000;

exports.handler = async (event) => {
  // 200        → InfinitePay considera entregue e para de reenviar.
  // 4xx/5xx    → InfinitePay reenvia mais tarde (usamos isso quando não conseguimos verificar agora).
  const ok    = (msg) => ({ statusCode: 200, body: JSON.stringify({ ok: true,  msg }) });
  const retry = (msg) => ({ statusCode: 503, body: JSON.stringify({ ok: false, retry: true, msg }) });

  if (event.httpMethod !== 'POST') return ok('ignored');

  let data;
  try { data = JSON.parse(event.body); }
  catch { return ok('invalid json'); }

  const { order_nsu, transaction_nsu, slug, capture_method, paid_amount, status } = data;
  if (!order_nsu) return ok('no order_nsu');

  // Status explicitamente não-pago → nada a fazer (e sem reenvio).
  if (status && !PAID_STATUSES.includes(String(status).toLowerCase())) {
    return ok(`status ${status} ignored`);
  }

  const handle   = process.env.INFINITEPAY_HANDLE;
  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;

  // Sem o handle não há como verificar a autenticidade → fail-closed (peça reenvio).
  if (!handle) {
    console.error('infinitepay-webhook: INFINITEPAY_HANDLE não configurado — pagamento não verificado');
    return retry('handle not configured');
  }
  if (!dbUrl || !dbSecret) {
    console.error('infinitepay-webhook: FIREBASE_DATABASE_URL ou FIREBASE_DATABASE_SECRET não configurado');
    return retry('db not configured');
  }

  // ── Verificação server-side contra a API oficial do InfinitePay ──────────
  const check = await verifyPayment({ handle, order_nsu, transaction_nsu, slug });
  if (check.transient) {
    // Não conseguimos falar com o InfinitePay agora → não confirme; peça reenvio.
    console.error(`infinitepay-webhook: verificação indisponível para ${order_nsu}:`, check.error);
    return retry('verification unavailable');
  }
  if (!check.paid) {
    console.warn(`infinitepay-webhook: pagamento não confirmado para ${order_nsu} (${check.error || 'paid=false'})`);
    return ok('not paid');
  }

  const feeRate           = parseFloat(process.env.INFINITEPAY_FEE_RATE || '0.0315');
  const verifiedPaidCents = Number(check.paid_amount ?? check.amount ?? paid_amount ?? 0);
  const verifiedCapture   = check.capture_method || capture_method || '';

  // ── Ativação de Gift Card ────────────────────────────────────────────────
  if (String(order_nsu).startsWith('GIFT-')) {
    try {
      const gc = await dbReq('GET', dbUrl, dbSecret, `/giftcards/${encodeURIComponent(order_nsu)}`);
      if (!gc) return ok('gift card not found');
      if (gc.status === 'active') return ok('gift card already active');

      const expectedCents = expectedCentsFor(gc.amount, feeRate);
      if (amountIsShort(verifiedPaidCents, expectedCents)) {
        console.error(`infinitepay-webhook: valor pago ${verifiedPaidCents}c < esperado ${expectedCents}c para ${order_nsu}`);
        return ok('amount mismatch');
      }

      await dbReq('PATCH', dbUrl, dbSecret, `/giftcards/${encodeURIComponent(order_nsu)}`, {
        status: 'active',
        balance: gc.amount,
        activatedAt: new Date().toISOString(),
        paymentTransactionId: transaction_nsu || '',
        paymentMethod: verifiedCapture,
        paidAmount: verifiedPaidCents ? verifiedPaidCents / 100 : gc.amount
      });

      await sendGiftEmail(gc, order_nsu);
      return ok('gift card activated');
    } catch (err) {
      console.error('infinitepay-webhook gift card error:', err.message);
      return retry('gift card error');
    }
  }

  // ── Confirmação de agendamento ───────────────────────────────────────────
  try {
    const booking = await dbReq('GET', dbUrl, dbSecret, `/bookings/${encodeURIComponent(order_nsu)}`);
    if (!booking) return ok('booking not found');
    if (booking.status === 'confirmed') return ok('already confirmed');

    // Valor esperado: preferimos o priceWithFee gravado ao gerar o link.
    const expectedReais = booking.priceWithFee || booking.finalPrice || booking.price || 0;
    const expectedCents = expectedCentsFor(expectedReais, feeRate,
      /* alreadyWithFee */ booking.priceWithFee != null);
    if (amountIsShort(verifiedPaidCents, expectedCents)) {
      console.error(`infinitepay-webhook: valor pago ${verifiedPaidCents}c < esperado ${expectedCents}c para ${order_nsu}`);
      return ok('amount mismatch');
    }

    await dbReq('PATCH', dbUrl, dbSecret, `/bookings/${encodeURIComponent(order_nsu)}`, {
      status: 'confirmed',
      paymentConfirmedAt: new Date().toISOString(),
      paymentTransactionId: transaction_nsu || '',
      paymentMethod: verifiedCapture,
      paidAmount: verifiedPaidCents ? verifiedPaidCents / 100 : 0
    });
    return ok('confirmed');
  } catch (err) {
    console.error('infinitepay-webhook error:', err.message);
    return retry('confirmation error');
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────

// Consulta o endpoint oficial payment_check. Retorna:
//   { paid: bool, amount, paid_amount, capture_method }  — verificação concluída
//   { transient: true, error }                           — falha temporária (reenviar)
async function verifyPayment({ handle, order_nsu, transaction_nsu, slug }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const resp = await fetch(PAYMENT_CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle,
        order_nsu,
        ...(transaction_nsu ? { transaction_nsu } : {}),
        ...(slug ? { slug } : {})
      }),
      signal: controller.signal
    });
    // 5xx / 429 são temporários; peça reenvio.
    if (resp.status >= 500 || resp.status === 429) {
      return { transient: true, error: `payment_check HTTP ${resp.status}` };
    }
    let body;
    try { body = await resp.json(); }
    catch { return { transient: true, error: 'payment_check resposta inválida' }; }

    if (!resp.ok || body.success === false) {
      // Resposta definitiva de que não há pagamento válido para este pedido.
      return { paid: false, error: `payment_check success=false (HTTP ${resp.status})` };
    }
    return {
      paid: body.paid === true,
      amount: body.amount,
      paid_amount: body.paid_amount,
      capture_method: body.capture_method
    };
  } catch (err) {
    // Timeout / rede → temporário.
    return { transient: true, error: err.name === 'AbortError' ? 'payment_check timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Valor esperado em centavos. `alreadyWithFee` indica que o valor já embute a taxa
// (caso do booking.priceWithFee); senão embutimos a taxa como o create-payment faz.
function expectedCentsFor(reais, feeRate, alreadyWithFee = false) {
  const v = Number(reais);
  if (!v || v <= 0) return 0;
  const withFee = alreadyWithFee ? v : Math.ceil(v / (1 - feeRate));
  return Math.round(withFee * 100);
}

// Só reprova quando temos ambos os valores e o pago ficou abaixo do esperado
// (tolerância de 1 centavo por arredondamento). Se não sabemos o esperado ou o
// pago, não bloqueia — a autenticidade já foi garantida pelo payment_check.
function amountIsShort(paidCents, expectedCents) {
  if (!paidCents || !expectedCents) return false;
  return paidCents < expectedCents - 1;
}

async function dbReq(method, dbUrl, dbSecret, path, body) {
  const resp = await fetch(`${dbUrl}${path}.json?auth=${dbSecret}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  if (!resp.ok) throw new Error(`Firebase ${method} ${path} → HTTP ${resp.status}`);
  return resp.json();
}

async function sendGiftEmail(gc, order_nsu) {
  const sjsService  = process.env.EMAILJS_SERVICE_ID;
  const sjsPublic   = process.env.EMAILJS_PUBLIC_KEY;
  const sjsPrivate  = process.env.EMAILJS_PRIVATE_KEY;
  const sjsTemplate = process.env.EMAILJS_GIFT_TEMPLATE || (sjsService && 'template_update');
  const siteUrl     = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

  if (!(sjsService && sjsPublic && sjsTemplate && gc.buyerEmail)) return;

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
