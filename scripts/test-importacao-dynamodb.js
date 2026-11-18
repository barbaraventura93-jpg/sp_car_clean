'use strict';

// Testa o mapeamento Firebase → DynamoDB (scripts/importar-para-dynamodb.js).
//
// Rodar: node scripts/test-importacao-dynamodb.js
//
// Por que existe: o Firebase foi excluído em 10/11/2026 e o backup de 09/11 é
// a ÚNICA cópia dos dados. Uma importação que erra o mapeamento não dá erro —
// ela grava no lugar errado, ou descarta em silêncio, e a perda só aparece
// quando alguém vai procurar o dado. Aqui as regras do mapeamento são travadas
// uma por uma. Nada de rede: tudo em memória.

const assert = require('assert');
const imp = require('./importar-para-dynamodb.js');
const mapa = require('../functions/lib/core/chaves.js');

// ── a trava mais importante: nó desconhecido ABORTA ───────────────────
assert.throws(
  () => imp.converter({ services: {}, umNoNovoQueNinguemMapeou: { a: 1 } }),
  /sem mapeamento.*umNoNovoQueNinguemMapeou/s,
  'nó sem mapeamento tem que abortar a importação, não ser ignorado'
);

// ── catálogo ──────────────────────────────────────────────────────────
const cat = imp.converter({
  services: { 'lavagem-detalhada': { name: 'Lavagem', active: true } },
  combos: { 'promo-x': { name: 'Promo' } },
  portfolio: { '-OyPt': { url: 'a.jpg' } },
  gallery: { '-Ouxv': { beforeUrl: 'b.jpg' } },
});
const chaves = cat.itens.map((i) => `${i.pk}|${i.sk}`).sort();
assert.deepStrictEqual(chaves, [
  'CATALOG|COMBO#promo-x',
  'CATALOG|GALLERY#-Ouxv',
  'CATALOG|PORTFOLIO#-OyPt',
  'CATALOG|SERVICE#lavagem-detalhada',
]);

// `config` são campos planos, não coleção: tem que virar UM item, senão cada
// campo (dropoffTime, maxPerDay…) viraria um registro solto.
const cfg = imp.converter({ config: { dropoffTime: '08:00', maxPerDay: 3, location: { rua: 'x' } } });
assert.strictEqual(cfg.itens.length, 1, 'config é um item só');
assert.strictEqual(cfg.itens[0].sk, 'CONFIG');
assert.deepStrictEqual(cfg.itens[0].valor.maxPerDay, 3);

// ── disponibilidade: particionada por ano ─────────────────────────────
const av = imp.converter({
  blocked: { '2026-05-10': true, '2027-01-02': true },
  dayLoad: { '2026-11-05': 1 },
});
const avChaves = av.itens.filter((i) => i.no !== '_meta').map((i) => `${i.pk}|${i.sk}`).sort();
assert.deepStrictEqual(avChaves, [
  'AVAIL#2026|BLOCKED#2026-05-10',
  'AVAIL#2026|LOAD#2026-11-05',
  'AVAIL#2027|BLOCKED#2027-01-02',
]);
// O valor escalar precisa sobreviver: `blocked` é `true`, não um objeto.
assert.strictEqual(av.itens.find((i) => i.sk === 'BLOCKED#2026-05-10').valor, true);
assert.strictEqual(av.itens.find((i) => i.sk === 'LOAD#2026-11-05').valor, 1);

// ── agendamento: índices do mês e do e-mail ───────────────────────────
const bk = imp.converter({
  bookings: {
    'SPC-ABC123': { date: '2026-11-18', email: '  Ana@Exemplo.COM ', price: 150 },
    'SPC-SEMDATA': { email: 'bia@x.com' },
  },
});
const abc = bk.itens.find((i) => i.sk === 'SPC-ABC123');
assert.strictEqual(abc.pk, 'BOOKING');
assert.strictEqual(abc.extra.gsi1pk, 'BOOKING#2026-11', 'GSI1 responde "agendamentos do mês"');
assert.strictEqual(abc.extra.gsi1sk, '2026-11-18#SPC-ABC123');
assert.strictEqual(abc.extra.gsi2pk, 'EMAIL#ana@exemplo.com', 'e-mail canônico: minúsculo e sem espaço');

// Agendamento sem data não pode sumir do índice do cliente — é o histórico
// dele que depende disso quando se recadastrar.
const semData = bk.itens.find((i) => i.sk === 'SPC-SEMDATA');
assert.strictEqual(semData.extra.gsi2pk, 'EMAIL#bia@x.com');
assert.ok(!('gsi1pk' in semData.extra), 'sem data não entra no índice do mês');

