'use strict';

// Testes do dataclient.js — roteamento, consultas e chaves de push.
//
// Rodar: node scripts/test-dataclient.js
//
// O roteamento é o coração desta camada: errar para qual lado vai uma leitura
// ou uma escrita significa painel quebrado (escrita recusada pelo Firebase) ou
// site lento (leitura pública indo pela Lambda sem necessidade). Dá para
// verificar isso sem rede e sem navegador, então está aqui.

const assert = require('assert');
const { DB } = require('../dataclient.js');
const { aplicarConsulta, usarLambdaParaLer, usarLambdaParaEscrever, novaChavePush } = DB._interno;

let ehAdmin = false;
DB.configurar({ firebaseDb: {}, ehAdmin: () => ehAdmin, pegarToken: async () => 'token-de-teste' });

// ── roteamento ─────────────────────────────────────────────────────────
ehAdmin = false;
assert.strictEqual(usarLambdaParaLer('bookings'), false, 'visitante lê direto (regras do RTDB decidem)');
assert.strictEqual(usarLambdaParaEscrever(), false, 'visitante escreve direto — é como agendamento e gift card entram');

ehAdmin = true;
assert.strictEqual(usarLambdaParaLer('bookings'), true, 'admin lê nó restrito pela Lambda');
assert.strictEqual(usarLambdaParaLer('bookings/SPC-1'), true, 'a raiz do caminho é que decide');
assert.strictEqual(usarLambdaParaLer('feedback'), false, 'nó de leitura pública continua direto, em tempo real');
assert.strictEqual(usarLambdaParaLer('config/adminPassword'), false, 'config é público nas regras');
assert.strictEqual(usarLambdaParaEscrever(), true, 'admin escreve pela Lambda');

// ── consultas: equalTo (o filtro que impede avaliação pendente no site) ─
const fb = {
  a: { status: 'approved', t: 1 },
  b: { status: 'pending', t: 2 },
  c: { status: 'approved', t: 3 },
};
assert.deepStrictEqual(
  Object.keys(aplicarConsulta(fb, { ordem: { tipo: 'child', campo: 'status' }, igual: 'approved' })).sort(),
  ['a', 'c'], 'só as aprovadas passam');
assert.strictEqual(
  aplicarConsulta(fb, { ordem: { tipo: 'child', campo: 'status' }, igual: 'rejected' }),
  null, 'sem correspondência o Firebase devolve null — aqui também');

// ── consultas: orderByKey + limitToLast (os aiLogs da Central de IA) ───
const logs = {};
for (let i = 1; i <= 30; i++) logs['k' + String(i).padStart(2, '0')] = { at: i };
const ultimos = aplicarConsulta(logs, { ordem: { tipo: 'key' }, limiteFim: 20 });
assert.strictEqual(Object.keys(ultimos).length, 20);
assert.strictEqual(Object.keys(ultimos)[0], 'k11');
assert.strictEqual(Object.keys(ultimos)[19], 'k30');

// ── consultas: identidade quando não há consulta ou o valor é escalar ──
assert.deepStrictEqual(aplicarConsulta(fb, null), fb);
assert.strictEqual(aplicarConsulta(null, { ordem: { tipo: 'key' } }), null);
assert.strictEqual(aplicarConsulta('texto', { ordem: { tipo: 'key' } }), 'texto');

// ── chaves de push no formato do Firebase ──────────────────────────────
const chaves = Array.from({ length: 1000 }, novaChavePush);
assert.ok(chaves.every((k) => k.length === 20), '20 caracteres, como as que já estão no banco');
assert.strictEqual(new Set(chaves).size, 1000, 'sem colisão no mesmo milissegundo');
assert.deepStrictEqual([...chaves].sort(), chaves, 'ordem lexicográfica = ordem cronológica');

// ── once: as duas formas (promessa e callback) ──────────────────────────
(async () => {
  const chamadas = [];
  global.fetch = async (url, opt) => {
    chamadas.push({ url, corpo: JSON.parse(opt.body), auth: opt.headers.Authorization });
    return { ok: true, json: async () => ({ ok: true, dados: fb }) };
  };

  // callback: é a forma usada em 20 pontos do app.js
  const snap = await new Promise((ok, falha) => {
    DB.ref('waitlist').orderByChild('status').equalTo('approved').once('value', ok, falha);
  });
  assert.deepStrictEqual(Object.keys(snap.val()).sort(), ['a', 'c'], 'filtro aplicado sobre o que a Lambda devolveu');
  assert.strictEqual(snap.exists(), true);
  assert.deepStrictEqual(chamadas[0].corpo, { op: 'ler', caminho: 'waitlist' }, 'a Lambda recebe o nó, não a consulta');
  assert.strictEqual(chamadas[0].auth, 'Bearer token-de-teste');

  // promessa
  const snap2 = await DB.ref('bookings').once('value');
  assert.deepStrictEqual(snap2.val(), fb);

  // erro COM callback de erro: vai para o erroCb
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'negado' }) });
  const msg = await new Promise((ok) => {
    DB.ref('bookings').once('value', () => ok('NÃO DEVERIA CHAMAR'), (e) => ok(e.message));
  });
  assert.strictEqual(msg, 'negado');

  // erro SEM callback de erro: a promessa REJEITA, para o `.catch()` da própria
  // chamada funcionar. É disso que `openClientAccount()` depende para abrir a
  // tela de "Minha Conta" quando a leitura do perfil é negada; engolir o erro
  // aqui deixava a tela sem abrir e sem nada no console.
  let caiuNoCatch = false;
  await new Promise((pronto) => {
    DB.ref('bookings').once('value', () => { /* não chamado */ })
      .catch(() => { caiuNoCatch = true; })
      .then(pronto);
  });
  assert.strictEqual(caiuNoCatch, true, 'once sem erroCb rejeita, como no Firebase');

  // ── escritas viram as ops certas ────────────────────────────────────
  const ops = [];
  global.fetch = async (url, opt) => {
    ops.push(JSON.parse(opt.body));
    return { ok: true, json: async () => ({ ok: true, dados: null }) };
  };
  await DB.ref('bookings/SPC-1').set({ id: 'SPC-1' });
  await DB.ref('config').update({ pointsPerReal: 1 });
  await DB.ref('bookings/SPC-1').remove();
  await DB.ref('blocked/2026-12-25').set(null);
  assert.deepStrictEqual(ops.map((o) => [o.op, o.caminho]), [
    ['gravar', 'bookings/SPC-1'],
    ['mesclar', 'config'],
    ['apagar', 'bookings/SPC-1'],
    ['apagar', 'blocked/2026-12-25'],
  ], 'set→gravar, update→mesclar, remove→apagar, set(null)→apagar');

  // push devolve a ref com a chave já disponível, como no Firebase
  const filho = DB.ref('portfolio').push({ url: 'x' });
  assert.strictEqual(filho.key.length, 20);
  await filho;
  assert.strictEqual(ops[ops.length - 1].caminho, `portfolio/${filho.key}`);

  console.log('dataclient: todos os testes passaram');
})().catch((e) => {
  console.error('dataclient FALHOU:', e.message);
  process.exit(1);
});
