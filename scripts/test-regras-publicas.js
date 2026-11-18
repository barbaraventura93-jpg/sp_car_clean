'use strict';

// O que o visitante não logado pode ler e gravar
// (functions/lib/core/regras-publicas.js).
//
// Rodar: node scripts/test-regras-publicas.js
//
// POR QUE EXISTE: até 10/11/2026 quem autorizava o visitante eram as regras do
// Realtime Database (`database.rules.json`). Com o banco no DynamoDB, essas
// regras não são aplicadas por ninguém — a autorização passou a ser este
// módulo. Se ele estiver frouxo, não há segunda barreira.
//
// Os casos de ATAQUE abaixo não são hipóteses: criar agendamento já marcado
// como pago e forjar gift card com saldo são exatamente as brechas que as
// regras antigas fechavam, e uma delas já esteve aberta neste projeto.

const assert = require('assert');
const r = require('../functions/lib/core/regras-publicas.js');

const ler = (caminho, consulta) => r.podeLer(caminho.split('/'), consulta);
const gravar = (caminho, novo, atual = null) => r.podeGravar(caminho.split('/'), novo, atual);

// ── leitura: catálogo é público, base de ninguém é ────────────────────

for (const no of ['services', 'combos', 'config', 'portfolio', 'gallery', 'blocked', 'dayLoad']) {
  assert.strictEqual(ler(no), true, `${no} é público (o site precisa para montar a página)`);
  assert.strictEqual(ler(`${no}/alguma-chave`), true, `${no}/<id> também`);
}

// O que o visitante NÃO pode listar. Cada um por um motivo próprio:
assert.strictEqual(ler('bookings'), false, 'listar agendamentos é a agenda inteira do negócio');
assert.strictEqual(ler('clientProfiles'), false, 'base de clientes');
assert.strictEqual(ler('coupons'), false, 'listar cupons é poder usar todos');
assert.strictEqual(ler('giftcards'), false, 'listar gift cards é poder gastar os alheios');
assert.strictEqual(ler('stock'), false);
assert.strictEqual(ler('aiConfig'), false);
assert.strictEqual(ler('referrals'), false);
assert.strictEqual(ler('clientNotes'), false, 'anotações da dona sobre clientes');

// Mas quem tem o CÓDIGO lê aquele item — é como o cupom é validado no site.
assert.strictEqual(ler('coupons/ANIV2026'), true);
assert.strictEqual(ler('giftcards/GIFT-123'), true);
assert.strictEqual(ler('feedback/SPC-1'), true);

// `feedback` inteiro só com o filtro de aprovadas: sem isso, avaliação
// pendente (ainda não moderada) apareceria no site.
assert.strictEqual(ler('feedback'), false, 'sem filtro, não');
assert.strictEqual(ler('feedback', { ordem: 'status', igual: 'approved' }), true);
assert.strictEqual(ler('feedback', { ordem: 'status', igual: 'pending_review' }), false,
  'o filtro tem que ser o de APROVADAS, não qualquer filtro');
assert.strictEqual(ler('feedback', { ordem: 'rating', igual: 'approved' }), false);

// ── criar agendamento: o pedido é dele, o dinheiro não ────────────────

const pedido = (extra = {}) => ({
  id: 'SPC-1', status: 'pending', name: 'Ana', email: 'ana@x.com',
  phone: '11999999999', date: '2026-12-01', price: 150, ...extra,
});

assert.strictEqual(gravar('bookings/SPC-1', pedido()), true, 'o caminho normal funciona');

// ATAQUE: nascer já pago.
for (const campo of r.CAMPOS_DE_DINHEIRO) {
  assert.strictEqual(gravar('bookings/SPC-1', pedido({ [campo]: 999 })), false,
    `agendamento novo não pode trazer ${campo}`);
}

// ATAQUE: nascer já confirmado, pulando a aprovação da dona.
for (const st of ['confirmed', 'approved', 'completed', 'cancelled']) {
  assert.strictEqual(gravar('bookings/SPC-1', pedido({ status: st })), false,
    `agendamento novo não pode nascer ${st}`);
}

// ATAQUE: id do corpo diferente da chave — gravaria num lugar e se diria outro.
assert.strictEqual(gravar('bookings/SPC-1', pedido({ id: 'SPC-OUTRO' })), false);

// ATAQUE: criar o nó inteiro de uma vez.
assert.strictEqual(gravar('bookings', { 'SPC-1': pedido() }), false);

// ── alterar agendamento: só cancelar ──────────────────────────────────

const existente = {
  id: 'SPC-1', status: 'approved', name: 'Ana', email: 'ana@x.com', phone: '11999999999',
  createdAt: '2026-11-01T10:00:00Z', price: 150, finalPrice: 150, paidAmount: 150,
  paymentTransactionId: 'tx-1', paymentConfirmedAt: '2026-11-02T10:00:00Z',
};

assert.strictEqual(gravar('bookings/SPC-1', { ...existente, status: 'cancelled' }, existente), true,
  'cancelar é a única mudança de estado permitida');
assert.strictEqual(gravar('bookings/SPC-1', { ...existente }, existente), true,
  'gravar igual não muda nada e passa');

// ATAQUE: baixar o próprio preço, ou se declarar pago.
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, price: 1 }, existente), false);
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, finalPrice: 1 }, existente), false);
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, paidAmount: 999 }, existente), false);
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, paymentConfirmedAt: 'agora' }, existente), false);
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, pointsAwardedAt: 'agora' }, existente), false,
  'creditar pontos a si mesmo');

