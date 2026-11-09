'use strict';

// Teste de navegador: o custo do serviço sai dos insumos, não da digitação.
//
// Por que existe: o formulário de serviço tinha um campo "Custo (R$)" digitado à
// mão, enquanto a tela de Estoque calculava o MESMO número a partir das receitas.
// Dois números para a mesma coisa, e a margem exibida nos cards saía do digitado.
// Pior: a receita só existia para os serviços que já vinham prontos, e não havia
// tela nenhuma para criar outra — serviço novo nascia sem uso cadastrado e sem
// como cadastrar. Agora o uso é cadastrado junto com o serviço e o custo vem dele.
//
// Como rodar:
//   npx serve . -l 8099
//   node scripts/test-servico-insumos.js

const { chromium } = require('playwright');
const assert = require('assert');

const INSUMOS = {
  'shampoo-ph': { name: 'Shampoo pH Neutro', unit: 'ml', costPerUnit: 0.03 },
  'cera-corte': { name: 'Cera para Corte',   unit: 'ml', costPerUnit: 0.48 },
  'mo':         { name: 'Mão de Obra',       unit: 'h',  costPerUnit: 35 },
};

(async () => {
  const nav = await chromium.launch();
  const pg = await (await nav.newContext()).newPage();
  const erros = [];
  pg.on('pageerror', e => erros.push(e.message));
  await pg.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }));
  await pg.route('https://cognito-idp.*.amazonaws.com/**',
    r => r.fulfill({ status:200, contentType:'application/x-amz-json-1.1', body:'{}' }));

  try {
    await pg.goto('http://localhost:8099/', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.openServiceForm === 'function');
    // O formulário monta dentro de #svcFormWrap, que só existe quando a tela de
    // Serviços do painel é desenhada — e o painel exige login. O teste fornece o
    // ponto de montagem, visível, que é tudo o que openServiceForm procura.
    await pg.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'svcFormWrap';
      document.body.prepend(d);
    });

    const ler = () => pg.evaluate(() => ({
      pq: document.getElementById('sfCostPq').value,
      gr: document.getElementById('sfCostGr').value,
      travado: document.getElementById('sfCostPq').readOnly,
      auto: document.getElementById('sfCostAuto').checked,
      nota: document.getElementById('sfCostNota').textContent,
      linhas: document.querySelectorAll('[id^="recRow"]').length,
      receita: window._getRecipeRows(),
    }));

    // ── serviço NOVO: hoje nasceria sem receita e sem como cadastrar ────
    await pg.evaluate(() => window.openServiceForm());
    await pg.waitForSelector('#sfRecipeList', { state: 'attached' });
    let r = await ler();
    assert.strictEqual(r.linhas, 0, 'serviço novo começa sem insumos');
    assert.strictEqual(r.auto, false, 'sem insumos, o custo é o digitado');
    assert.match(r.nota, /Cadastre os insumos/, 'a tela diz o que fazer: ' + r.nota);
    // E existe como cadastrar — que é o que não existia.
    await pg.click('button:has-text("+ Adicionar insumo")');
    assert.strictEqual((await ler()).linhas, 1, 'dá para acrescentar insumo');

    // ── serviço COM receita salva: abre calculando ──────────────────────
    await pg.evaluate((ins) => {
      window.openServiceForm();
      window._sfPreencheReceita({ 'shampoo-ph': { pq: 300, gr: 450 } }, ins);
    }, INSUMOS);
    await pg.waitForFunction(() => document.querySelectorAll('[id^="recRow"]').length === 1);
    r = await ler();
    assert.strictEqual(r.auto, true, 'serviço com receita abre calculando');
    assert.strictEqual(parseFloat(r.pq), 9,    '300 ml × R$0,03 = R$9,00: ' + r.pq);
    assert.strictEqual(parseFloat(r.gr), 13.5, '450 ml × R$0,03 = R$13,50: ' + r.gr);
    assert.strictEqual(r.travado, true, 'campo calculado não aceita digitação');
    assert.ok(r.nota.includes('9,00') && r.nota.includes('13,50'), 'a nota mostra os dois: ' + r.nota);

    // ── acrescentar mão de obra entra na conta ──────────────────────────
    await pg.evaluate(() => window.addRecipeRow('mo', 1, 2));
    r = await ler();
    assert.strictEqual(parseFloat(r.pq), 44,   '9 + 35 = 44: ' + r.pq);
    assert.strictEqual(parseFloat(r.gr), 83.5, '13,50 + 70 = 83,50: ' + r.gr);
    // A unidade aparece ao lado da quantidade — "1" sem unidade é adivinhação.
    const unidades = await pg.$$eval('[id^="sfRecUn"]', es => es.map(e => e.textContent));
    assert.ok(unidades.includes('ml') && unidades.includes('h'), 'unidades à mostra: ' + unidades);

    // ── mexer na quantidade recalcula na hora ───────────────────────────
    await pg.fill('#sfRecPq0', '600');
    r = await ler();
    assert.strictEqual(parseFloat(r.pq), 53, '600 ml × 0,03 + 35 = 53: ' + r.pq);

    // ── tirar um insumo tira da conta E da receita salva ────────────────
    await pg.evaluate(() => window.removeRecipeRow(1));
    r = await ler();
    assert.strictEqual(parseFloat(r.pq), 18, 'sem a mão de obra: ' + r.pq);
    assert.deepStrictEqual(Object.keys(r.receita), ['shampoo-ph'], 'a receita acompanha');

    // ── linha sem insumo escolhido não vira registro ────────────────────
    await pg.evaluate(() => window.addRecipeRow());
    r = await ler();
    assert.strictEqual(r.linhas, 2, 'a linha existe na tela');
    assert.deepStrictEqual(Object.keys(r.receita), ['shampoo-ph'], 'mas não vira receita');

    // ── o mesmo insumo em duas linhas soma, não se apaga ────────────────
    await pg.evaluate(() => window.addRecipeRow('cera-corte', 10, 10));
    await pg.evaluate(() => window.addRecipeRow('cera-corte', 5, 5));
    r = await ler();
    assert.strictEqual(r.receita['cera-corte'].pq, 15, 'as duas linhas somam: '
      + JSON.stringify(r.receita['cera-corte']));
    assert.strictEqual(parseFloat(r.pq), Math.round((600 * 0.03 + 15 * 0.48) * 100) / 100,
      'e o custo reflete a soma: ' + r.pq);

    // ── a saída manual continua existindo e é respeitada ────────────────
    await pg.uncheck('#sfCostAuto');
    r = await ler();
    assert.strictEqual(r.travado, false, 'o modo manual libera os campos');
    await pg.fill('#sfCostPq', '99');
    await pg.fill('#sfRecPq0', '700');   // mexer na receita não atropela
    r = await ler();
    assert.strictEqual(parseFloat(r.pq), 99, 'o valor digitado permanece: ' + r.pq);
    assert.match(r.nota, /Custo digitado à mão/, 'e a tela diz isso: ' + r.nota);

    assert.deepStrictEqual(erros, [], 'console sem erro: ' + erros.join(' | '));
    console.log('serviço: o custo vem dos insumos cadastrados — todos passaram');
  } catch (e) {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await nav.close();
  }
})();
