'use strict';

// Preço, cupom e gift card decididos no SERVIDOR (item 7 do backlog; achados
// S-05, S-07 e S-08 de docs/revisao-2026-11-09.md).
//
// Rodar: node scripts/test-precificacao.js
//
// POR QUE EXISTE: até 18/11/2026 o navegador calculava o preço final e o
// servidor gravava o número como veio. Editando a requisição, um polimento de
// R$ 1.300 saía por R$ 1; o cupom de uso único nunca era baixado (a regra
// negava a escrita ao visitante) e servia de novo; e o gift card era
// descontado pelo navegador, no valor que ele escolhesse. Os casos de ataque
// abaixo são exatamente esses.
//
// Três camadas, sem rede:
//   1. lib/core/precificacao.js — as regras, puras;
//   2. lib/core/agendamento-publico.js — com um banco em memória que aplica as
//      condições da transação como o DynamoDB aplicaria;
//   3. store.dbTransacao — o pedido que vai para o DynamoDB, com o transporte
//      trocado por um dublê.

const assert = require('assert');
const path = require('path');

const R = (p) => path.resolve(__dirname, '..', p);
const preco = require(R('functions/lib/core/precificacao.js'));
const { criarAgendamentoPublico } = require(R('functions/lib/core/agendamento-publico.js'));
const store = require(R('functions/lib/core/store.js'));

const AGORA = new Date('2026-11-18T12:00:00Z');

const CATALOGO = {
  lavagem: { name: 'Lavagem', pricing: { pq: { sale: 180, cost: 40 }, gr: { sale: 300 } } },
  cristal: { name: 'Cristalização', pq: 600, gr: 1300 },          // formato antigo, sem `pricing`
  vidros: { name: 'Vidros', pricing: { pq: { sale: 120 }, gr: { sale: 180 } } },
  antigo: { name: 'Fora de linha', pq: 99, gr: 99, active: false },
};

// ── 1. regras puras ───────────────────────────────────────────────────

// Soma pelo catálogo, nos dois formatos de preço que existem no banco.
assert.deepStrictEqual(preco.precoBase(['lavagem', 'cristal'], 'pq', CATALOGO), { base: 780 });
assert.deepStrictEqual(preco.precoBase(['lavagem', 'cristal'], 'gr', CATALOGO), { base: 1600 });

// O que a tela tolera (serviço removido vira R$ 0) o servidor recusa: seria
// vender de graça o que não existe.
assert.ok(preco.precoBase(['nao-existe'], 'pq', CATALOGO).erro, 'serviço fora do catálogo');
assert.ok(preco.precoBase(['antigo'], 'pq', CATALOGO).erro, 'serviço desativado');
assert.ok(preco.precoBase(['__proto__'], 'pq', CATALOGO).erro, 'chave herdada não é serviço');
assert.ok(preco.precoBase(['lavagem', 'lavagem'], 'pq', CATALOGO).erro, 'repetir serviço');
assert.ok(preco.precoBase([], 'pq', CATALOGO).erro, 'pedido vazio');
assert.ok(preco.precoBase(['lavagem'], 'xg', CATALOGO).erro, 'tamanho inventado');
assert.ok(preco.precoBase(['lavagem'], 'pq', null).erro, 'sem catálogo, sem preço');

