'use strict';

// Regras do banco (database.rules.json) testadas no EMULADOR do Firebase.
//
// Por que existe: uma regra errada tem dois jeitos de dar prejuízo — abrir o
// que devia estar fechado, ou fechar o que o cliente usa (e aí ninguém consegue
// agendar). Ler a regra não basta para ter certeza; aqui cada caso é executado
// no mesmo motor de regras do Firebase, rodando na própria máquina.
//
// NÃO toca no banco de produção: fala só com 127.0.0.1. Diferente do
// scripts/test-giftcard-rules.sh, que escreve na base real.
//
// Fica FORA do `npm test` de propósito: precisa de Java e do firebase-tools
// (centenas de MB), e o projeto não carrega dependência por causa de um teste.
// Rode à mão sempre que mexer em database.rules.json, ANTES de publicar:
//
//   npx firebase-tools@13 emulators:exec --only database --project demo-spcc \
//     "node scripts/regras-emulador.js"
//
// O `npm test` tem um guarda mais simples (scripts/test-regras-banco.js) que
// reprova se alguma destas travas sumir do arquivo.

const assert = require('assert');

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const NS = 'demo-spcc-default-rtdb';
const url = (caminho, consulta = '') => `http://${HOST}/${caminho}.json?ns=${NS}${consulta}`;

