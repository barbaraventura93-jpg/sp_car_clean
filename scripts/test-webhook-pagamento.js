'use strict';

// Webhook do InfinitePay — o que confirma agendamento e ativa gift card.
//
// Por que existe: é a função que transforma "alguém mandou um POST" em
// "dinheiro entrou". Não tinha teste nenhum, e a revisão de 09/11/2026 achou
// dois defeitos nela (S-01 e S-03): o webhook pode ser REPETIDO por qualquer
// pessoa — o pagamento original continua existindo no InfinitePay, então a
// verificação passa de novo — e a função só se protegia do estado "já ativo" /
// "já confirmado". Um gift card esgotado voltava a ter saldo cheio, e um
// agendamento cancelado ou concluído voltava a "confirmado".
//
// Sem rede: o `fetch` é um dublê que simula o banco e o payment_check. Nenhum
// dado real; os códigos abaixo são inventados.

const assert = require('assert');
const path = require('path');

process.env.INFINITEPAY_HANDLE = 'loja-de-teste';
process.env.FIREBASE_DATABASE_URL = 'https://banco.invalid';
process.env.FIREBASE_DATABASE_SECRET = 'segredo-de-teste';
delete process.env.EMAILJS_SERVICE_ID; // nenhum e-mail sai do teste
delete process.env.PUSH_TABLE;

const BANCO = 'https://banco.invalid/';
let db, check, escritas, chamadasCheck, bancoFora;

function preparar({ banco = {}, pagamento = { success: true, paid: true, amount: 10400, paid_amount: 10400, capture_method: 'pix' } } = {}) {
  db = JSON.parse(JSON.stringify(banco));
  check = pagamento;
  escritas = [];
  chamadasCheck = [];
  bancoFora = false;
}

global.fetch = async (url, opt = {}) => {
  if (url.includes('payment_check')) {
    chamadasCheck.push(JSON.parse(opt.body));
    if (check === 'timeout') { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }
    if (typeof check === 'number') return { ok: false, status: check, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => check };
  }
  if (url.startsWith(BANCO)) {
    if (bancoFora) return { ok: false, status: 500, json: async () => ({}) };
    assert.ok(url.includes('.json?auth='), 'toda chamada ao banco leva a credencial');
    const chave = decodeURIComponent(url.slice(BANCO.length).split('.json')[0]);
    if (opt.method === 'PATCH') {
      const corpo = JSON.parse(opt.body);
      escritas.push({ chave, corpo });
      db[chave] = { ...db[chave], ...corpo };
      return { ok: true, status: 200, json: async () => db[chave] };
    }
    return { ok: true, status: 200, json: async () => (chave in db ? db[chave] : null) };
  }
  throw new Error('o teste não pode sair para a rede: ' + url);
};

const { handler, _interno } = require(path.resolve(__dirname, '../functions/infinitepay-webhook.js'));

