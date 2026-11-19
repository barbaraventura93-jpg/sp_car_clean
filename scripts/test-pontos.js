'use strict';

// Pontos de fidelidade caem com o PAGAMENTO CONFIRMADO (regra da Bárbara,
// 18/11/2026).
//
// Rodar: node scripts/test-pontos.js
//
// Confirmação de pagamento é uma de duas:
//   - pelo site: o webhook da InfinitePay verifica e confirma;
//   - direto para a empresa (dinheiro/Pix): a admin registra no painel
//     (op `confirmar-recebimento` do /api/admin-data).
// O "confirmar pagamento" do CLIENTE (/api/me) não credita mais: é a palavra
// dele, sem pagamento verificado.
//
// Sem rede: banco em memória, guarda e Cognito são dublês.

const assert = require('assert');
const path = require('path');

const R = (p) => path.resolve(__dirname, '..', p);

// ── dublês, antes de qualquer require de função ───────────────────────
const guard = require(R('functions/lib/guard.js'));
guard.originAllowed = () => true;
guard.rateLimit = () => true;
guard.clientIp = () => '10.0.0.1';
guard.corsHeaders = () => ({});

const auth = require(R('functions/lib/admin-auth.js'));
auth.verifyAdmin = async (t) => t === 'token-admin';
auth.identificar = async (t) => (t === 'token-admin'
  ? { uid: 'adm', email: 'dona@exemplo.invalid', origem: 'cognito' }
  : { uid: 'u1', email: 'bia@exemplo.invalid', origem: 'cognito' });
auth.bearerToken = (ev) => {
  const h = (ev.headers || {}).authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

// Banco em memória com as condições da transação aplicadas como no DynamoDB.
let db = {};
let transacoes = 0;
const semBarra = (c) => String(c).replace(/^\/+/, '');
const copia = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const store = require(R('functions/lib/core/store.js'));
store.dbGet = async (c) => copia(db[semBarra(c)]);
store.dbPatch = async (c, v) => { const k = semBarra(c); db[k] = { ...(db[k] || {}), ...v }; };
store.dbSet = async (c, v) => { db[semBarra(c)] = v; };
store.dbTransacao = async (lista) => {
  transacoes++;
  lista.forEach((e, indice) => {
    const atual = db[e.caminho];
    const falha = () => { throw Object.assign(new Error('condição'), { condicaoFalhou: true, indice }); };
    if (e.tipo === 'atualizar') {
      if (!atual) falha();
      for (const [k, v] of Object.entries(e.seIgual || {})) if (atual[k] !== v) falha();
      for (const [k, v] of Object.entries(e.seAusenteOuIgual || {})) {
        if (atual[k] !== undefined && atual[k] !== v) falha();
      }
    }
  });
  for (const e of lista) db[e.caminho] = { ...db[e.caminho], ...e.campos };
};

const pontos = require(R('functions/lib/core/pontos.js'));
const adminData = require(R('functions/admin-data.js'));

function preparar(extraBooking = {}, extraPerfil = {}) {
  transacoes = 0;
  db = {
    config: { pointsPerReal: 1 },
    'bookings/SPC-1': { id: 'SPC-1', status: 'approved', clientUid: 'u1', email: 'bia@exemplo.invalid',
      price: 300, finalPrice: 380, ...extraBooking },
    'clientProfiles/u1': { email: 'bia@exemplo.invalid', points: 20, pointsHistory: [], ...extraPerfil },
  };
}

async function admin(op, caminho, dados, token = 'token-admin') {
  const r = await adminData.handler({
    httpMethod: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ op, caminho, dados }),
  });
  return { status: r.statusCode, ...JSON.parse(r.body) };
}