// ATAQUE: assumir o agendamento de outra pessoa trocando o e-mail.
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, email: 'outro@x.com' }, existente), false);
assert.strictEqual(gravar('bookings/SPC-1', { ...existente, name: 'Outro' }, existente), false);

// ATAQUE: apagar campo de dinheiro em vez de mudá-lo.
const semPago = { ...existente }; delete semPago.paidAmount;
assert.strictEqual(gravar('bookings/SPC-1', semPago, existente), false,
  'remover o campo é mudá-lo');

// ATAQUE: promover a confirmado/concluído.
for (const st of ['confirmed', 'completed', 'pending']) {
  assert.strictEqual(gravar('bookings/SPC-1', { ...existente, status: st }, existente), false,
    `visitante não pode mudar para ${st}`);
}

// ── lista de espera ───────────────────────────────────────────────────

const espera = { id: 'W1', name: 'Ana', phone: '11999999999', date: '2026-12-01' };
assert.strictEqual(gravar('waitlist/W1', espera), true);
assert.strictEqual(gravar('waitlist/W1', { ...espera, id: 'OUTRO' }), false);
assert.strictEqual(gravar('waitlist/W1', { ...espera, name: 'x'.repeat(201) }), false, 'nome gigante');
assert.strictEqual(gravar('waitlist/W1', { ...espera, phone: 'x'.repeat(41) }), false);
assert.strictEqual(gravar('waitlist/W1', { ...espera, name: 123 }), false, 'nome tem que ser texto');
assert.strictEqual(gravar('waitlist/W1', espera, espera), false, 'não sobrescreve existente');

// ── avaliação ─────────────────────────────────────────────────────────

const aval = { status: 'pending_review', rating: 5, comment: 'ótimo' };
assert.strictEqual(gravar('feedback/F1', aval), true);
assert.strictEqual(gravar('feedback/F1', { status: 'internal', rating: 3 }), true);

// ATAQUE: publicar avaliação já aprovada, pulando a moderação.
assert.strictEqual(gravar('feedback/F1', { ...aval, status: 'approved' }), false,
  'aprovar a própria avaliação é publicar no site sem passar pela dona');

// Nota fora da faixa, nota que não é número, comentário gigante.
for (const nota of [0, 6, -1, 5.5 * 2, '5', null, undefined]) {
  const esperado = typeof nota === 'number' && nota >= 1 && nota <= 5;
  assert.strictEqual(gravar('feedback/F1', { ...aval, rating: nota }), esperado, `nota ${nota}`);
}
assert.strictEqual(gravar('feedback/F1', { ...aval, comment: 'x'.repeat(2001) }), false);
assert.strictEqual(gravar('feedback/F1', { status: 'pending_review', rating: 4 }), true,
  'comentário é opcional');
assert.strictEqual(gravar('feedback/F1', aval, aval), false, 'não reescreve avaliação existente');

// ── gift card: o histórico deste projeto ──────────────────────────────

assert.strictEqual(gravar('giftcards/G1', { status: 'pending', balance: 0, amount: 200 }), true);

// ATAQUE: nascer ativo e com saldo — era assim que o gift card virava forjável.
assert.strictEqual(gravar('giftcards/G1', { status: 'active', balance: 200, amount: 200 }), false);
assert.strictEqual(gravar('giftcards/G1', { status: 'pending', balance: 200, amount: 200 }), false);
assert.strictEqual(gravar('giftcards/G1', { status: 'pending', balance: 0, amount: 0 }), false);
assert.strictEqual(gravar('giftcards/G1', { status: 'pending', balance: 0, amount: -5 }), false);
assert.strictEqual(gravar('giftcards/G1', { status: 'pending', balance: 0, amount: '200' }), false);

const ativo = { code: 'G1', status: 'active', amount: 200, balance: 200 };
assert.strictEqual(gravar('giftcards/G1', { ...ativo, balance: 50 }, ativo), true, 'gastar diminui saldo');
assert.strictEqual(gravar('giftcards/G1', { ...ativo, balance: 0, status: 'depleted' }, ativo), true);

// ATAQUE: recarregar o próprio gift card, ou aumentar o valor de face.
assert.strictEqual(gravar('giftcards/G1', { ...ativo, balance: 500 }, ativo), false, 'saldo não sobe');
assert.strictEqual(gravar('giftcards/G1', { ...ativo, amount: 5000 }, ativo), false);
assert.strictEqual(gravar('giftcards/G1', { ...ativo, code: 'OUTRO' }, ativo), false);
assert.strictEqual(gravar('giftcards/G1', { ...ativo, balance: -1 }, ativo), false);
// Gift card já gasto não volta a viver.
const gasto = { ...ativo, status: 'depleted', balance: 0 };
assert.strictEqual(gravar('giftcards/G1', { ...gasto, status: 'active', balance: 200 }, gasto), false);

// ── o que o visitante nunca faz ───────────────────────────────────────

assert.strictEqual(r.podeApagar(), false, 'visitante não apaga nada');
for (const no of ['services', 'config', 'stock', 'coupons', 'clientProfiles', 'aiConfig']) {
  assert.strictEqual(gravar(`${no}/x`, { qualquer: 'coisa' }), false, `não grava em ${no}`);
}

console.log('regras públicas: catálogo aberto, base fechada, dinheiro intocável, gift card não forjável — todos passaram');
