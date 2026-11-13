'use strict';

// /api/create-referral — o "Indique um Amigo".
//
// Por que existe: a função manda e-mail em nome da SP Car Clean e cria um
// cupom de desconto. A revisão de 09/11/2026 (achado S-09) encontrou-a sem
// checagem de origem e sem limite, mandando e-mail a um endereço escolhido por
// quem chamava (`adminEmail` no corpo), aceitando texto livre no nome, e
// devolvendo o código do cupom na resposta — o que deixava qualquer pessoa
// gerar um cupom para si.
//
// Sem rede: `fetch` é um dublê do banco e do serviço de e-mail. Nenhum e-mail
// sai daqui, e os endereços são inventados (.invalid).

const assert = require('assert');
const path = require('path');

process.env.FIREBASE_DATABASE_URL = 'https://banco.invalid';
process.env.FIREBASE_DATABASE_SECRET = 'segredo-de-teste';
process.env.EMAILJS_SERVICE_ID = 'servico';
process.env.EMAILJS_PUBLIC_KEY = 'publica';
process.env.ADMIN_EMAIL = 'admin@exemplo.invalid';

let emails, gravados, indicacoes;
global.fetch = async (url, opt = {}) => {
  if (url.startsWith('https://api.emailjs.com/')) {
    emails.push(JSON.parse(opt.body).template_params);
    return { ok: true, status: 200, text: async () => 'OK' };
  }
  if (url.startsWith('https://banco.invalid/')) {
    const chave = decodeURIComponent(url.slice('https://banco.invalid/'.length).split('.json')[0]);
    if (opt.method === 'PUT' || opt.method === 'POST') {
      gravados.push({ chave, corpo: JSON.parse(opt.body) });
      return { ok: true, status: 200, json: async () => ({ name: '-chave' }) };
    }
    return { ok: true, status: 200, json: async () => (chave === 'referrals' ? indicacoes : null) };
  }
  throw new Error('o teste não pode sair para a rede: ' + url);
};

const { handler, _interno } = require(path.resolve(__dirname, '../functions/create-referral.js'));
const { refCode, nomeValido, POR_HORA } = _interno;

const pedido = (extra = {}) => ({
  referrerName: 'Ana Teste', referrerEmail: 'ana@exemplo.invalid', referrerPhone: '11900000001',
  friendName: 'Bruno Teste', friendEmail: 'bruno@exemplo.invalid', friendPhone: '11900000002', ...extra,
});
let ip = 0;
async function chamar(corpo, { origem = 'https://www.spcarclean.com.br', mesmoIp = null, metodo = 'POST' } = {}) {
  emails = []; gravados = [];
  const r = await handler({
    httpMethod: metodo,
    headers: { origin: origem, 'x-forwarded-for': mesmoIp || `10.1.${Math.floor(++ip / 250)}.${ip % 250}` },
    body: JSON.stringify(corpo),
  });
  let json = {};
  try { json = JSON.parse(r.body); } catch { /* 405 responde texto */ }
  return { status: r.statusCode, ...json };
}

