'use strict';

// Guarda das regras do banco (database.rules.json) dentro do `npm test`.
//
// O teste de verdade das regras roda no emulador do Firebase
// (scripts/regras-emulador.js, 88 casos), mas ele precisa de Java e fica fora
// do `npm test`. Este aqui é o vigia barato: lê o arquivo e reprova se uma das
// travas for removida ou afrouxada sem querer. Passar aqui NÃO substitui rodar
// o emulador antes de publicar regras novas.
//
// Lembrete: o arquivo no repositório só vale depois de PUBLICADO no Firebase.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bruto = fs.readFileSync(path.resolve(__dirname, '../database.rules.json'), 'utf8');
// O arquivo aceita comentários de linha; o JSON.parse não.
const regras = JSON.parse(bruto.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')).rules;

const ADMIN = "auth != null && auth.token.email == 'spcarclean0@gmail.com'";
const soAdmin = (r) => r === ADMIN;

// ── Nenhum nó pode ter escrita aberta ─────────────────────────────────────
(function varrer(no, caminho) {
  for (const [chave, valor] of Object.entries(no)) {
    if (chave === '.write') {
      assert.notStrictEqual(valor, true, `${caminho}: ".write": true deixa qualquer pessoa gravar e apagar`);
      assert.notStrictEqual(valor, 'true', `${caminho}: escrita aberta`);
      assert.notStrictEqual(valor, 'newData.exists()', `${caminho}: permite sobrescrever o registro de outra pessoa`);
    } else if (valor && typeof valor === 'object') varrer(valor, `${caminho}/${chave}`);
  }
})(regras, '');

// ── Leitura pública só onde é vitrine ─────────────────────────────────────
const LEITURA_PUBLICA_OK = new Set(['dayLoad', 'portfolio', 'blocked', 'config', 'services', 'combos', 'gallery']);
for (const [no, r] of Object.entries(regras)) {
  if (r['.read'] === true) assert.ok(LEITURA_PUBLICA_OK.has(no), `${no}: leitura pública da lista inteira não é esperada`);
}

// ── Agendamentos ──────────────────────────────────────────────────────────
assert.ok(soAdmin(regras.bookings['.read']) && soAdmin(regras.bookings['.write']), 'bookings: lista só para admin');
const bk = regras.bookings.$id['.write'];
const [criar] = bk.split(' || ');
assert.ok(criar.startsWith('(!data.exists()'), 'bookings: a primeira cláusula é a de criação');
assert.ok(criar.includes("newData.child('status').val() == 'pending'"), 'bookings: só nasce como pendente');
assert.ok(criar.includes("newData.child('id').val() == $id"), 'bookings: o id tem que ser a chave');
for (const campo of ['finalPrice', 'priceWithFee', 'paidAmount', 'paymentTransactionId', 'paymentConfirmedAt', 'pointsAwardedAt']) {
  assert.ok(criar.includes(`!newData.child('${campo}').exists()`), `bookings: não pode nascer com ${campo}`);
}
for (const campo of ['id', 'email', 'name', 'phone', 'price', 'finalPrice', 'priceWithFee', 'paidAmount', 'paymentTransactionId', 'paymentConfirmedAt', 'pointsAwardedAt']) {
  assert.ok(bk.includes(`newData.child('${campo}').val() == data.child('${campo}').val()`), `bookings: ${campo} não pode ser alterado por visitante`);
}
assert.ok(!/newData\.child\('status'\)\.val\(\) == '(confirmed|approved|completed)'/.test(bk), 'bookings: visitante não se promove de estado');

// ── Lista de espera ───────────────────────────────────────────────────────
assert.ok(soAdmin(regras.waitlist['.read']) && soAdmin(regras.waitlist['.write']), 'waitlist: raiz só para admin');
assert.ok(regras.waitlist.$id['.write'].startsWith('!data.exists() && newData.exists()'), 'waitlist: visitante só cria');
assert.strictEqual(regras.waitlist.$id['.read'], undefined, 'waitlist: visitante não lê entradas');

// ── Avaliações ────────────────────────────────────────────────────────────
assert.ok(regras.feedback['.read'].includes("query.orderByChild == 'status' && query.equalTo == 'approved'"), 'feedback: público só consulta as aprovadas');
assert.ok(soAdmin(regras.feedback['.write']), 'feedback: raiz só para admin');
const fb = regras.feedback.$id['.write'];
assert.ok(fb.startsWith('!data.exists() && newData.exists()'), 'feedback: visitante só cria');
assert.ok(!fb.includes("'approved'"), 'feedback: visitante não publica sem moderação');
assert.ok(fb.includes(".val() >= 1") && fb.includes(".val() <= 5"), 'feedback: nota de 1 a 5');

// ── Cupons e gift cards ───────────────────────────────────────────────────
assert.ok(soAdmin(regras.coupons['.read']) && soAdmin(regras.coupons['.write']), 'coupons: lista e escrita só para admin');
assert.strictEqual(regras.coupons.$code['.write'], undefined, 'coupons: visitante não grava cupom');
assert.ok(soAdmin(regras.giftcards['.read']), 'giftcards: lista só para admin');
const gc = regras.giftcards.$code['.write'];
assert.ok(gc.includes("newData.child('status').val() == 'pending' && newData.child('balance').val() == 0"), 'giftcards: nasce pendente e sem saldo');
assert.ok(gc.includes("newData.child('balance').val() <= data.child('balance').val()"), 'giftcards: saldo só diminui');
assert.ok(gc.includes("newData.child('amount').val() == data.child('amount').val()"), 'giftcards: valor de face não muda');

// ── Nós internos: só admin ────────────────────────────────────────────────
for (const no of ['clientNotes', 'clientLinks', 'clientLinkDismissals', 'clientOverrides', 'stock', 'stockRecipes', 'adminPushTokens', 'aiUsage', 'aiLogs', 'aiRateLimit', 'driveImports', 'referrals']) {
  assert.ok(soAdmin(regras[no]['.read']) && soAdmin(regras[no]['.write']), `${no}: só admin`);
}

console.log('regras do banco (guarda estático): travas presentes — todos passaram');
