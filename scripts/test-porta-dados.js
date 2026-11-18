'use strict';

// Os dois níveis de acesso do /api/admin-data: admin e visitante.
//
// Rodar: node scripts/test-porta-dados.js
//
// POR QUE EXISTE: em 16/11/2026 este endpoint passou a aceitar requisição SEM
// token, porque o banco deixou de ser o Firebase e as regras do Realtime
// Database — que eram quem autorizava o visitante — não são aplicadas por
// ninguém no DynamoDB. Abrir uma porta que antes exigia admin é o tipo de
// mudança que precisa de teste no mesmo dia: a partir daqui, é este arquivo
// que garante que o visitante não lê a agenda, a base de clientes nem o
// estoque, e não mexe em dinheiro.
//
// Sem rede: Cognito, guarda e banco são dublês.

const assert = require('assert');
const path = require('path');

const R = (p) => path.resolve(__dirname, '..', p);

// ── dublês, instalados antes do require do endpoint ───────────────────
const guard = require(R('functions/lib/guard.js'));
guard.originAllowed = () => true;
guard.rateLimit = () => true;
guard.clientIp = () => '10.0.0.1';
guard.corsHeaders = () => ({});

let adminValido = false;
const auth = require(R('functions/lib/admin-auth.js'));
auth.verifyAdmin = async (t) => adminValido && t === 'token-admin';
auth.identificar = async () => ({ email: 'dona@exemplo.invalid', origem: 'cognito' });
auth.bearerToken = (ev) => {
  const h = (ev.headers || {}).Authorization || (ev.headers || {}).authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

let banco, escritas;
const store = require(R('functions/lib/core/store.js'));
const semBarra = (c) => String(c).replace(/^\/+/, '');
store.dbGet = async (c) => { const k = semBarra(c); return k in banco ? banco[k] : null; };
store.dbSet = async (c, v) => { escritas.push({ chave: semBarra(c), valor: v }); banco[semBarra(c)] = v; };
store.dbPatch = async (c, v) => {
  const k = semBarra(c);
  escritas.push({ chave: k, valor: v });
  banco[k] = { ...(banco[k] || {}), ...v };
};
store.dbDelete = async (c) => { escritas.push({ chave: semBarra(c), apagar: true }); };
// A criação do agendamento público é uma transação (pedido + cupom + gift card).
store.dbTransacao = async (lista) => {
  for (const e of lista) {
    escritas.push({ chave: e.caminho, valor: e.valor || e.campos });
    if (e.tipo === 'criar') banco[e.caminho] = e.valor;
  }
};

const { handler } = require(R('functions/admin-data.js'));

async function chamar(corpo, { token = null } = {}) {
  escritas = [];
  const r = await handler({
    httpMethod: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(corpo),
  });
  let json = {};
  try { json = JSON.parse(r.body); } catch { /* 405 etc. */ }
  return { status: r.statusCode, ...json };
}

const visitante = (corpo) => chamar(corpo);
const admin = (corpo) => chamar(corpo, { token: 'token-admin' });

(async () => {
  banco = {
    services: { lavagem: { name: 'Lavagem', pricing: { pq: { sale: 180 }, gr: { sale: 260 } } } },
    config: { maxPerDay: 3 },
    bookings: { 'SPC-1': { id: 'SPC-1', email: 'ana@x.com', price: 150, status: 'approved' } },
    'bookings/SPC-1': { id: 'SPC-1', email: 'ana@x.com', name: 'Ana', phone: '119', price: 150,
                        createdAt: '2026-11-01', status: 'approved' },
    stock: { cera: { qty: 2 } },
    clientProfiles: { uid1: { email: 'ana@x.com' } },
    feedback: {
      f1: { status: 'approved', rating: 5, comment: 'ótimo' },
      f2: { status: 'pending_review', rating: 1, comment: 'texto que ainda não foi moderado' },
    },
  };

  // ── visitante: o catálogo abre ──────────────────────────────────────
  let r = await visitante({ op: 'ler', caminho: 'services' });
  assert.strictEqual(r.status, 200, 'o site precisa do catálogo para montar a página');
  assert.deepStrictEqual(r.dados, banco.services);
  assert.strictEqual((await visitante({ op: 'ler', caminho: 'config' })).status, 200);

  // ── visitante: a base do negócio NÃO abre ───────────────────────────
  for (const caminho of ['bookings', 'stock', 'clientProfiles', 'aiConfig', 'coupons',
                         'giftcards', 'referrals', 'clientNotes', 'aiLogs']) {
    const resp = await visitante({ op: 'ler', caminho });
    assert.strictEqual(resp.status, 403, `visitante não pode listar ${caminho}`);
    assert.ok(!('dados' in resp), `${caminho}: nem um pedaço do dado pode voltar`);
  }

  // Um agendamento específico também não: o código é curto e adivinhável, e
  // quem prova ser dono usa /api/booking-status (que exige código + e-mail).
  assert.strictEqual((await visitante({ op: 'ler', caminho: 'bookings/SPC-1' })).status, 403);

  // ── visitante: avaliação só com o filtro, e filtrada no SERVIDOR ────
  assert.strictEqual((await visitante({ op: 'ler', caminho: 'feedback' })).status, 403,
    'sem filtro, não');
  r = await visitante({ op: 'ler', caminho: 'feedback', consulta: { ordem: 'status', igual: 'approved' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(r.dados), ['f1'], 'só a aprovada');
  const bruto = JSON.stringify(r);
  assert.ok(!bruto.includes('ainda não foi moderado'),
    'a avaliação pendente não pode nem chegar ao navegador — chegar já é vazar');

  // Filtro que não é o de aprovadas não serve para abrir o nó.
  assert.strictEqual((await visitante({
    op: 'ler', caminho: 'feedback', consulta: { ordem: 'status', igual: 'pending_review' },
  })).status, 403);

  // ── visitante: cria o próprio agendamento ───────────────────────────
  const pedido = { id: 'SPC-NOVO', status: 'pending', name: 'Bia', email: 'bia@x.com',
                   phone: '11988888888', date: '2026-12-20', services: ['lavagem'], carSize: 'pq',
                   price: 200 };
  r = await visitante({ op: 'gravar', caminho: 'bookings/SPC-NOVO', dados: pedido });
  assert.strictEqual(r.status, 200, 'agendar é o que o site precisa fazer');
  assert.strictEqual(escritas.length, 1);
  // O preço é o do catálogo (180), não o que veio no corpo (200).
  assert.strictEqual(banco['bookings/SPC-NOVO'].price, 180, 'o servidor decide o preço');
  assert.strictEqual(r.dados.price, 180, 'e devolve ao site o valor que gravou');

  // ── visitante: dinheiro é intocável ─────────────────────────────────
  for (const campo of ['paidAmount', 'finalPrice', 'paymentConfirmedAt', 'pointsAwardedAt']) {
    r = await visitante({ op: 'gravar', caminho: 'bookings/SPC-2', dados: { ...pedido, id: 'SPC-2', [campo]: 999 } });
    assert.strictEqual(r.status, 403, `não pode criar agendamento com ${campo}`);
    assert.strictEqual(escritas.length, 0, `${campo}: não pode ter gravado nada`);
  }

  // ── visitante: mesclar é validado pelo RESULTADO, não pelo pedaço ───
  //
  // É aqui que mora o erro fácil: olhar só `{status:'cancelled'}` e aprovar,
  // sem conferir o resto do registro.
  r = await visitante({ op: 'mesclar', caminho: 'bookings/SPC-1', dados: { status: 'cancelled' } });
  assert.strictEqual(r.status, 200, 'cancelar o próprio agendamento vale');

  r = await visitante({ op: 'mesclar', caminho: 'bookings/SPC-1', dados: { price: 1 } });
  assert.strictEqual(r.status, 403, 'baixar o preço pelo mesclar não vale');
  assert.strictEqual(escritas.length, 0);

  r = await visitante({ op: 'mesclar', caminho: 'bookings/SPC-1', dados: { status: 'completed' } });
  assert.strictEqual(r.status, 403, 'promover a concluído não vale');

  // ── visitante: não escreve catálogo e não apaga ─────────────────────
  for (const caminho of ['services/lavagem', 'config/maxPerDay', 'stock/cera', 'coupons/X']) {
    assert.strictEqual((await visitante({ op: 'gravar', caminho, dados: { x: 1 } })).status, 403,
      `visitante não grava em ${caminho}`);
  }
  assert.strictEqual((await visitante({ op: 'apagar', caminho: 'bookings/SPC-1' })).status, 403);
  assert.strictEqual((await visitante({ op: 'apagar', caminho: 'feedback/f1' })).status, 403);

  // ── token inválido não vira admin ───────────────────────────────────
  adminValido = false;
  assert.strictEqual((await chamar({ op: 'ler', caminho: 'bookings' }, { token: 'token-admin' })).status, 403,
    'token que o Cognito não reconhece cai no nível do visitante');

  // ── admin: o nível de sempre continua ───────────────────────────────
  adminValido = true;
  assert.strictEqual((await admin({ op: 'ler', caminho: 'bookings' })).status, 200);
  assert.strictEqual((await admin({ op: 'ler', caminho: 'stock' })).status, 200);
  r = await admin({ op: 'gravar', caminho: 'services/lavagem', dados: { name: 'Nova' } });
  assert.strictEqual(r.status, 200, 'admin grava no catálogo');
  // E o filtro do visitante não se aplica ao admin: a moderação precisa ver a
  // avaliação pendente.
  r = await admin({ op: 'ler', caminho: 'feedback', consulta: { ordem: 'status', igual: 'approved' } });
  assert.deepStrictEqual(Object.keys(r.dados).sort(), ['f1', 'f2'],
    'admin recebe tudo; quem filtra a tela dele é o navegador');

  // ── consulta malformada é recusada, não ignorada ────────────────────
  for (const c of [{ ordem: 123 }, { ordem: 'status', extra: 1 }, 'texto', [], { ordem: 'x'.repeat(61) }]) {
    assert.strictEqual((await visitante({ op: 'ler', caminho: 'feedback', consulta: c })).status, 400,
      'consulta inválida: ' + JSON.stringify(c));
  }

  // ── caminho fora da lista continua barrado nos dois níveis ──────────
  for (const caminho of ['naoExiste', 'config/adminPassword', '../etc', 'bookings/a/b/c/d/e']) {
    assert.ok([400, 403].includes((await visitante({ op: 'ler', caminho })).status), 'visitante: ' + caminho);
    assert.ok([400, 403].includes((await admin({ op: 'ler', caminho })).status), 'admin: ' + caminho);
  }

  console.log('porta dos dados: catálogo aberto, base fechada, dinheiro intocável, filtro no servidor e nível admin intacto — todos passaram');
})().catch((e) => { console.error(e); process.exit(1); });