// Cupom: as mesmas regras que a tela já mostrava.
const cupom = (extra = {}) => ({ discountType: 'percent', discountValue: 10, ...extra });
const ctx = { total: 780, email: 'bia@x.com', quem: null, agora: AGORA };
assert.deepStrictEqual(preco.validarCupom(cupom(), ctx), { desconto: 78 });
assert.deepStrictEqual(preco.validarCupom(cupom({ discountType: 'fixed', discountValue: 50 }), ctx), { desconto: 50 });
assert.ok(preco.validarCupom(null, ctx).erro, 'cupom inexistente');
assert.ok(preco.validarCupom(cupom({ used: true }), ctx).erro, 'cupom já usado');
assert.ok(preco.validarCupom(cupom({ validUntil: '2026-11-17' }), ctx).erro, 'cupom vencido');
assert.ok(!preco.validarCupom(cupom({ validUntil: '2026-12-31' }), ctx).erro, 'cupom no prazo');
assert.ok(preco.validarCupom(cupom({ minValue: 1000 }), ctx).erro, 'abaixo do pedido mínimo');
assert.ok(preco.validarCupom(cupom({ clientEmail: 'outra@x.com' }), ctx).erro, 'cupom nominal de outra pessoa');
assert.ok(!preco.validarCupom(cupom({ clientEmail: 'BIA@x.com ' }), ctx).erro, 'e-mail sem diferença de caixa');
// Cupom preso a um cliente: vale a identidade VERIFICADA, nunca o uid do corpo.
assert.ok(preco.validarCupom(cupom({ clientUid: 'u1' }), ctx).erro, 'visitante não usa cupom de cliente');
assert.ok(!preco.validarCupom(cupom({ clientUid: 'u1' }), { ...ctx, quem: { uid: 'u1' } }).erro);
// Desconto nunca vira crédito.
assert.deepStrictEqual(preco.validarCupom(cupom({ discountType: 'fixed', discountValue: 5000 }), ctx), { desconto: 780 });
assert.deepStrictEqual(preco.validarCupom(cupom({ discountValue: 250 }), ctx), { desconto: 780 }, '% acima de 100 trava em 100');
assert.ok(preco.validarCupom(cupom({ discountValue: -10 }), ctx).erro, 'desconto negativo encareceria');

// Gift card: usa o que der, até o restante do pedido.
assert.deepStrictEqual(preco.usoDoGiftCard({ status: 'active', balance: 100 }, 780), { usar: 100 });
assert.deepStrictEqual(preco.usoDoGiftCard({ status: 'active', balance: 1000 }, 780), { usar: 780 });
assert.ok(preco.usoDoGiftCard({ status: 'pending', balance: 0 }, 780).erro, 'gift não pago');
assert.ok(preco.usoDoGiftCard({ status: 'depleted', balance: 0 }, 780).erro, 'gift esgotado');
assert.ok(preco.usoDoGiftCard({ status: 'active', balance: '500' }, 780).erro, 'saldo em texto');
assert.ok(preco.usoDoGiftCard(null, 780).erro, 'gift inexistente');

// Conta completa: cupom primeiro, gift card sobre o que sobra.
assert.deepStrictEqual(preco.calcular({
  servicos: ['lavagem', 'vidros'], tamanho: 'pq', catalogo: CATALOGO,
  pediuCupom: true, cupom: cupom(), pediuGift: true, giftcard: { status: 'active', balance: 50 },
  email: 'bia@x.com', agora: AGORA,
}), { base: 300, couponDiscount: 30, giftCardUsed: 50, price: 220, saldoGift: 0 });

// Pediu cupom e o cupom não vale: recusa, em vez de cobrar cheio calado.
assert.ok(preco.calcular({
  servicos: ['lavagem'], tamanho: 'pq', catalogo: CATALOGO, pediuCupom: true, cupom: null, agora: AGORA,
}).erro);

// ── 2. criação do agendamento, com banco em memória ───────────────────
//
// O banco aplica as condições da transação como o DynamoDB: registro novo só
// se não existe; `seIgual` e `seAusenteOuIgual` conferidos; tudo ou nada.

