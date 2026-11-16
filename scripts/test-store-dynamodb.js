'use strict';

// Testa o acesso a dados no DynamoDB (functions/lib/core/store.js) e o
// mapeamento de chaves (functions/lib/core/chaves.js).
//
// Rodar: node scripts/test-store-dynamodb.js
//
// Por que existe: estes dois módulos substituem o Firebase embaixo de 18
// Lambdas e do painel. Uma chave montada errado não dá erro — grava num lugar
// e lê de outro, e o sintoma é "o dado sumiu". Aqui o transporte do DynamoDB é
// substituído por um dublê e cada chamada é conferida: operação, chave e
// expressão. Sem rede, sem AWS.

const assert = require('assert');
const chaves = require('../functions/lib/core/chaves.js');
const store = require('../functions/lib/core/store.js');

// ── dublê do transporte ───────────────────────────────────────────────
let chamadas = [];
let respostas = {};   // op -> resposta (ou função)

store._injetar(async (op, params) => {
  chamadas.push({ op, params });
  const r = respostas[op];
  return typeof r === 'function' ? r(params) : (r || {});
});

const reset = () => { chamadas = []; respostas = {}; };
const attrs = (o) => store.itemParaAttrs(o);

// ── mapeamento de caminhos ────────────────────────────────────────────

assert.deepStrictEqual(chaves.chaveDe('bookings/SPC-1'),
  { tipo: 'item', pk: 'BOOKING', sk: 'SPC-1', no: 'bookings', campo: null });
assert.deepStrictEqual(chaves.chaveDe('services'),
  { tipo: 'colecao', pk: 'CATALOG', prefixo: 'SERVICE#', no: 'services' });
assert.deepStrictEqual(chaves.chaveDe('blocked'),
  { tipo: 'anos', prefixo: 'BLOCKED#', no: 'blocked' });
assert.strictEqual(chaves.chaveDe('blocked/2026-05-10').pk, 'AVAIL#2026');
assert.strictEqual(chaves.chaveDe('config/maxPerDay').campo, 'maxPerDay');
assert.strictEqual(chaves.chaveDe('bookingIndex/uid1/SPC-1').pk, 'CLIENT#uid1');

// Nó desconhecido ABORTA: devolver algo aproximado gravaria no lugar errado.
assert.throws(() => chaves.chaveDe('naoExiste/1'), /desconhecido/);
assert.throws(() => chaves.chaveDe(''), /vazio/);
// `bookingIndex` é de dois níveis: ler a raiz varreria a tabela inteira.
assert.throws(() => chaves.chaveDe('bookingIndex'), /por pai/);

// Ida e volta: o `sk` tem que devolver exatamente a chave do Firebase, senão o
// nó remontado vem com as chaves erradas e o app não acha o registro.
for (const [caminho, chaveEsperada] of [
  ['services/lavagem-detalhada', 'lavagem-detalhada'],
  ['bookings/SPC-ABC', 'SPC-ABC'],
  ['stock/cera-corte', 'cera-corte'],
  ['aiConfig/relatorio', 'relatorio'],
  ['blocked/2026-05-10', '2026-05-10'],
  ['coupons/ANIV2026', 'ANIV2026'],
]) {
  const k = chaves.chaveDe(caminho);
  assert.strictEqual(chaves.chaveDoSk(k.no, k.sk), chaveEsperada, `ida e volta de ${caminho}`);
}

// ── dbGet ─────────────────────────────────────────────────────────────

