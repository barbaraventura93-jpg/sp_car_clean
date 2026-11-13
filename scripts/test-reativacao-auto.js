'use strict';

// Testa o envio AUTOMÁTICO da reativação de inativos
// (functions/lib/agents/reativacao.js).
//
// Rodar: node scripts/test-reativacao-auto.js
//
// Por que existe: este é o único agente que manda e-mail em nome da dona sem
// ninguém revisar ("se ele enviasse automaticamente os e-mails num padrão
// seria melhor, mas tem que ter uma funcionalidade do cliente se
// descadastrar"). Um erro aqui não quebra tela: manda e-mail errado, para a
// pessoa errada, ou manda demais — e só se descobre pela reclamação. As quatro
// travas que precisam valer sempre:
//
//   1. quem se descadastrou NÃO recebe
//   2. ninguém recebe dois marketings dentro do intervalo mínimo
//   3. no máximo MAX_AUTO e-mails por execução
//   4. todo e-mail enviado leva link de descadastro VÁLIDO
//
// Sem rede: Claude, EmailJS, Telegram e Firebase são dublês em memória.

const assert = require('assert');
const optout = require('../functions/lib/core/optout.js');

const SEGREDO = 'segredo-de-teste';
const SITE = 'https://exemplo.test';

process.env.FIREBASE_DATABASE_SECRET = SEGREDO;
process.env.EMAILJS_SERVICE_ID = 'svc';
process.env.EMAILJS_PUBLIC_KEY = 'pub';
process.env.URL = SITE;

const agente = require('../functions/lib/agents/reativacao.js');

const HOJE = '2026-11-13T12:00:00.000Z';
const diasAtras = (n) => new Date(Date.parse(HOJE) - n * 86400000).toISOString().slice(0, 10);

// ── 1. seleção de inativos (função pura) ──────────────────────────────

const bookings = {
  b1: { email: 'ana@x.com',  name: 'Ana Souza',  status: 'completed', date: diasAtras(200), service: 'lavagem', car: 'Civic' },
  b2: { email: 'ana@x.com',  name: 'Ana Souza',  status: 'completed', date: diasAtras(120), service: 'polimento', car: 'Civic' },
  b3: { email: 'bia@x.com',  name: 'Bia Lima',   status: 'confirmed', startDate: diasAtras(95), service: 'lavagem' },
  b4: { email: 'caio@x.com', name: 'Caio',       status: 'completed', date: diasAtras(10), service: 'lavagem' },
  b5: { email: 'duda@x.com', name: 'Duda',       status: 'cancelled', date: diasAtras(300), service: 'lavagem' },
  b6: { email: '',           name: 'Sem e-mail', status: 'completed', date: diasAtras(400) },
  b7: { email: 'elo@x.com',  name: 'Elo',        status: 'completed', service: 'lavagem' }, // sem data
};
const svcMap = { lavagem: { name: 'Lavagem Premium' }, polimento: { name: 'Polimento' } };

const sel = agente.selecionarInativos({ bookings, svcMap, agora: HOJE });
assert.deepStrictEqual(sel.map((c) => c.email), ['ana@x.com', 'bia@x.com'],
  'só inativos de 90+ dias, um por e-mail, do mais frio para o menos frio');

// A última visita manda: Ana tem agendamento de 200 e de 120 dias — vale 120.
assert.strictEqual(sel[0].dias, 120, 'dias contam da ÚLTIMA visita, não da primeira');
assert.strictEqual(sel[0].lastServiceName, 'Polimento', 'último serviço vem do agendamento mais recente');

// O que não pode entrar: cancelado (duda), ativo recente (caio), sem e-mail,
// sem data. Cada um por um motivo diferente.
for (const fora of ['duda@x.com', 'caio@x.com', 'elo@x.com']) {
  assert.ok(!sel.some((c) => c.email === fora), `${fora} não podia entrar na seleção`);
}

// Fronteira exata: 89 dias fica fora, 90 entra. O erro clássico aqui é o `>`
// no lugar do `>=`, que silenciosamente nunca pega quem está no limite.
const umSo = (dias) => agente.selecionarInativos({
  bookings: { x: { email: 'z@x.com', status: 'completed', date: diasAtras(dias) } },
  svcMap, agora: HOJE,
}).length;
assert.strictEqual(umSo(89), 0, '89 dias ainda não é inativo');
assert.strictEqual(umSo(90), 1, '90 dias já é inativo');

