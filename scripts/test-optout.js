'use strict';

// Testa o descadastro de e-mails de marketing
// (functions/lib/core/optout.js) e a resolução de configuração dos agentes
// (functions/lib/core/config.js → resolverConfig).
//
// Rodar: node scripts/test-optout.js
//
// Por que existe: "tem que ter uma funcionalidade do cliente se descadastrar,
// caso não queira mais receber e-mails de marketing". Um descadastro que falha
// é pior que não ter: o cliente clica, acha que saiu, e continua recebendo.

const assert = require('assert');
const optout = require('../functions/lib/core/optout.js');
const { resolverConfig } = require('../functions/lib/core/config.js');

const SEGREDO = 'segredo-de-teste';

// ── normalização: o mesmo endereço escrito de jeitos diferentes é um só ──
assert.strictEqual(optout.normaliza('  Ana@Exemplo.COM '), 'ana@exemplo.com');
assert.strictEqual(optout.normaliza(null), '');
assert.strictEqual(optout.chaveDe('Ana@Exemplo.com'), optout.chaveDe('ana@exemplo.com'),
  'maiúscula não pode gerar dois cadastros do mesmo cliente');

// A chave é segura para caminho do Firebase: e-mail tem ponto, e ponto é
// proibido em chave do Realtime Database.
const chave = optout.chaveDe('ana@exemplo.com');
assert.ok(/^[0-9a-f]{32}$/.test(chave), 'chave hexadecimal de 32: ' + chave);
assert.ok(!/[.#$/[\]]/.test(chave), 'sem caractere proibido em chave');

// ── token do link ──────────────────────────────────────────────────────
const tok = optout.tokenDe('ana@exemplo.com', SEGREDO);
assert.ok(tok.length === 22, 'token de 22 caracteres: ' + tok);
assert.ok(optout.tokenConfere('ana@exemplo.com', tok, SEGREDO));
assert.ok(optout.tokenConfere('ANA@exemplo.com', tok, SEGREDO), 'confere com maiúscula');

// O que o token precisa impedir: descadastrar o endereço dos outros, e usar a
// página como oráculo de "este e-mail está na base?".
assert.ok(!optout.tokenConfere('outro@exemplo.com', tok, SEGREDO), 'token não vale para outro e-mail');
assert.ok(!optout.tokenConfere('ana@exemplo.com', 'xxxxxxxxxxxxxxxxxxxxxx', SEGREDO), 'token errado');
assert.ok(!optout.tokenConfere('ana@exemplo.com', tok + 'a', SEGREDO), 'token mais longo');
assert.ok(!optout.tokenConfere('ana@exemplo.com', '', SEGREDO), 'token vazio');
assert.ok(!optout.tokenConfere('ana@exemplo.com', tok, 'outro-segredo'), 'segredo diferente não valida');
assert.notStrictEqual(optout.tokenDe('ana@exemplo.com', SEGREDO),
                      optout.tokenDe('bia@exemplo.com', SEGREDO), 'tokens diferentes por e-mail');
// Sem segredo configurado nada é validado — melhor recusar do que aceitar tudo.
assert.strictEqual(optout.tokenDe('ana@exemplo.com', ''), '');
assert.ok(!optout.tokenConfere('ana@exemplo.com', '', ''), 'sem segredo, nada confere');

// O segredo do banco não pode aparecer no token (a chave do HMAC é derivada).
assert.ok(!tok.includes(SEGREDO.slice(0, 8)), 'o token não carrega o segredo');

// ── link e rodapé ──────────────────────────────────────────────────────
const link = optout.linkDescadastro('ana@exemplo.com', SEGREDO, 'https://site.com/');
assert.ok(link.startsWith('https://site.com/api/unsubscribe?e='), 'sem barra dupla: ' + link);
assert.ok(link.includes('e=ana%40exemplo.com'), 'e-mail escapado na URL');
assert.ok(link.includes('t=' + encodeURIComponent(tok)));
const rodape = optout.rodapeDescadastro('ana@exemplo.com', SEGREDO, 'https://site.com');
assert.ok(rodape.includes(link), 'o rodapé leva o link');
assert.match(rodape, /Cancele aqui/, 'e diz o que é: ' + rodape);
assert.ok(!rodape.includes("' +"), 'sem sobra de concatenação no texto');

// ── quem pode receber marketing ────────────────────────────────────────
const HOJE = new Date('2026-11-13T12:00:00Z');
const diasAtras = n => new Date(HOJE.getTime() - n * 86400000).toISOString();
const saiu = new Set(['saiu@exemplo.com']);

const pode = (email, envios, dias) =>
  optout.podeReceber(email, { descadastrados: saiu, envios: envios || {}, intervaloDias: dias ?? 90, agora: HOJE });

assert.strictEqual(pode('nova@exemplo.com'), true, 'cliente novo recebe');
assert.strictEqual(pode('saiu@exemplo.com'), false, 'quem se descadastrou NÃO recebe');
assert.strictEqual(pode('SAIU@Exemplo.com'), false, 'nem escrito diferente');
assert.strictEqual(pode('', {}), false, 'e-mail vazio');
assert.strictEqual(pode('semarroba', {}), false, 'endereço inválido');

// Intervalo mínimo: é o que separa reativação de spam.
assert.strictEqual(pode('ana@exemplo.com', { 'ana@exemplo.com': diasAtras(10) }), false,
  'recebeu há 10 dias, não recebe de novo');
assert.strictEqual(pode('ana@exemplo.com', { 'ana@exemplo.com': diasAtras(95) }), true,
  'passou o intervalo, pode');
assert.strictEqual(pode('ana@exemplo.com', { 'ana@exemplo.com': diasAtras(90) }), true,
  'exatamente no intervalo, pode');
assert.strictEqual(pode('ana@exemplo.com', { 'ana@exemplo.com': 'data-corrompida' }), true,
  'registro corrompido não bloqueia o cliente para sempre');
// Descadastro vence o intervalo: mesmo nunca tendo recebido, quem saiu não entra.
assert.strictEqual(pode('saiu@exemplo.com', {}), false);

// ── configuração dos agentes ───────────────────────────────────────────
const BASE = { monthlyBudgetCalls: 60, maxTokens: 1024, schedule: 'weekly:tue:08', name: 'Reativação' };

// O defeito que isto corrige: `getAgentConfig` lia só o banco e devolvia null
// sem registro, e tanto o cron quanto o HTTP tratam null como desligado — ou
// seja, agente sem linha em /aiConfig NUNCA rodava, e os DEFAULTS do código
// não eram padrão nenhum.
const semRegistro = resolverConfig(BASE, null, '2026-11');
assert.strictEqual(semRegistro.enabled, true, 'sem registro no banco, vale o padrão do código');
assert.strictEqual(semRegistro.schedule, 'weekly:tue:08', 'e o horário vem do código');
assert.strictEqual(resolverConfig(undefined, null, '2026-11'), null, 'agente inexistente segue nulo');

// O banco sobrepõe o código.
assert.strictEqual(resolverConfig(BASE, { monthlyBudgetCalls: 5 }, '2026-11').monthlyBudgetCalls, 5);

// Desligado NA MÃO continua desligado — é uma escolha, não um acidente.
assert.strictEqual(resolverConfig(BASE, { enabled: false }, '2026-11').enabled, false);

// Desligado pelo ORÇAMENTO vence com o mês: o orçamento é mensal e zera
// sozinho na virada; a flag não zerava, e o agente ficava morto para sempre.
const travadoAgora = resolverConfig(BASE, { enabled: false, disabledReason: 'budget', disabledMonth: '2026-11' }, '2026-11');
assert.strictEqual(travadoAgora.enabled, false, 'no mês em que estourou, segue desligado');

const mesVirou = resolverConfig(BASE, { enabled: false, disabledReason: 'budget', disabledMonth: '2026-10' }, '2026-11');
assert.strictEqual(mesVirou.enabled, true, 'virou o mês, o agente volta sozinho');
assert.strictEqual(mesVirou.disabledReason, null);

// Registro antigo, de antes de existir `disabledMonth`: o mês do updatedAt serve.
const antigo = resolverConfig(BASE, { enabled: false, disabledReason: 'budget', updatedAt: '2026-09-14T10:00:00Z' }, '2026-11');
assert.strictEqual(antigo.enabled, true, 'registro legado também é solto na virada');

console.log('descadastro de marketing e configuração dos agentes — todos passaram');