(async () => {
  indicacoes = null;

  // ── O caminho normal ────────────────────────────────────────────────────
  let r = await chamar(pedido());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.friendPct, 15);
  const cupom = gravados.find((g) => g.chave.startsWith('coupons/'));
  assert.ok(cupom, 'o cupom do amigo é criado');
  assert.strictEqual(cupom.corpo.clientEmail, 'bruno@exemplo.invalid', 'cupom nominal ao e-mail do amigo');
  assert.strictEqual(cupom.corpo.discountValue, 15);
  assert.strictEqual(cupom.corpo.used, false);
  assert.ok(gravados.some((g) => g.chave === 'referrals'), 'a indicação é registrada');

  // REGRESSÃO S-09: o código do cupom não volta na resposta.
  assert.strictEqual(r.friendCouponCode, undefined, 'a resposta não traz o código do cupom');
  assert.ok(!JSON.stringify(r).includes(cupom.corpo.code), 'nem em outro campo');
  assert.strictEqual(r.referralKey, undefined);
  // …mas chega por e-mail ao amigo.
  const paraAmigo = emails.find((e) => e.to_email === 'bruno@exemplo.invalid');
  assert.ok(paraAmigo && paraAmigo.mensagem.includes(cupom.corpo.code), 'o amigo recebe o código por e-mail');

  // REGRESSÃO S-09: o aviso interno vai para o e-mail do servidor, não para o do corpo.
  r = await chamar(pedido({ friendEmail: 'carla@exemplo.invalid', adminEmail: 'vitima@terceiro.invalid' }));
  assert.strictEqual(r.ok, true);
  assert.ok(!emails.some((e) => e.to_email === 'vitima@terceiro.invalid'), 'endereço vindo do corpo não recebe e-mail');
  assert.ok(emails.some((e) => e.to_email === 'admin@exemplo.invalid'), 'o aviso vai para o e-mail configurado no servidor');
  assert.deepStrictEqual(emails.map((e) => e.to_email).sort(), ['admin@exemplo.invalid', 'ana@exemplo.invalid', 'carla@exemplo.invalid']);

  // ── O que é recusado, sem gravar nem enviar nada ────────────────────────
  const recusa = async (corpo, erro, rotulo, opcoes) => {
    const x = await chamar(corpo, opcoes);
    assert.strictEqual(x.ok, false, `devia recusar: ${rotulo}`);
    if (erro) assert.strictEqual(x.error, erro, rotulo);
    assert.strictEqual(emails.length, 0, `recusado não envia e-mail: ${rotulo}`);
    assert.strictEqual(gravados.length, 0, `recusado não grava: ${rotulo}`);
  };
  await recusa(pedido({ friendName: '' }), 'missing-fields', 'sem nome do amigo');
  await recusa(pedido({ friendEmail: 'não-é-email' }), 'invalid-email', 'e-mail inválido');
  await recusa(pedido({ friendEmail: 'ana@exemplo.invalid' }), 'self-referral', 'indicar a si mesmo');
  await recusa(pedido({ friendEmail: 'ANA@exemplo.invalid' }), 'self-referral', 'indicar a si mesmo com maiúsculas');
  await recusa(pedido({ friendName: 'x'.repeat(81) }), 'missing-fields', 'nome longo demais');
  await recusa(pedido({ friendName: 'Ganhe um prêmio em http://golpe.invalid' }), 'missing-fields', 'link no nome do amigo');
  await recusa(pedido({ referrerName: 'Acesse www.golpe.invalid agora' }), 'missing-fields', 'link no nome de quem indica');
  await recusa(pedido({ friendName: 'Bruno\nAssunto: outro' }), 'missing-fields', 'quebra de linha no nome');
  await recusa(pedido({ friendName: '<b>Bruno</b>' }), 'missing-fields', 'marcação no nome');
  await recusa(pedido({ friendEmail: 'a'.repeat(120) + '@exemplo.invalid' }), 'invalid-email', 'e-mail longo demais');
  await recusa(pedido({ referrerEmail: 'torto' }), 'invalid-email', 'e-mail de quem indica inválido');
  await recusa(pedido(), 'origin-not-allowed', 'chamada vinda de outro site', { origem: 'https://outro-site.invalid' });
  assert.strictEqual((await chamar(pedido(), { metodo: 'GET' })).status, 405);

  // Amigo já indicado: não cria outro cupom.
  indicacoes = { a: { friendEmail: 'bruno@exemplo.invalid' } };
  await recusa(pedido(), 'already-referred', 'amigo já indicado');
  indicacoes = null;

  // ── Limite por IP ───────────────────────────────────────────────────────
  for (let i = 0; i < POR_HORA; i++) {
    assert.strictEqual((await chamar(pedido({ friendEmail: `amigo${i}@exemplo.invalid` }), { mesmoIp: '10.9.9.9' })).ok, true, `indicação ${i + 1} do mesmo IP passa`);
  }
  r = await chamar(pedido({ friendEmail: 'amigo-a-mais@exemplo.invalid' }), { mesmoIp: '10.9.9.9' });
  assert.strictEqual(r.status, 429, 'acima do limite por hora: recusado');
  assert.strictEqual(emails.length, 0);

  // ── Funções puras ───────────────────────────────────────────────────────
  const codigos = new Set(Array.from({ length: 500 }, () => refCode('AMIGO')));
  assert.strictEqual(codigos.size, 500, 'códigos não se repetem');
  for (const c of codigos) assert.match(c, /^AMIGO-[A-HJ-NP-Z2-9]{8}$/, 'formato do código');
  for (const bom of ['Ana', "Maria D'Ávila", 'José da Silva Jr.', 'João & Maria']) assert.ok(nomeValido(bom), `nome legítimo: ${bom}`);

  console.log('indicação: origem, limite, destinatários e cupom fora da resposta — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