function bancoEmMemoria(inicial) {
  const dados = JSON.parse(JSON.stringify(inicial));
  const transacoes = [];
  const falha = (indice) => Object.assign(new Error('condição'), { condicaoFalhou: true, indice });
  return {
    dados,
    transacoes,
    async dbGet(c) { return c in dados ? JSON.parse(JSON.stringify(dados[c])) : null; },
    async dbTransacao(lista) {
      transacoes.push(lista);
      lista.forEach((e, i) => {
        const atual = dados[e.caminho];
        if (e.tipo === 'criar' && atual !== undefined) throw falha(i);
        if (e.tipo === 'atualizar') {
          if (atual === undefined) throw falha(i);
          for (const [k, v] of Object.entries(e.seIgual || {})) if (atual[k] !== v) throw falha(i);
          for (const [k, v] of Object.entries(e.seAusenteOuIgual || {})) {
            if (k in atual && atual[k] !== v) throw falha(i);
          }
        }
      });
      for (const e of lista) {   // só chega aqui se todas as condições passaram
        if (e.tipo === 'criar') dados[e.caminho] = e.valor;
        else dados[e.caminho] = { ...dados[e.caminho], ...e.campos };
      }
    },
  };
}

const BASE = {
  services: CATALOGO,
  'coupons/BEMVINDO10': { code: 'BEMVINDO10', discountType: 'percent', discountValue: 10 },
  'coupons/AMIGO-X': { code: 'AMIGO-X', discountType: 'fixed', discountValue: 50, clientEmail: 'bia@x.com' },
  'giftcards/GIFT-A': { code: 'GIFT-A', amount: 200, balance: 200, status: 'active' },
  'giftcards/GIFT-P': { code: 'GIFT-P', amount: 200, balance: 0, status: 'pending' },
};

const pedido = (extra = {}) => ({
  id: 'SPC-1', status: 'pending', name: 'Bia', email: 'bia@x.com', phone: '11999999999',
  services: ['cristal'], carSize: 'gr', date: '2026-12-20', ...extra,
});

