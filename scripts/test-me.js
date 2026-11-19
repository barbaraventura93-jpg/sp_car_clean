'use strict';

// Testes da política do /api/me — a parte que separa "meus dados" de
// "dados de qualquer um". Sem rede.
//
// Rodar: node scripts/test-me.js

const assert = require('assert');
const { _interno } = require('../functions/me.js');
const { validarPerfil, ehDono, idValido } = _interno;

// ── lista de campos permitidos ─────────────────────────────────────────
assert.ok(validarPerfil({ name: 'Maria', phone: '11999990000' }).limpo, 'campos normais passam');
assert.deepStrictEqual(
  validarPerfil({ name: 'Maria', address: { street: 'X', number: '1' } }).limpo,
  { name: 'Maria', address: { street: 'X', number: '1' } });

// O ponto da lista: ponto é desconto, e o cliente não credita o próprio.
assert.strictEqual(validarPerfil({ points: 999999 }).erro, 'campo não permitido: points');
assert.strictEqual(validarPerfil({ pointsHistory: [] }).erro, 'campo não permitido: pointsHistory');
// Nem escondido no meio de um corpo legítimo.
assert.strictEqual(validarPerfil({ name: 'Maria', points: 999999 }).erro, 'campo não permitido: points');
// Nem renomeando o nó.
assert.strictEqual(validarPerfil({ uid: 'outro-uid' }).erro, 'campo não permitido: uid');
assert.strictEqual(validarPerfil({ email: 'outro@ex.com' }).erro, 'campo não permitido: email');

// ── tipos e tamanhos ───────────────────────────────────────────────────
assert.strictEqual(validarPerfil({ name: 123 }).erro, 'campo inválido: name');
assert.strictEqual(validarPerfil({ name: 'x'.repeat(201) }).erro, 'campo inválido: name');
assert.strictEqual(validarPerfil({ address: 'rua tal' }).erro, 'campo inválido: address');
assert.strictEqual(validarPerfil({ vehicles: 'fusca' }).erro, 'campo inválido: vehicles');
assert.strictEqual(validarPerfil({ vehicles: new Array(21).fill({}) }).erro, 'campo inválido: vehicles');
assert.ok(validarPerfil({ vehicles: [{ car: 'Fusca', plate: 'ABC1D23' }] }).limpo, 'lista de veículos passa');
// primaryVehicle pode ser null (o app zera quando não há veículo)
assert.deepStrictEqual(validarPerfil({ primaryVehicle: null }).limpo, { primaryVehicle: null });
assert.ok(validarPerfil({ createdAt: '2026-11-08T00:00:00.000Z', linkedEmails: ['a@b.com'] }).limpo,
  'campos do cadastro passam');
assert.strictEqual(validarPerfil({}).erro, 'nada para salvar');
assert.strictEqual(validarPerfil(null).erro, 'dados inválidos');
assert.strictEqual(validarPerfil([1, 2]).erro, 'dados inválidos');

// ── posse do agendamento ───────────────────────────────────────────────
const eu = { uid: 'uid-1', email: 'maria@ex.com' };
assert.strictEqual(ehDono({ clientUid: 'uid-1' }, eu), true, 'por uid');
assert.strictEqual(ehDono({ email: 'MARIA@EX.COM' }, eu), true, 'por e-mail, sem olhar maiúsculas');
assert.strictEqual(ehDono({ clientUid: 'uid-2', email: 'outro@ex.com' }, eu), false, 'de outra pessoa');
assert.strictEqual(ehDono({}, eu), false, 'agendamento sem dono não é meu');
assert.strictEqual(ehDono(null, eu), false);
// Sem e-mail no token, um agendamento sem e-mail não pode casar por vazio
assert.strictEqual(ehDono({ email: '' }, { uid: 'uid-1', email: '' }), false, 'vazio não casa com vazio');

// ── formato do id ──────────────────────────────────────────────────────
assert.strictEqual(idValido('SPC-ABC123'), true);
assert.strictEqual(idValido('../config'), false, 'não escapa do nó');
assert.strictEqual(idValido('a/b'), false);
assert.strictEqual(idValido(''), false);
assert.strictEqual(idValido('ab'), false, 'curto demais');
assert.strictEqual(idValido('x'.repeat(41)), false, 'longo demais');
assert.strictEqual(idValido(null), false);

console.log('me: todos os testes passaram');