// ── cliente: dois níveis e perfil ─────────────────────────────────────
const cl = imp.converter({
  bookingIndex: { uid1: { 'SPC-1': true, 'SPC-2': true }, uid2: { 'SPC-3': true } },
  clientProfiles: { uid1: { email: 'Ana@Exemplo.com', name: 'Ana' } },
});
assert.deepStrictEqual(cl.itens.map((i) => `${i.pk}|${i.sk}`).sort(), [
  'CLIENT#uid1|BOOKING#SPC-1',
  'CLIENT#uid1|BOOKING#SPC-2',
  'CLIENT#uid1|PROFILE',
  'CLIENT#uid2|BOOKING#SPC-3',
]);
assert.strictEqual(cl.porNo.bookingIndex.origem, 3, 'conta os netos, não os pais');
assert.strictEqual(cl.itens.find((i) => i.sk === 'PROFILE').extra.gsi2pk, 'EMAIL#ana@exemplo.com');

// ── IA: expiração nos efêmeros, nada nos permanentes ─────────────────
const ia = imp.converter({
  aiConfig: { relatorio: { enabled: true } },
  aiUsage: { '2026-11': { relatorio: { calls: 1 } } },
  aiLogs: { '-OxNj': { agentId: 'relatorio', at: '2026-11-09T11:00:00Z' } },
  aiRateLimit: { '2026110812_187_10_9_4': 1 },
});
const log = ia.itens.find((i) => i.sk.startsWith('LOG#'));
// A chave é `LOG#<id>`, não `LOG#<data>#<id>`: o id de push do Firebase já
// ordena por tempo, e com a data na chave o `sk` deixava de ser derivável do
// id — apagar um log pelo id não achava nada (falha silenciosa).
assert.strictEqual(log.sk, 'LOG#-OxNj');
assert.strictEqual(mapa.chaveDoSk('aiLogs', log.sk), '-OxNj', 'a volta tem que dar o id');
assert.ok(log.extra.expiresAt > Math.floor(Date.now() / 1000), 'log expira no futuro');
const rate = ia.itens.find((i) => i.sk.startsWith('RATE#'));
assert.ok(rate.extra.expiresAt > 0, 'rate-limit expira');
const conf = ia.itens.find((i) => i.sk === 'CONFIG#relatorio');
assert.strictEqual(conf.extra, undefined, 'configuração de agente NÃO pode expirar');
const uso = ia.itens.find((i) => i.sk === 'USAGE#2026-11');
assert.strictEqual(uso.extra, undefined, 'histórico de consumo NÃO pode expirar');

// ── token de push: encurtado na chave, inteiro no valor ───────────────
const tok = 'cGbPVMqdQFk9-UwuoGvujv:APA91bHF' + 'x'.repeat(120);
const push = imp.converter({ adminPushTokens: { [tok]: { createdAt: 1 } } });
assert.ok(/^PUSHTOKEN#[0-9a-f]{12}$/.test(push.itens[0].sk), 'chave curta: ' + push.itens[0].sk);
assert.strictEqual(push.itens[0].extra.token, tok, 'o token inteiro tem que ficar guardado');

// ── conversão de tipos para o DynamoDB ───────────────────────────────
assert.deepStrictEqual(imp.paraAttr(true), { BOOL: true });
assert.deepStrictEqual(imp.paraAttr(7), { N: '7' });
assert.deepStrictEqual(imp.paraAttr(0), { N: '0' }, 'zero não é ausência');
assert.deepStrictEqual(imp.paraAttr(null), { NULL: true });
assert.deepStrictEqual(imp.paraAttr(''), { S: '' }, 'string vazia fica vazia — virar espaço alteraria o dado');
assert.deepStrictEqual(imp.paraAttr([1, 'a']), { L: [{ N: '1' }, { S: 'a' }] });
assert.deepStrictEqual(imp.paraAttr({ a: { b: 1 } }), { M: { a: { M: { b: { N: '1' } } } } });

// Item final: chave vazia é barrada antes de ir para a tabela.
assert.throws(() => imp.itemFinal({ pk: 'X', sk: '', valor: 1, no: 'x' }), /string vazia/);
const final = imp.itemFinal({ pk: 'BOOKING', sk: 'SPC-1', valor: { price: 150 }, no: 'bookings' });
assert.deepStrictEqual(final.PutRequest.Item.pk, { S: 'BOOKING' });
assert.deepStrictEqual(final.PutRequest.Item.dados, { M: { price: { N: '150' } } });
assert.deepStrictEqual(final.PutRequest.Item.no, { S: 'bookings' });

// ── nó vazio ou ausente não gera item nem quebra ─────────────────────
assert.deepStrictEqual(imp.converter({ services: null, combos: {} }).itens, []);

// ── item-índice dos anos ──────────────────────────────────────────────
// Sem ele a leitura de `blocked` inteiro não sabe quais partições existem.
const comAnos = imp.converter({ blocked: { '2026-01-01': true, '2031-05-05': true } });
const meta = comAnos.itens.find((i) => i.pk === mapa.META_ANOS.pk);
assert.ok(meta, 'a conversão tem que gerar o item-índice dos anos');
assert.deepStrictEqual(meta.valor, ['2026', '2031']);
assert.strictEqual(meta.sk, 'YEARS');

console.log('importação para o DynamoDB: mapeamento, índices, expiração, tipos e a trava de nó desconhecido — todos passaram');