(async () => {
  // ATAQUE 1 (S-05): o corpo diz R$ 1. Grava-se o preço do catálogo.
  let db = bancoEmMemoria(BASE);
  let r = await criarAgendamentoPublico('SPC-1', pedido({ price: 1, couponDiscount: 1299, giftCardUsed: 0 }),
    null, { store: db, agora: AGORA });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.dados['bookings/SPC-1'].price, 1300, 'o preço é do catálogo, não do corpo');
  assert.strictEqual(db.dados['bookings/SPC-1'].basePrice, 1300);
  assert.strictEqual(db.dados['bookings/SPC-1'].pricedBy, 'server');
  assert.ok(!('couponDiscount' in db.dados['bookings/SPC-1']), 'desconto sem cupom não existe');
  assert.strictEqual(r.agendamento.price, 1300, 'o site recebe o valor gravado');

  // Cupom válido: abate e é BAIXADO na mesma transação.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ couponCode: ' bemvindo10 ' }), null, { store: db, agora: AGORA });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.dados['bookings/SPC-1'].price, 1170);
  assert.strictEqual(db.dados['bookings/SPC-1'].couponCode, 'BEMVINDO10');
  assert.strictEqual(db.dados['bookings/SPC-1'].couponDiscount, 130);
  assert.strictEqual(db.dados['coupons/BEMVINDO10'].used, true, 'cupom baixado');
  assert.strictEqual(db.dados['coupons/BEMVINDO10'].usedBy, 'SPC-1');
  assert.strictEqual(db.transacoes.length, 1, 'pedido e baixa numa transação só');

  // ATAQUE 2 (S-07): reusar o cupom de uso único num segundo pedido.
  r = await criarAgendamentoPublico('SPC-2', pedido({ id: 'SPC-2', couponCode: 'BEMVINDO10' }), null,
    { store: db, agora: AGORA });
  assert.strictEqual(r.status, 422, 'cupom usado é recusado');
  assert.ok(!db.dados['bookings/SPC-2'], 'e o pedido não é gravado com desconto indevido');

  // ATAQUE 2b: dois pedidos SIMULTÂNEOS com o mesmo cupom. Os dois leem "não
  // usado"; a condição da transação deixa passar só o primeiro.
  db = bancoEmMemoria(BASE);
  const [a, b] = await Promise.all([
    criarAgendamentoPublico('SPC-A', pedido({ id: 'SPC-A', couponCode: 'BEMVINDO10' }), null, { store: db, agora: AGORA }),
    criarAgendamentoPublico('SPC-B', pedido({ id: 'SPC-B', couponCode: 'BEMVINDO10' }), null, { store: db, agora: AGORA }),
  ]);
  assert.deepStrictEqual([a.status, b.status].sort(), [200, 409], 'só um leva o cupom');
  assert.strictEqual(Object.keys(db.dados).filter((k) => k.startsWith('bookings/')).length, 1,
    'o perdedor não deixa agendamento pela metade');

  // Cupom nominal de outra pessoa.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ email: 'intrusa@x.com', couponCode: 'AMIGO-X' }), null,
    { store: db, agora: AGORA });
  assert.strictEqual(r.status, 422);
  assert.ok(!db.dados['coupons/AMIGO-X'].used, 'cupom recusado não é baixado');

  // Gift card: desconta o saldo de verdade, na mesma transação.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ giftCardCode: 'GIFT-A' }), null, { store: db, agora: AGORA });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.dados['bookings/SPC-1'].price, 1100);
  assert.strictEqual(db.dados['bookings/SPC-1'].giftCardUsed, 200);
  assert.strictEqual(db.dados['giftcards/GIFT-A'].balance, 0);
  assert.strictEqual(db.dados['giftcards/GIFT-A'].status, 'depleted');

  // ATAQUE 3: abater um gift card maior do que o saldo, pelo corpo.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ giftCardCode: 'GIFT-A', giftCardUsed: 1300, price: 0 }), null,
    { store: db, agora: AGORA });
  assert.strictEqual(db.dados['bookings/SPC-1'].giftCardUsed, 200, 'o abatimento é o saldo, não o corpo');
  assert.strictEqual(db.dados['bookings/SPC-1'].price, 1100);

  // Saldo maior que o pedido: sobra saldo, gift continua ativo.
  db = bancoEmMemoria({ ...BASE, 'giftcards/GIFT-A': { ...BASE['giftcards/GIFT-A'], balance: 2000 } });
  r = await criarAgendamentoPublico('SPC-1', pedido({ giftCardCode: 'GIFT-A' }), null, { store: db, agora: AGORA });
  assert.strictEqual(db.dados['bookings/SPC-1'].price, 0);
  assert.strictEqual(db.dados['giftcards/GIFT-A'].balance, 700);
  assert.strictEqual(db.dados['giftcards/GIFT-A'].status, 'active');

  // ATAQUE 3b: gastar o mesmo saldo em dois pedidos ao mesmo tempo. A
  // condição exige o saldo que foi lido; o segundo falha inteiro.
  db = bancoEmMemoria(BASE);
  const [g1, g2] = await Promise.all([
    criarAgendamentoPublico('SPC-G1', pedido({ id: 'SPC-G1', giftCardCode: 'GIFT-A' }), null, { store: db, agora: AGORA }),
    criarAgendamentoPublico('SPC-G2', pedido({ id: 'SPC-G2', giftCardCode: 'GIFT-A' }), null, { store: db, agora: AGORA }),
  ]);
  assert.deepStrictEqual([g1.status, g2.status].sort(), [200, 409]);
  assert.strictEqual(db.dados['giftcards/GIFT-A'].balance, 0, 'o saldo é gasto uma vez só');

  // Gift card não pago não abate.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ giftCardCode: 'GIFT-P' }), null, { store: db, agora: AGORA });
  assert.strictEqual(r.status, 422);
  assert.ok(!db.dados['bookings/SPC-1']);

  // Cupom zera o pedido: o gift card nem é tocado.
  db = bancoEmMemoria({ ...BASE, 'coupons/TUDO': { discountType: 'percent', discountValue: 100 } });
  r = await criarAgendamentoPublico('SPC-1', pedido({ couponCode: 'TUDO', giftCardCode: 'GIFT-A' }), null,
    { store: db, agora: AGORA });
  assert.strictEqual(db.dados['bookings/SPC-1'].price, 0);
  assert.strictEqual(db.dados['giftcards/GIFT-A'].balance, 200, 'saldo intacto quando não há o que abater');
  assert.ok(!('giftCardCode' in db.dados['bookings/SPC-1']));

  // Código com formato inválido nem chega ao banco.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ couponCode: '../config' }), null, { store: db, agora: AGORA });
  assert.strictEqual(r.status, 422);

  // Serviço fora do catálogo.
  db = bancoEmMemoria(BASE);
  r = await criarAgendamentoPublico('SPC-1', pedido({ services: ['inventado'] }), null, { store: db, agora: AGORA });
  assert.strictEqual(r.status, 422);

  // ── 3. o pedido que vai para o DynamoDB ─────────────────────────────
  let enviado = null;
  store._injetar(async (op, params) => { enviado = { op, params }; return {}; });
  await store.dbTransacao([
    { tipo: 'criar', caminho: 'bookings/SPC-9', valor: { id: 'SPC-9', email: 'bia@x.com', date: '2026-12-20' } },
    { tipo: 'atualizar', caminho: 'coupons/X1', campos: { used: true }, seAusenteOuIgual: { used: false } },
    { tipo: 'atualizar', caminho: 'giftcards/G1', campos: { balance: 0 }, seIgual: { balance: 200, status: 'active' } },
  ]);
  assert.strictEqual(enviado.op, 'TransactWriteItems');
  const [put, upCupom, upGift] = enviado.params.TransactItems;
  assert.strictEqual(put.Put.ConditionExpression, 'attribute_not_exists(pk)', 'não sobrescreve agendamento');
  assert.strictEqual(put.Put.Item.pk.S, 'BOOKING');
  assert.strictEqual(put.Put.Item.sk.S, 'SPC-9');
  assert.ok(put.Put.Item.gsi2pk, 'mantém os índices do agendamento');
  assert.strictEqual(upCupom.Update.Key.pk.S, 'COUPON');
  assert.match(upCupom.Update.ConditionExpression, /attribute_exists\(pk\)/, 'cupom inexistente não é criado');
  assert.match(upCupom.Update.ConditionExpression, /attribute_not_exists\(#d\.#a0\) OR #d\.#a0 = :a0/);
  assert.strictEqual(upGift.Update.Key.pk.S, 'GIFTCARD');
  assert.match(upGift.Update.ConditionExpression, /#d\.#q0 = :q0 AND #d\.#q1 = :q1/, 'saldo e status conferidos');
  assert.deepStrictEqual(upGift.Update.ExpressionAttributeValues[':q0'], { N: '200' });

  // Condição que falha vira erro reconhecível, com o índice de quem falhou.
  store._injetar(async () => {
    throw Object.assign(new Error('cancelada'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
    });
  });
  await assert.rejects(
    store.dbTransacao([{ tipo: 'criar', caminho: 'bookings/A', valor: {} },
      { tipo: 'atualizar', caminho: 'coupons/X', campos: { used: true } }]),
    (e) => e.condicaoFalhou === true && e.indice === 1,
  );
  // Outros erros passam como vieram (não viram "cupom já usado").
  store._injetar(async () => { throw new Error('rede caiu'); });
  await assert.rejects(store.dbTransacao([{ tipo: 'criar', caminho: 'bookings/A', valor: {} }]), /rede caiu/);
  // Coleção inteira não entra em transação.
  await assert.rejects(store.dbTransacao([{ tipo: 'criar', caminho: 'bookings', valor: {} }]));

  console.log('preço no servidor: catálogo manda, cupom baixa uma vez, gift card não gasta duas — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