(async () => {
  // item
  reset();
  respostas.GetItem = { Item: attrs({ pk: 'BOOKING', sk: 'SPC-1', no: 'bookings', dados: { price: 150, email: 'a@b.c' } }) };
  let v = await store.dbGet('/bookings/SPC-1');
  assert.deepStrictEqual(v, { price: 150, email: 'a@b.c' });
  assert.strictEqual(chamadas[0].op, 'GetItem');
  assert.deepStrictEqual(chamadas[0].params.Key, { pk: { S: 'BOOKING' }, sk: { S: 'SPC-1' } });

  // item inexistente → null (e não erro: o app trata null como "não tem")
  reset(); respostas.GetItem = {};
  assert.strictEqual(await store.dbGet('/bookings/NAOEXISTE'), null);

  // campo de dentro do item
  reset();
  respostas.GetItem = { Item: attrs({ dados: { maxPerDay: 3, dropoffTime: '08:00' } }) };
  assert.strictEqual(await store.dbGet('/config/maxPerDay'), 3);

  // coleção: remonta o nó como objeto, tirando o prefixo da chave
  reset();
  respostas.Query = {
    Items: [
      attrs({ pk: 'CATALOG', sk: 'SERVICE#lavagem', dados: { name: 'Lavagem' } }),
      attrs({ pk: 'CATALOG', sk: 'SERVICE#polimento', dados: { name: 'Polimento' } }),
    ],
  };
  v = await store.dbGet('/services');
  assert.deepStrictEqual(v, { lavagem: { name: 'Lavagem' }, polimento: { name: 'Polimento' } });
  assert.strictEqual(chamadas[0].params.KeyConditionExpression, 'pk = :pk AND begins_with(sk, :pre)');
  assert.deepStrictEqual(chamadas[0].params.ExpressionAttributeValues[':pre'], { S: 'SERVICE#' });

  // coleção vazia → null (igual ao Firebase, que não devolve objeto vazio)
  reset(); respostas.Query = { Items: [] };
  assert.strictEqual(await store.dbGet('/services'), null);

  // valor escalar sobrevive: `blocked/<data>` é `true`, não objeto
  reset();
  respostas.GetItem = { Item: attrs({ pk: 'AVAIL#2026', sk: 'BLOCKED#2026-05-10', dados: true }) };
  assert.strictEqual(await store.dbGet('/blocked/2026-05-10'), true);

  // nó espalhado por ano: lê o índice de anos e consulta cada partição
  reset();
  respostas.GetItem = { Item: attrs({ pk: 'AVAIL#META', sk: 'YEARS', dados: ['2026', '2027'] }) };
  respostas.Query = (p) => {
    const pk = p.ExpressionAttributeValues[':pk'].S;
    return { Items: [attrs({ pk, sk: `BLOCKED#${pk.slice(6)}-01-01`, dados: true })] };
  };
  v = await store.dbGet('/blocked');
  assert.deepStrictEqual(v, { '2026-01-01': true, '2027-01-01': true },
    'a leitura da raiz tem que juntar todos os anos');
  assert.strictEqual(chamadas.filter((c) => c.op === 'Query').length, 2, 'uma consulta por ano');

  // Paginação: 1 MB por página no DynamoDB. Ignorar `LastEvaluatedKey` seria
  // perder registro em silêncio — com 12 mil datas bloqueadas, acontece.
  reset();
  let pagina = 0;
  respostas.Query = () => (pagina++ === 0
    ? { Items: [attrs({ sk: 'SERVICE#a', dados: 1 })], LastEvaluatedKey: { pk: { S: 'CATALOG' }, sk: { S: 'SERVICE#a' } } }
    : { Items: [attrs({ sk: 'SERVICE#b', dados: 2 })] });
  v = await store.dbGet('/services');
  assert.deepStrictEqual(v, { a: 1, b: 2 }, 'as duas páginas tinham que entrar');

  // ── dbSet ───────────────────────────────────────────────────────────

  reset();
  await store.dbSet('/stock/cera-corte', { name: 'Cera', qty: 2 });
  assert.strictEqual(chamadas[0].op, 'PutItem');
  const it = chamadas[0].params.Item;
  assert.deepStrictEqual(it.pk, { S: 'STOCK' });
  assert.deepStrictEqual(it.sk, { S: 'ITEM#cera-corte' });
  assert.deepStrictEqual(it.no, { S: 'stock' });
  assert.deepStrictEqual(it.dados, { M: { name: { S: 'Cera' }, qty: { N: '2' } } });

  // Agendamento leva os índices: sem eles o GSI do mês e o histórico por
  // e-mail ficam vazios, e o histórico é o que sobrevive ao recadastro.
  reset();
  await store.dbSet('/bookings/SPC-9', { date: '2026-12-05', email: ' Ana@X.COM ' });
  const bk = chamadas[0].params.Item;
  assert.deepStrictEqual(bk.gsi1pk, { S: 'BOOKING#2026-12' });
  assert.deepStrictEqual(bk.gsi1sk, { S: '2026-12-05#SPC-9' });
  assert.deepStrictEqual(bk.gsi2pk, { S: 'EMAIL#ana@x.com' });

  // Ano novo em `blocked` tem que entrar no índice de anos, senão a leitura da
  // raiz nunca mais enxerga essa data.
  reset();
  respostas.GetItem = { Item: attrs({ dados: ['2026'] }) };
  await store.dbSet('/blocked/2031-07-04', true);
  const putMeta = chamadas.filter((c) => c.op === 'PutItem' && c.params.Item.pk.S === 'AVAIL#META');
  assert.strictEqual(putMeta.length, 1, 'o ano novo tinha que ser registrado no índice');
  assert.deepStrictEqual(putMeta[0].params.Item.dados, { L: [{ S: '2026' }, { S: '2031' }] });

  // Ano já conhecido não reescreve o índice.
  reset();
  respostas.GetItem = { Item: attrs({ dados: ['2026', '2031'] }) };
  await store.dbSet('/blocked/2031-08-08', true);
  assert.strictEqual(chamadas.filter((c) => c.op === 'PutItem' && c.params.Item.pk.S === 'AVAIL#META').length, 0);

  // Gravar o nó inteiro SUBSTITUI: o filho que não vem no valor novo tem que
  // ser apagado. Se ficasse, `set` viraria `patch` e registro apagado voltaria.
  reset();
  respostas.Query = { Items: [
    attrs({ pk: 'STOCK', sk: 'ITEM#velho' }),
    attrs({ pk: 'STOCK', sk: 'ITEM#fica' }),
  ] };
  await store.dbSet('/stock', { fica: { qty: 1 }, novo: { qty: 2 } });
  const lote = chamadas.find((c) => c.op === 'BatchWriteItem').params.RequestItems['sp-car-clean-data'];
  const apagados = lote.filter((x) => x.DeleteRequest).map((x) => x.DeleteRequest.Key.sk.S);
  const gravados = lote.filter((x) => x.PutRequest).map((x) => x.PutRequest.Item.sk.S);
  assert.deepStrictEqual(apagados, ['ITEM#velho'], 'o que saiu tem que ser apagado');
  assert.deepStrictEqual(gravados.sort(), ['ITEM#fica', 'ITEM#novo']);

  // ── dbPatch ─────────────────────────────────────────────────────────

  reset();
  await store.dbPatch('/aiConfig/relatorio', { enabled: false, updatedAt: 'x' });
  assert.strictEqual(chamadas[0].op, 'UpdateItem');
  assert.match(chamadas[0].params.UpdateExpression, /dados\.#c0 = :v0/);
  assert.match(chamadas[0].params.UpdateExpression, /dados\.#c1 = :v1/);
  assert.deepStrictEqual(chamadas[0].params.Key, { pk: { S: 'AI' }, sk: { S: 'CONFIG#relatorio' } });

  // Registro que ainda não existe: o DynamoDB recusa `dados.#c` sem `dados`.
  // O módulo tem que cair para gravação inteira em vez de propagar o erro —
  // é o caso do primeiro `aiConfig` de um agente novo.
  reset();
  let primeira = true;
  respostas.UpdateItem = () => {
    if (primeira) { primeira = false; const e = new Error('path not a document'); e.name = 'ValidationException'; throw e; }
    return {};
  };
  respostas.GetItem = {};
  await store.dbPatch('/aiConfig/novoAgente', { enabled: true });
  const put = chamadas.find((c) => c.op === 'PutItem');
  assert.ok(put, 'tinha que gravar o item inteiro depois da falha');
  assert.deepStrictEqual(put.params.Item.dados, { M: { enabled: { BOOL: true } } });

  // PATCH no nó mescla FILHOS e não apaga quem não veio.
  reset();
  await store.dbPatch('/stock', { a: { qty: 1 } });
  const loteP = chamadas.find((c) => c.op === 'BatchWriteItem').params.RequestItems['sp-car-clean-data'];
  assert.strictEqual(loteP.length, 1);
  assert.ok(loteP[0].PutRequest, 'patch de nó não apaga nada');

  // ── dbPush ──────────────────────────────────────────────────────────

  reset();
  const r = await store.dbPush('/feedback', { rating: 5 });
  assert.ok(/^[-0-9A-Za-z_]{20}$/.test(r.name), 'id no formato do Firebase: ' + r.name);
  assert.strictEqual(chamadas[0].params.Item.sk.S, r.name);
  assert.deepStrictEqual(chamadas[0].params.Item.no, { S: 'feedback' });

  // ── dbIncrement: atômico, com expiração ─────────────────────────────
  //
  // É o rate-limit por IP, compartilhado entre instâncias do Lambda. Se isto
  // fosse ler-somar-gravar, perderia contagem justo quando o volume sobe.
  reset();
  respostas.UpdateItem = { Attributes: attrs({ dados: 7 }) };
  const n = await store.dbIncrement('/aiRateLimit/2026111612_1_2_3_4');
  assert.strictEqual(n, 7, 'devolve o valor novo do contador');
  assert.match(chamadas[0].params.UpdateExpression, /ADD dados :d$/);
  assert.deepStrictEqual(chamadas[0].params.ExpressionAttributeValues[':d'], { N: '1' });
  assert.strictEqual(chamadas[0].params.ReturnValues, 'UPDATED_NEW');
  assert.deepStrictEqual(chamadas[0].params.Key,
    { pk: { S: 'AI' }, sk: { S: 'RATE#2026111612_1_2_3_4' } });
  // O contador tem que expirar sozinho: é o que dispensa a limpeza diária que
  // o ai-dispatcher fazia à mão.
  const expira = chamadas[0].params.ExpressionAttributeValues[':e0'];
  assert.ok(expira && Number(expira.N) > Math.floor(Date.now() / 1000), 'expiresAt no futuro');
  assert.match(chamadas[0].params.UpdateExpression, /#e0 = :e0/);

  reset();
  respostas.UpdateItem = { Attributes: attrs({ dados: 2 }) };
  await store.dbIncrement('/aiRateLimit/x', 5);
  assert.deepStrictEqual(chamadas[0].params.ExpressionAttributeValues[':d'], { N: '5' });

  // Contador é registro inteiro, não campo: incrementar um campo pediria outra
  // expressão, e aceitar em silêncio gravaria no lugar errado.
  await assert.rejects(() => store.dbIncrement('/config/maxPerDay'), /registro inteiro/);

  // ── dbDelete ────────────────────────────────────────────────────────

  reset();
  await store.dbDelete('/bookings/SPC-1');
  assert.strictEqual(chamadas[0].op, 'DeleteItem');
  assert.deepStrictEqual(chamadas[0].params.Key, { pk: { S: 'BOOKING' }, sk: { S: 'SPC-1' } });

  reset();
  await store.dbDelete('/config/dropoffTime');
  assert.strictEqual(chamadas[0].op, 'UpdateItem');
  // O módulo aliasa `dados` junto com o campo — o que importa é o mapa de
  // nomes apontar para o caminho certo dentro do registro.
  assert.match(chamadas[0].params.UpdateExpression, /^REMOVE #p0\.#p1$/);
  assert.deepStrictEqual(chamadas[0].params.ExpressionAttributeNames,
    { '#p0': 'dados', '#p1': 'dropoffTime' });

  // ── conversão de tipos ──────────────────────────────────────────────
  for (const v of [null, true, false, 0, -1.5, '', 'texto', [1, 'a', null], { a: { b: [true] } }]) {
    assert.deepStrictEqual(store.deAttr(store.paraAttr(v)), v, 'ida e volta de ' + JSON.stringify(v));
  }
  assert.throws(() => store.paraAttr(NaN), /não finito/);

  // ── clientProfiles: a chave vem da PARTIÇÃO, e a raiz é varredura ───
  //
  // O painel lê `clientProfiles` inteiro (app.js), e cada perfil mora na
  // partição do próprio cliente. Se a remontagem usasse o `sk` (sempre
  // 'PROFILE'), os dois clientes viriam com a mesma chave e um sobrescreveria
  // o outro — a lista de clientes mostraria uma pessoa só.
  reset();
  respostas.Scan = {
    Items: [
      attrs({ pk: 'CLIENT#uid1', sk: 'PROFILE', no: 'clientProfiles', dados: { name: 'Ana' } }),
      attrs({ pk: 'CLIENT#uid2', sk: 'PROFILE', no: 'clientProfiles', dados: { name: 'Bia' } }),
    ],
  };
  v = await store.dbGet('/clientProfiles');
  assert.deepStrictEqual(v, { uid1: { name: 'Ana' }, uid2: { name: 'Bia' } });
  assert.strictEqual(chamadas[0].op, 'Scan');
  assert.strictEqual(chamadas[0].params.FilterExpression, '#no = :no AND sk = :sk');

  // A varredura também pagina.
  reset();
  let pag = 0;
  respostas.Scan = () => (pag++ === 0
    ? { Items: [attrs({ pk: 'CLIENT#u1', sk: 'PROFILE', dados: 1 })], LastEvaluatedKey: { pk: { S: 'CLIENT#u1' }, sk: { S: 'PROFILE' } } }
    : { Items: [attrs({ pk: 'CLIENT#u2', sk: 'PROFILE', dados: 2 })] });
  assert.deepStrictEqual(await store.dbGet('/clientProfiles'), { u1: 1, u2: 2 });

  // Um perfil só continua sendo leitura direta, sem varredura.
  reset();
  respostas.GetItem = { Item: attrs({ pk: 'CLIENT#uid1', sk: 'PROFILE', dados: { name: 'Ana' } }) };
  assert.deepStrictEqual(await store.dbGet('/clientProfiles/uid1'), { name: 'Ana' });
  assert.strictEqual(chamadas[0].op, 'GetItem', 'perfil único não varre a tabela');

  console.log('store no DynamoDB: chaves, leitura, paginação, varredura de perfis, substituição, mescla, push, remoção e tipos — todos passaram');
})().catch((e) => { console.error(e); process.exit(1); });