async function req(metodo, caminho, corpo, { admin = false, consulta = '' } = {}) {
  const r = await fetch(url(caminho, consulta), {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados = null;
  try { dados = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, dados };
}
const visitante = (m, c, b, o) => req(m, c, b, o);
const admin = (m, c, b, o) => req(m, c, b, { ...o, admin: true });

// LISTAR=1 não para na primeira falha: lista todas. Serve para comparar um
// arquivo de regras antigo com o novo ("o que estava aberto?").
const LISTAR = process.env.LISTAR === '1';
const falhas = [];
let casos = 0;
function conferir(ok, mensagem) {
  if (ok) return;
  if (!LISTAR) assert.fail(mensagem);
  falhas.push(mensagem);
}
async function permite(rotulo, p) { casos++; const r = await p; conferir(r.status === 200, `DEVIA PERMITIR: ${rotulo} (veio HTTP ${r.status})`); return r; }
async function nega(rotulo, p) { casos++; const r = await p; conferir(r.status === 401 || r.status === 403, `DEVIA NEGAR: ${rotulo} (veio HTTP ${r.status})`); return r; }

// O agendamento exatamente como o site grava (app.js, envio do formulário).
const pedido = (id, extra = {}) => ({
  id, services: ['lavagem'], service: 'lavagem', carSize: 'pq', vehicleType: 'carro', bodyType: '',
  date: '2026-12-01', pickup: '2026-12-01', price: 100,
  name: 'Cliente de Teste', email: 'cliente@exemplo.invalid', phone: '11900000000',
  car: 'Carro de Teste', plate: 'TST0A00', bairro: 'Centro', cep: '00000000', obs: '',
  status: 'pending', submittedAt: '2026-11-10T12:00:00.000Z', adminNotes: '', ...extra,
});

(async () => {
  await admin('PUT', '', null); // base limpa

  // ── Agendamentos ────────────────────────────────────────────────────────
  await permite('visitante cria pedido pendente, como o site faz', visitante('PUT', 'bookings/SPC-LEGITIMO01', pedido('SPC-LEGITIMO01')));
  await nega('criar pedido já confirmado', visitante('PUT', 'bookings/SPC-ATAQUE0001', pedido('SPC-ATAQUE0001', { status: 'confirmed' })));
  await nega('criar pedido já aprovado', visitante('PUT', 'bookings/SPC-ATAQUE0002', pedido('SPC-ATAQUE0002', { status: 'approved' })));
  await nega('criar pedido já concluído', visitante('PUT', 'bookings/SPC-ATAQUE0003', pedido('SPC-ATAQUE0003', { status: 'completed' })));
  for (const campo of ['finalPrice', 'priceWithFee', 'paidAmount', 'paymentTransactionId', 'paymentConfirmedAt', 'pointsAwardedAt']) {
    await nega(`criar pedido trazendo ${campo}`, visitante('PUT', `bookings/SPC-CAMPO-${campo}`, pedido(`SPC-CAMPO-${campo}`, { [campo]: campo.includes('At') || campo.includes('Id') ? 'x' : 1 })));
  }
  await nega('criar pedido com id diferente da chave', visitante('PUT', 'bookings/SPC-ATAQUE0005', pedido('SPC-OUTRO00001')));
  await nega('visitante lê um agendamento', visitante('GET', 'bookings/SPC-LEGITIMO01'));
  await nega('visitante lista os agendamentos', visitante('GET', 'bookings'));

  // A admin aprova (pelo servidor, que ignora regras) e o cliente segue podendo cancelar.
  await admin('PATCH', 'bookings/SPC-LEGITIMO01', { status: 'approved', finalPrice: 120, priceWithFee: 124 });
  await nega('visitante se promove a confirmado', visitante('PATCH', 'bookings/SPC-LEGITIMO01', { status: 'confirmed' }));
  await nega('visitante muda o preço', visitante('PATCH', 'bookings/SPC-LEGITIMO01', { price: 1 }));
  await nega('visitante muda o preço final', visitante('PATCH', 'bookings/SPC-LEGITIMO01', { finalPrice: 1 }));
  await nega('visitante marca pagamento', visitante('PATCH', 'bookings/SPC-LEGITIMO01', { paidAmount: 124 }));
  await nega('visitante marca pontos como já creditados (ou apaga a marca)', visitante('PATCH', 'bookings/SPC-LEGITIMO01', { pointsAwardedAt: '2026-01-01' }));
  await nega('visitante apaga o agendamento', visitante('DELETE', 'bookings/SPC-LEGITIMO01'));
  await permite('cancelamento pelo cliente continua funcionando', visitante('PATCH', 'bookings/SPC-LEGITIMO01', { status: 'cancelled' }));

  // ── Lista de espera ─────────────────────────────────────────────────────
  const espera = { id: 'WL-TESTE1', name: 'Cliente de Teste', email: '', phone: '11900000000', date: '2026-12-01', createdAt: '2026-11-10T12:00:00.000Z' };
  await permite('visitante entra na lista de espera, como o site faz', visitante('PUT', 'waitlist/WL-TESTE1', espera));
  await nega('apagar a lista de espera inteira', visitante('DELETE', 'waitlist'));
  await nega('substituir a lista de espera inteira', visitante('PUT', 'waitlist', { x: 1 }));
  await nega('sobrescrever a entrada de outra pessoa', visitante('PUT', 'waitlist/WL-TESTE1', { ...espera, name: 'Outro' }));
  await nega('apagar a entrada de outra pessoa', visitante('DELETE', 'waitlist/WL-TESTE1'));
  await nega('ler a lista de espera (nomes e telefones)', visitante('GET', 'waitlist'));
  await nega('entrada sem nome', visitante('PUT', 'waitlist/WL-TESTE2', { id: 'WL-TESTE2', phone: '1', date: '2026-12-01' }));
  await nega('entrada com nome gigante', visitante('PUT', 'waitlist/WL-TESTE3', { ...espera, id: 'WL-TESTE3', name: 'x'.repeat(5000) }));
  await nega('entrada com id diferente da chave', visitante('PUT', 'waitlist/WL-TESTE4', espera));
  conferir(((await admin('GET', 'waitlist/WL-TESTE1')).dados || {}).name === 'Cliente de Teste', 'a entrada original da lista de espera ficou intacta');

  // ── Avaliações ──────────────────────────────────────────────────────────
  const aval = (extra = {}) => ({ bookingId: 'SPC-LEGITIMO01', rating: 5, comment: 'Ótimo', clientName: 'Cliente de Teste', service: 'Lavagem', date: '2026-11-10', submittedAt: '2026-11-10T12:00:00.000Z', status: 'pending_review', ...extra });
  await permite('cliente envia avaliação boa (vai para moderação)', visitante('PUT', 'feedback/SPC-LEGITIMO01', aval()));
  await permite('cliente envia avaliação ruim (fica interna)', visitante('PUT', 'feedback/SPC-LEGITIMO02', aval({ rating: 2, status: 'internal' })));
  await nega('publicar a própria avaliação sem moderação', visitante('PUT', 'feedback/SPC-ATAQUE0001', aval({ status: 'approved' })));
  await nega('sobrescrever avaliação existente', visitante('PUT', 'feedback/SPC-LEGITIMO01', aval({ comment: 'trocado' })));
  await nega('aprovar avaliação existente', visitante('PATCH', 'feedback/SPC-LEGITIMO01', { status: 'approved' }));
  await nega('apagar avaliação', visitante('DELETE', 'feedback/SPC-LEGITIMO01'));
  await nega('nota fora de 1 a 5', visitante('PUT', 'feedback/SPC-ATAQUE0002', aval({ rating: 9 })));
  await nega('comentário gigante', visitante('PUT', 'feedback/SPC-ATAQUE0003', aval({ comment: 'x'.repeat(5000) })));
  await nega('listar todas as avaliações (inclusive as internas)', visitante('GET', 'feedback'));
  await permite('ler a própria avaliação pelo código', visitante('GET', 'feedback/SPC-LEGITIMO01'));
  await admin('PATCH', 'feedback/SPC-LEGITIMO01', { status: 'approved' }); // moderação pela admin
  const publicas = await permite('o site lê só as aprovadas, como faz hoje', visitante('GET', 'feedback', undefined, { consulta: '&orderBy=%22status%22&equalTo=%22approved%22' }));
  conferir(JSON.stringify(Object.keys(publicas.dados || {})) === '["SPC-LEGITIMO01"]', 'a consulta pública devolve só a aprovada');
  await nega('consulta pública pedindo as internas', visitante('GET', 'feedback', undefined, { consulta: '&orderBy=%22status%22&equalTo=%22internal%22' }));

  // ── Cupons ──────────────────────────────────────────────────────────────
  await admin('PUT', 'coupons/TESTE10', { code: 'TESTE10', discountType: 'percent', discountValue: 10, used: false });
  await permite('quem tem o código consulta o cupom', visitante('GET', 'coupons/TESTE10'));
  await nega('listar todos os cupons', visitante('GET', 'coupons'));
  await nega('visitante cria cupom', visitante('PUT', 'coupons/GRATIS100', { code: 'GRATIS100', discountType: 'percent', discountValue: 100, used: false }));
  await nega('visitante altera cupom', visitante('PATCH', 'coupons/TESTE10', { discountValue: 100 }));

  // ── Gift card (regras que já existiam; aqui só travadas) ────────────────
  const gift = (extra = {}) => ({ code: 'GIFT-TESTE00001', amount: 100, balance: 0, status: 'pending', ...extra });
  await permite('visitante cria gift card pendente, sem saldo', visitante('PUT', 'giftcards/GIFT-TESTE00001', gift()));
  await nega('criar gift card já ativo', visitante('PUT', 'giftcards/GIFT-ATAQUE0001', gift({ code: 'GIFT-ATAQUE0001', status: 'active', balance: 100 })));
  await nega('criar gift card pendente com saldo', visitante('PUT', 'giftcards/GIFT-ATAQUE0002', gift({ code: 'GIFT-ATAQUE0002', balance: 100 })));
  await nega('ativar o próprio gift card', visitante('PATCH', 'giftcards/GIFT-TESTE00001', { status: 'active', balance: 100 }));
  await admin('PATCH', 'giftcards/GIFT-TESTE00001', { status: 'active', balance: 100 }); // o webhook ativa
  await permite('usar parte do saldo', visitante('PATCH', 'giftcards/GIFT-TESTE00001', { balance: 40 }));
  await nega('aumentar o saldo', visitante('PATCH', 'giftcards/GIFT-TESTE00001', { balance: 100 }));
  await nega('saldo negativo', visitante('PATCH', 'giftcards/GIFT-TESTE00001', { balance: -5 }));
  await nega('mudar o valor de face', visitante('PATCH', 'giftcards/GIFT-TESTE00001', { amount: 1000 }));
  await nega('listar todos os gift cards', visitante('GET', 'giftcards'));

  // ── Nós administrativos: fechados para visitante ────────────────────────
  for (const no of ['clientProfiles', 'clientNotes', 'stock', 'stockRecipes', 'referrals', 'aiConfig', 'aiUsage', 'aiLogs', 'driveImports', 'adminPushTokens']) {
    await nega(`visitante lê ${no}`, visitante('GET', no));
    await nega(`visitante grava em ${no}`, visitante('PUT', `${no}/x`, { a: 1 }));
  }
  for (const no of ['services', 'combos', 'config', 'gallery', 'portfolio', 'blocked', 'dayLoad']) {
    await permite(`visitante lê ${no} (vitrine pública)`, visitante('GET', no));
    await nega(`visitante grava em ${no}`, visitante('PUT', `${no}/x`, { a: 1 }));
  }

  if (falhas.length) {
    console.log(`regras do banco no emulador: ${falhas.length} falha(s) em ${casos} casos`);
    falhas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`regras do banco no emulador: ${casos} casos — todos passaram`);
})().catch((err) => { console.error(String(err.message || err)); process.exit(1); });