async function chamar(corpo, metodo = 'POST') {
  const r = await handler({ httpMethod: metodo, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
  return { status: r.statusCode, ...JSON.parse(r.body) };
}

const GIFT = 'GIFT-TESTE00001';
const BOOK = 'SPC-TESTE00001';
const cartao = (extra) => ({ [`giftcards/${GIFT}`]: { code: GIFT, amount: 100, balance: 0, status: 'pending', ...extra } });
const agendamento = (extra) => ({ [`bookings/${BOOK}`]: { id: BOOK, status: 'approved', price: 100, priceWithFee: 104, ...extra } });

(async () => {
  // ── Entrada inválida: responde 200 (para o InfinitePay não reenviar) e não toca em nada
  preparar();
  assert.strictEqual((await chamar({}, 'GET')).msg, 'ignored', 'método que não é POST é ignorado');
  assert.strictEqual((await chamar('{isto não é json')).msg, 'invalid json');
  assert.strictEqual((await chamar({ status: 'paid' })).msg, 'no order_nsu');
  assert.strictEqual((await chamar({ order_nsu: BOOK, status: 'refused' })).msg, 'status refused ignored');
  assert.strictEqual(chamadasCheck.length, 0, 'entrada inválida não consulta o InfinitePay');
  assert.strictEqual(escritas.length, 0, 'entrada inválida não escreve no banco');

  // ── Não confia no corpo: sempre confere no payment_check, com o handle da loja
  preparar({ banco: agendamento() });
  await chamar({ order_nsu: BOOK, status: 'paid', transaction_nsu: 'T1', slug: 'S1' });
  assert.deepStrictEqual(chamadasCheck[0], { handle: 'loja-de-teste', order_nsu: BOOK, transaction_nsu: 'T1', slug: 'S1' });

  // ── Sem conseguir verificar: 503 (pede reenvio), nunca confirma às cegas
  for (const falha of [500, 429, 'timeout']) {
    preparar({ banco: agendamento(), pagamento: falha });
    const r = await chamar({ order_nsu: BOOK, status: 'paid' });
    assert.strictEqual(r.status, 503, `payment_check ${falha}: pede reenvio`);
    assert.strictEqual(escritas.length, 0, `payment_check ${falha}: não confirma`);
  }
  preparar({ banco: agendamento() });
  const semHandle = process.env.INFINITEPAY_HANDLE;
  delete process.env.INFINITEPAY_HANDLE;
  assert.strictEqual((await chamar({ order_nsu: BOOK })).status, 503, 'sem o handle não há como verificar');
  process.env.INFINITEPAY_HANDLE = semHandle;
  assert.strictEqual(escritas.length, 0);

  // ── O InfinitePay diz que não foi pago: nada muda, mesmo com "paid" no corpo
  for (const pagamento of [{ success: true, paid: false }, { success: false }, 404]) {
    preparar({ banco: { ...agendamento(), ...cartao() }, pagamento });
    assert.strictEqual((await chamar({ order_nsu: BOOK, status: 'paid', paid_amount: 999999 })).msg, 'not paid');
    assert.strictEqual((await chamar({ order_nsu: GIFT, status: 'paid', paid_amount: 999999 })).msg, 'not paid');
    assert.strictEqual(escritas.length, 0, 'pagamento não confirmado não escreve');
  }

  // ── Gift card: o caminho legítimo
  preparar({ banco: cartao() });
  let r = await chamar({ order_nsu: GIFT, status: 'paid', transaction_nsu: 'T9' });
  assert.strictEqual(r.msg, 'gift card activated');
  assert.strictEqual(db[`giftcards/${GIFT}`].status, 'active');
  assert.strictEqual(db[`giftcards/${GIFT}`].balance, 100, 'o saldo é o valor de face gravado no banco');
  assert.strictEqual(db[`giftcards/${GIFT}`].paidAmount, 104);
  assert.strictEqual(db[`giftcards/${GIFT}`].paymentTransactionId, 'T9');

  // ── Gift card: webhook repetido não faz nada (idempotência)
  r = await chamar({ order_nsu: GIFT, status: 'paid' });
  assert.strictEqual(r.msg, 'gift card already active');
  assert.strictEqual(escritas.length, 1, 'a segunda entrega não escreve de novo');

  // ── REGRESSÃO S-01: cartão já usado NÃO volta a ter saldo
  // Antes da correção isto devolvia "gift card activated" com saldo 100.
  for (const usado of [{ status: 'depleted', balance: 0 }, { status: 'active', balance: 30 }, { status: 'cancelled', balance: 0 }, { status: 'qualquer-outro', balance: 0 }]) {
    preparar({ banco: cartao({ ...usado, activatedAt: '2026-01-01T00:00:00.000Z' }) });
    r = await chamar({ order_nsu: GIFT, status: 'paid' });
    assert.strictEqual(r.status, 200, 'responde 200 para o InfinitePay não insistir');
    assert.notStrictEqual(r.msg, 'gift card activated', `cartão ${usado.status} não pode ser reativado`);
    assert.strictEqual(escritas.length, 0, `cartão ${usado.status}: nenhuma escrita`);
    assert.strictEqual(db[`giftcards/${GIFT}`].balance, usado.balance, `cartão ${usado.status}: saldo intacto`);
  }

  // ── Gift card: pagou menos que o valor de face com a taxa → não ativa
  preparar({ banco: cartao({ amount: 500 }), pagamento: { success: true, paid: true, amount: 200, paid_amount: 200 } });
  assert.strictEqual((await chamar({ order_nsu: GIFT, status: 'paid' })).msg, 'amount mismatch');
  assert.strictEqual(escritas.length, 0);
  // O valor do corpo não substitui o que o InfinitePay informou.
  assert.strictEqual((await chamar({ order_nsu: GIFT, status: 'paid', paid_amount: 99999999 })).msg, 'amount mismatch');
  assert.strictEqual(escritas.length, 0, 'paid_amount do corpo não vence o do payment_check');

  preparar({ banco: {} });
  assert.strictEqual((await chamar({ order_nsu: GIFT, status: 'paid' })).msg, 'gift card not found');

  // ── Agendamento: o caminho legítimo
  preparar({ banco: agendamento() });
  r = await chamar({ order_nsu: BOOK, status: 'paid', transaction_nsu: 'T2' });
  assert.strictEqual(r.msg, 'confirmed');
  assert.strictEqual(db[`bookings/${BOOK}`].status, 'confirmed');
  assert.strictEqual(db[`bookings/${BOOK}`].paidAmount, 104);
  assert.strictEqual(db[`bookings/${BOOK}`].paymentMethod, 'pix');
  r = await chamar({ order_nsu: BOOK, status: 'paid' });
  assert.strictEqual(r.msg, 'already confirmed');
  assert.strictEqual(escritas.length, 1, 'repetição não escreve de novo');

  // Pedido ainda em análise que recebe pagamento: confirma (comportamento
  // que já existia e foi mantido).
  preparar({ banco: agendamento({ status: 'pending' }) });
  assert.strictEqual((await chamar({ order_nsu: BOOK, status: 'paid' })).msg, 'confirmed');

  // ── REGRESSÃO S-03: agendamento encerrado NÃO volta a "confirmado"
  // Antes da correção, cancelado/recusado/concluído viravam "confirmed".
  for (const encerrado of ['cancelled', 'rejected', 'completed', 'estado-desconhecido']) {
    preparar({ banco: agendamento({ status: encerrado }) });
    r = await chamar({ order_nsu: BOOK, status: 'paid' });
    assert.strictEqual(r.status, 200);
    assert.notStrictEqual(r.msg, 'confirmed', `agendamento ${encerrado} não pode ser reconfirmado`);
    assert.strictEqual(escritas.length, 0, `agendamento ${encerrado}: nenhuma escrita`);
    assert.strictEqual(db[`bookings/${BOOK}`].status, encerrado);
  }

  // ── Agendamento: pagou menos que o combinado → não confirma
  preparar({ banco: agendamento(), pagamento: { success: true, paid: true, amount: 100, paid_amount: 100 } });
  assert.strictEqual((await chamar({ order_nsu: BOOK, status: 'paid' })).msg, 'amount mismatch');
  assert.strictEqual(escritas.length, 0);

  preparar({ banco: {} });
  assert.strictEqual((await chamar({ order_nsu: BOOK, status: 'paid' })).msg, 'booking not found');

  // ── Código estranho não escapa do nó (vira um segmento só, codificado)
  preparar({ banco: {} });
  await chamar({ order_nsu: 'X/../../config', status: 'paid' });
  await chamar({ order_nsu: 'GIFT-X/../../config?auth=', status: 'paid' });
  assert.strictEqual(escritas.length, 0);

  // ── Banco fora do ar: 503 para o InfinitePay reenviar depois
  preparar({ banco: agendamento() });
  bancoFora = true;
  assert.strictEqual((await chamar({ order_nsu: BOOK, status: 'paid' })).status, 503);
  assert.strictEqual((await chamar({ order_nsu: GIFT, status: 'paid' })).status, 503);

  // ── A conta do valor esperado (função pura)
  const { expectedCentsFor, amountIsShort } = _interno;
  assert.strictEqual(expectedCentsFor(100, 0.0315), 10400, 'R$ 100 com taxa de 3,15% arredonda para cima: R$ 104');
  assert.strictEqual(expectedCentsFor(104, 0.0315, true), 10400, 'valor que já tem a taxa não ganha taxa de novo');
  assert.strictEqual(expectedCentsFor(0, 0.0315), 0);
  assert.strictEqual(expectedCentsFor(-5, 0.0315), 0, 'valor negativo não vira esperado');
  assert.strictEqual(expectedCentsFor('abc', 0.0315), 0);
  assert.strictEqual(amountIsShort(10399, 10400), false, 'um centavo de tolerância de arredondamento');
  assert.strictEqual(amountIsShort(10398, 10400), true);
  assert.strictEqual(amountIsShort(10400, 10400), false);

  console.log('webhook de pagamento: verificação, repetição, valor e estados — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