// ── dublês ────────────────────────────────────────────────────────────

function fakeCore({ optOut = {}, sent = {}, falharEmail = null } = {}) {
  const escritas = [];
  const enviados = [];
  const telegramas = [];
  const dados = {
    '/services': svcMap,
    '/config': { businessName: 'SP Car Clean' },
    '/bookings': bookings,
    '/marketingOptOut': optOut,
    '/marketingSent': sent,
  };
  return {
    escritas, enviados, telegramas,
    core: {
      firebase: {
        async dbGet(p) { return dados[p] ?? null; },
        async dbSet(p, v) { escritas.push({ path: p, value: v }); },
      },
      claude: {
        async complete() { return { text: 'Corpo gerado pela IA.', inputTokens: 10, outputTokens: 20 }; },
      },
      email: {
        async sendEmail({ templateId, params }) {
          if (falharEmail && params.to_email === falharEmail) throw new Error('EmailJS 400');
          enviados.push({ templateId, params });
          return 'OK';
        },
      },
      telegram: { async sendTelegram(t) { telegramas.push(t); } },
    },
  };
}

const chaveOptOut = (email) => ({ [optout.chaveDe(email)]: { email, at: HOJE } });

// ── 2. envio automático: quem recebe e o que vai no e-mail ────────────

(async () => {
  {
    const f = fakeCore();
    const r = await agente.run({}, f.core);

    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.enviados, 2, 'Ana e Bia recebem');
    assert.deepStrictEqual(f.enviados.map((e) => e.params.to_email), ['ana@x.com', 'bia@x.com']);

    // TRAVA 4: todo e-mail leva link de descadastro, e o token tem que CONFERIR
    // para aquele endereço. Link quebrado é pior que link ausente: o cliente
    // clica, vê "link inválido" e continua recebendo.
    for (const e of f.enviados) {
      const m = e.params.mensagem.match(/\/api\/unsubscribe\?e=([^&\s]+)&t=([^\s]+)/);
      assert.ok(m, `sem link de descadastro no e-mail de ${e.params.to_email}`);
      const email = decodeURIComponent(m[1]);
      assert.strictEqual(email, e.params.to_email, 'o link é do próprio destinatário');
      assert.ok(optout.tokenConfere(email, decodeURIComponent(m[2]), SEGREDO),
        `token do link não confere para ${email}`);
      assert.ok(e.params.mensagem.includes('Corpo gerado pela IA.'), 'o corpo da IA vai no e-mail');
      assert.ok(e.params.titulo.includes('SP Car Clean'), 'assunto com a marca');
    }

    // Cada envio é registrado — é o registro que sustenta a trava 2 na semana
    // seguinte. Sem ele o intervalo mínimo não existe na prática.
    const registros = f.escritas.filter((w) => w.path.startsWith('/marketingSent/'));
    assert.strictEqual(registros.length, 2, 'um registro de envio por e-mail');
    assert.deepStrictEqual(registros.map((w) => w.value.email).sort(), ['ana@x.com', 'bia@x.com']);
    assert.ok(f.telegramas.length === 1, 'a dona é avisada do que saiu em nome dela');
  }

  // ── TRAVA 1: descadastrado não recebe ───────────────────────────────
  {
    const f = fakeCore({ optOut: chaveOptOut('ana@x.com') });
    const r = await agente.run({}, f.core);
    assert.strictEqual(r.enviados, 1);
    assert.deepStrictEqual(f.enviados.map((e) => e.params.to_email), ['bia@x.com'],
      'quem se descadastrou não pode receber');
    assert.ok(!f.escritas.some((w) => String(w.value?.email) === 'ana@x.com'),
      'nem registro de envio para quem saiu');
  }

  // Maiúscula/espaço no cadastro não pode furar o descadastro.
  {
    const f = fakeCore({ optOut: chaveOptOut('  ANA@X.com ') });
    const r = await agente.run({}, f.core);
    assert.strictEqual(r.enviados, 1, 'descadastro vale independente de caixa/espaço');
    assert.deepStrictEqual(f.enviados.map((e) => e.params.to_email), ['bia@x.com']);
  }

  // ── TRAVA 2: intervalo mínimo entre marketings ──────────────────────
  {
    const recente = new Date(Date.parse(HOJE) - 30 * 86400000).toISOString();
    const f = fakeCore({ sent: { [optout.chaveDe('ana@x.com')]: { email: 'ana@x.com', at: recente } } });
    const r = await agente.run({}, f.core);
    assert.deepStrictEqual(f.enviados.map((e) => e.params.to_email), ['bia@x.com'],
      'quem recebeu marketing há 30 dias não recebe de novo (intervalo de 90)');
    assert.strictEqual(r.candidatos, 2, 'ela segue sendo candidata — só não é a vez dela');
  }
  {
    const antigo = new Date(Date.parse(HOJE) - 200 * 86400000).toISOString();
    const f = fakeCore({ sent: { [optout.chaveDe('ana@x.com')]: { email: 'ana@x.com', at: antigo } } });
    await agente.run({}, f.core);
    assert.strictEqual(f.enviados.length, 2, 'passado o intervalo, volta a poder receber');
  }

  // ── TRAVA 3: teto por execução ──────────────────────────────────────
  {
    const muitos = {};
    for (let i = 0; i < 30; i++) {
      muitos[`b${i}`] = { email: `c${i}@x.com`, name: `C${i}`, status: 'completed', date: diasAtras(100 + i) };
    }
    const f = fakeCore();
    f.core.firebase.dbGet = async (p) => (p === '/bookings' ? muitos
      : p === '/services' ? svcMap
      : p === '/config' ? { businessName: 'SP Car Clean' } : null);
    const r = await agente.run({}, f.core);
    assert.strictEqual(f.enviados.length, agente.MAX_AUTO,
      `no máximo ${agente.MAX_AUTO} e-mails por execução`);
    assert.strictEqual(r.candidatos, 30, 'o resumo diz quantos ficaram na fila');
    // Os mais frios primeiro: c29 tem 129 dias, é o primeiro da fila.
    assert.strictEqual(f.enviados[0].params.to_email, 'c29@x.com');
  }

  // ── falha isolada: um e-mail que erra não derruba o lote ────────────
  {
    const f = fakeCore({ falharEmail: 'ana@x.com' });
    const r = await agente.run({}, f.core);
    assert.strictEqual(r.ok, true, 'o lote continua');
    assert.deepStrictEqual(f.enviados.map((e) => e.params.to_email), ['bia@x.com']);
    assert.strictEqual(r.erros.length, 1);
    // Quem falhou NÃO é registrado: assim volta para a fila na semana seguinte.
    assert.ok(!f.escritas.some((w) => w.value?.email === 'ana@x.com'),
      'e-mail que falhou não pode ficar marcado como enviado');
  }

  // ── sem segredo não há link de descadastro: não envia nada ──────────
  {
    const salvo = process.env.FIREBASE_DATABASE_SECRET;
    delete process.env.FIREBASE_DATABASE_SECRET;
    const f = fakeCore();
    const r = await agente.run({}, f.core);
    process.env.FIREBASE_DATABASE_SECRET = salvo;
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.enviados.length, 0,
      'marketing sem link de saída é exatamente o que não pode acontecer');
    assert.ok(/descadastro/.test(r.summary), 'o motivo tem que estar no resumo: ' + r.summary);
  }

  // ── sem EmailJS: não finge que enviou ───────────────────────────────
  {
    const salvo = process.env.EMAILJS_SERVICE_ID;
    delete process.env.EMAILJS_SERVICE_ID;
    const f = fakeCore();
    const r = await agente.run({}, f.core);
    process.env.EMAILJS_SERVICE_ID = salvo;
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.enviados.length, 0);
  }

  // ── 3. modo manual segue funcionando, e também respeita o descadastro ──
  {
    const f = fakeCore({ optOut: chaveOptOut('ana@x.com') });
    const r = await agente.run({
      clients: [
        { email: 'ana@x.com', name: 'Ana', lastService: 'lavagem', lastDate: diasAtras(120) },
        { email: 'bia@x.com', name: 'Bia', lastService: 'lavagem', lastDate: diasAtras(95) },
      ],
    }, f.core);

    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.drafts.map((d) => d.email), ['bia@x.com'],
      'o painel não pode nem exibir rascunho de quem se descadastrou');
    assert.strictEqual(r.pulados, 1);
    assert.strictEqual(f.enviados.length, 0, 'modo manual NÃO envia — só gera texto');
    assert.ok(/descadastrados/.test(r.summary), 'o resumo avisa que alguém ficou fora');
  }

  console.log('reativação automática: descadastro, intervalo, teto, link válido, falha isolada e modo manual — todos passaram');
})().catch((e) => { console.error(e); process.exit(1); });