(async () => {
  // ── 1. o módulo ─────────────────────────────────────────────────────
  assert.strictEqual(pontos.pontosDoValor(380, 1), 380);
  assert.strictEqual(pontos.pontosDoValor(99.9, 1), 99, 'arredonda para baixo');
  assert.strictEqual(pontos.pontosDoValor(100, 2), 200);
  assert.strictEqual(pontos.pontosDoValor(100, 0), 100, 'regra ausente ou zero vale 1 ponto por real');
  assert.strictEqual(pontos.pontosDoValor(-5, 1), 0);

  // Sem pagamento confirmado, nada.
  preparar();
  let r = await pontos.creditarPorPagamento('SPC-1', { store });
  assert.deepStrictEqual(r, { creditado: 0, motivo: 'pagamento não confirmado' });
  assert.strictEqual(db['clientProfiles/u1'].points, 20);

  // Pagamento confirmado: credita sobre o valor do SERVIÇO (finalPrice da
  // aprovação), não sobre o pago com taxa.
  preparar({ paymentConfirmedAt: '2026-11-18T10:00:00Z', paidAmount: 395.2 });
  r = await pontos.creditarPorPagamento('SPC-1', { store });
  assert.strictEqual(r.creditado, 380);
  assert.strictEqual(db['clientProfiles/u1'].points, 400);
  assert.strictEqual(db['clientProfiles/u1'].pointsHistory.at(-1).bookingId, 'SPC-1');
  assert.ok(db['bookings/SPC-1'].pointsAwardedAt, 'marca o crédito no agendamento');
  assert.strictEqual(db['bookings/SPC-1'].pointsAwarded, 380);

  // Uma vez só: segunda confirmação (webhook reenviado, ou admin depois do site).
  r = await pontos.creditarPorPagamento('SPC-1', { store });
  assert.deepStrictEqual(r, { creditado: 0, motivo: 'já creditado' });
  assert.strictEqual(db['clientProfiles/u1'].points, 400);

  // Duas confirmações AO MESMO TEMPO: a transação deixa passar só uma.
  preparar({ paymentConfirmedAt: '2026-11-18T10:00:00Z' });
  const [a, b] = await Promise.all([
    pontos.creditarPorPagamento('SPC-1', { store }),
    pontos.creditarPorPagamento('SPC-1', { store }),
  ]);
  assert.strictEqual(a.creditado + b.creditado, 380, 'credita uma vez só');
  assert.strictEqual(db['clientProfiles/u1'].points, 400);

  // Perfil sem `points` ainda (cliente novo): começa do zero.
  preparar({ paymentConfirmedAt: 'x' }, { points: undefined });
  delete db['clientProfiles/u1'].points;
  r = await pontos.creditarPorPagamento('SPC-1', { store });
  assert.strictEqual(db['clientProfiles/u1'].points, 380);

  // Agendamento sem conta, ou cliente sem perfil: não credita, não quebra.
  preparar({ paymentConfirmedAt: 'x', clientUid: undefined });
  delete db['bookings/SPC-1'].clientUid;
  assert.strictEqual((await pontos.creditarPorPagamento('SPC-1', { store })).creditado, 0);
  preparar({ paymentConfirmedAt: 'x' });
  delete db['clientProfiles/u1'];
  assert.strictEqual((await pontos.creditarPorPagamento('SPC-1', { store })).creditado, 0);

  // ── 2. a admin registra o recebimento direto ────────────────────────
  preparar();
  r = await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'pix' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.dados.pontos.creditado, 380, 'pagamento direto confirmado libera os pontos');
  assert.strictEqual(db['bookings/SPC-1'].paymentMethod, 'pix');
  assert.strictEqual(db['bookings/SPC-1'].status, 'confirmed');
  assert.strictEqual(db['bookings/SPC-1'].paymentConfirmedBy, 'dona@exemplo.invalid', 'fica registrado quem confirmou');
  assert.ok(db['bookings/SPC-1'].paymentConfirmedAt);
  assert.strictEqual(db['clientProfiles/u1'].points, 400);

  // Duas vezes: recusa, e não credita de novo.
  r = await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'dinheiro' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(db['clientProfiles/u1'].points, 400);

  // Concluído continua concluído; recebe o pagamento e os pontos.
  preparar({ status: 'completed' });
  r = await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'dinheiro', valor: 380 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db['bookings/SPC-1'].status, 'completed');
  assert.strictEqual(db['bookings/SPC-1'].receivedAmount, 380);

  // Cancelado não recebe pagamento.
  preparar({ status: 'cancelled' });
  assert.strictEqual((await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'pix' })).status, 409);

  // Entradas inválidas.
  preparar();
  assert.strictEqual((await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'cheque-sem-fundo' })).status, 400);
  assert.strictEqual((await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'pix', valor: -1 })).status, 400);
  assert.strictEqual((await admin('confirmar-recebimento', 'clientProfiles/u1', { metodo: 'pix' })).status, 400,
    'só vale para agendamento');
  assert.strictEqual((await admin('confirmar-recebimento', 'bookings/NAOEXISTE', { metodo: 'pix' })).status, 404);

  // ATAQUE: cliente ou visitante "confirmando" o próprio recebimento.
  for (const token of [null, 'token-cliente']) {
    preparar();
    r = await admin('confirmar-recebimento', 'bookings/SPC-1', { metodo: 'pix' }, token);
    assert.strictEqual(r.status, 403, `${token || 'visitante'} não confirma recebimento`);
    assert.ok(!db['bookings/SPC-1'].paymentConfirmedAt);
    assert.strictEqual(db['clientProfiles/u1'].points, 20);
  }

  // ── 3. o "confirmar pagamento" do cliente não credita mais ──────────
  const me = require(R('functions/me.js'));
  // O /api/me fala pelo store-http (verbo HTTP sobre o mesmo store).
  preparar();
  db['bookings/SPC-1'].status = 'approved';
  const resp = await me.handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token-cliente' },
    body: JSON.stringify({ op: 'confirmar-pagamento', dados: { id: 'SPC-1' } }),
  });
  const corpo = JSON.parse(resp.body);
  assert.strictEqual(resp.statusCode, 200, JSON.stringify(corpo));
  assert.strictEqual(corpo.dados.pontos.creditado, 0, 'a palavra do cliente não vira ponto');
  assert.strictEqual(db['clientProfiles/u1'].points, 20, 'saldo intacto');
  assert.ok(!db['bookings/SPC-1'].pointsAwardedAt);
  assert.ok(!db['bookings/SPC-1'].paymentConfirmedAt, 'e não conta como pagamento confirmado');

  console.log('pontos: só com pagamento confirmado (site ou admin), uma vez por agendamento — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
