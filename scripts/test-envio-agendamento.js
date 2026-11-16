'use strict';

// O envio do agendamento só diz "recebemos" se o pedido foi gravado.
//
// Por que existe: em 10/11/2026 o banco de dados saiu do ar e ninguém percebeu
// por dias. O site disparava a gravação sem esperar o resultado e mostrava
// "solicitação recebida" de qualquer jeito, mandando até e-mail de
// confirmação. Um cliente que agendasse sairia achando que estava marcado.
//
// Aqui: a função que espera a gravação (com prazo), e a ordem das coisas
// dentro de submitBooking — gravar e conferir ANTES de gastar cupom, avisar a
// admin ou mandar e-mail.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

// ── A função real, extraída de app.js ─────────────────────────────────────
const ini = APP.indexOf('function _gravouNoPrazo');
assert.ok(ini > 0, '_gravouNoPrazo precisa existir em app.js');
const fim = APP.indexOf('\n}\n', ini) + 3;
const _gravouNoPrazo = new Function(APP.slice(ini, fim) + '; return _gravouNoPrazo;')();

// ── A ordem dentro de submitBooking ───────────────────────────────────────
const s0 = APP.indexOf('async function submitBooking()');
const corpo = APP.slice(s0, APP.indexOf('\nasync function ', s0 + 10) > 0 ? APP.indexOf('\nfunction ', s0 + 10) : undefined);
const pos = (trecho) => { const p = corpo.indexOf(trecho); assert.ok(p > 0, `não achei em submitBooking: ${trecho}`); return p; };
const gravacao = pos('await _gravouNoPrazo(_bookingsRef.child(id).set(b))');
const desistencia = pos('if (!gravou) {');
assert.ok(gravacao < desistencia, 'confere o resultado logo depois de gravar');
assert.ok(/if \(!gravou\) \{[\s\S]{0,700}?return;\s*\}/.test(corpo), 'se não gravou, a função para ali');
for (const depois of ['_markCouponUsed(', '_useGiftCard(', "sendEmail('template_update'", '_bookings.push(b)', "chamarMe('indexar-agendamento'"]) {
  assert.ok(pos(depois) > desistencia, `"${depois}" só pode acontecer depois de confirmar a gravação`);
}
assert.ok(!/_bookingsRef\.child\(id\)\.set\(b\)\.catch/.test(corpo), 'não pode sobrar gravação disparada sem esperar');
assert.ok(/!!_bookingsRef &&/.test(corpo), 'sem conexão com o banco também é falha, não sucesso');

// Se uma espera nunca terminar, o Node encerra sozinho por falta do que fazer —
// com código 0, como se tivesse passado. Este guarda transforma isso em falha.
let chegouAoFim = false;
process.on('exit', (codigo) => {
  if (!chegouAoFim && codigo === 0) {
    console.error('FALHOU: o teste terminou sem chegar ao fim (uma espera ficou pendente para sempre)');
    process.exitCode = 1;
  }
});

(async () => {
  // Gravou: true.
  assert.strictEqual(await _gravouNoPrazo(Promise.resolve(), 50), true);
  assert.strictEqual(await _gravouNoPrazo(new Promise((ok) => setTimeout(ok, 10)), 200), true);
  // O banco recusou: false.
  assert.strictEqual(await _gravouNoPrazo(Promise.reject(new Error('PERMISSION_DENIED')), 50), false);
  // O caso de 10/11: a gravação nunca termina. Tem que desistir no prazo.
  const t0 = Date.now();
  assert.strictEqual(await _gravouNoPrazo(new Promise(() => {}), 60), false, 'gravação pendente para sempre é falha');
  const levou = Date.now() - t0;
  assert.ok(levou >= 50 && levou < 500, `desiste perto do prazo (levou ${levou} ms)`);
  // Terminou depois do prazo: continua valendo a resposta dada (false).
  assert.strictEqual(await _gravouNoPrazo(new Promise((ok) => setTimeout(ok, 120)), 30), false);
  // Valor que nem é promessa não trava.
  assert.strictEqual(await _gravouNoPrazo(undefined, 50), true);
  // Prazo padrão razoável para quem está no celular: entre 5 e 15 segundos.
  const padrao = Number((APP.slice(ini, fim).match(/ms = (\d+)/) || [])[1]);
  assert.ok(padrao >= 5000 && padrao <= 15000, `prazo padrão de ${padrao} ms`);

  chegouAoFim = true;
  console.log('envio do agendamento: só confirma o que foi gravado — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
