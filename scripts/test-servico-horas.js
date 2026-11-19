'use strict';

// Teste de navegador: horas de serviço no lugar da mão de obra como insumo.
//
// Por que existe: o pedido (18/11/2026) foi "mão de obra não deve estar no
// estoque pois não é estocável"; o serviço passa a ter HORAS de serviço, o
// prazo sai delas (8 h por dia útil) e o custo da hora fica num campo à parte
// na tela de Estoque. Verifica:
//   - horas → prazo que o cliente vê, com a conta à vista;
//   - serviço antigo (mão de obra na receita) migra sem mudar o prazo;
//   - salvar grava horas, espera, prazo, custo com mão de obra e receita SEM
//     a mão de obra;
//   - salvar o custo da hora recalcula o custo gravado dos serviços.
//
// Como rodar:
//   npx serve . -l 8099
//   node scripts/test-servico-horas.js

const { chromium } = require('playwright');
const assert = require('assert');

const INSUMOS = {
  'cera-corte': { name: 'Cera para Corte', unit: 'g',  costPerUnit: 0.48 },
  'mo':         { name: 'Mão de Obra',     unit: 'h',  costPerUnit: 35 },
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
    await pg.waitForFunction(() => typeof window.prazoDoServico === 'function' && typeof window.openServiceForm === 'function');
    await pg.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'svcFormWrap';
      document.body.prepend(d);
      _valorHora = 30;
      _custosRef = null;   // sem banco: carregarValorHora mantém os R$ 30
    });

    // ── serviço novo: horas → prazo ──────────────────────────────────────
    await pg.evaluate(() => openServiceForm(null));
    await pg.fill('#sfHorasPq', '11');
    await pg.fill('#sfHorasGr', '11');
    let nota = await pg.textContent('#sfDaysNota');
    assert.ok(nota.includes('2 dias de trabalho'), '11 h ÷ 8 h = 2 dias: ' + nota);
    assert.ok(nota.includes('Retirada no dia seguinte'), 'o cliente vê dia seguinte: ' + nota);
    await pg.fill('#sfHorasPq', '6');
    await pg.fill('#sfHorasGr', '8');
    nota = await pg.textContent('#sfDaysNota');
    assert.ok(nota.includes('Entrega no mesmo dia'), 'até 8 h, mesmo dia: ' + nota);
    await pg.fill('#sfEspera', '1');
    nota = await pg.textContent('#sfDaysNota');
    assert.ok(nota.includes('+ 1 de espera') && nota.includes('Retirada no dia seguinte'), 'espera soma: ' + nota);
    const custo = await pg.evaluate(() => [document.getElementById('sfCostPq').value, document.getElementById('sfCostGr').value,
      document.getElementById('sfCostNota').textContent]);
    assert.strictEqual(parseFloat(custo[0]), 180, '6 h × 30: ' + custo[0]);
    assert.strictEqual(parseFloat(custo[1]), 240, '8 h × 30: ' + custo[1]);
    assert.ok(custo[2].includes('mão de obra'), 'a nota diz de onde vem: ' + custo[2]);

    // ── serviço antigo: a mão de obra estava na receita ─────────────────
    await pg.evaluate(() => {
      SVCS['polimento-cristal'] = { name: 'Polimento & Cristalização', icon: '💎', cat: 'Estética Externa',
        veiculo: 'carro', pq: 600, gr: 1300, daysExtra: 2, desc: '', active: true, faqs: [],
        _cost_pq: 0, _cost_gr: 0, horas: null, diasEspera: null };
    });
    await pg.evaluate((ins) => {
      openServiceForm('polimento-cristal');
      _sfPreencheReceita({ 'cera-corte': { pq: 30, gr: 50 }, 'mo': { pq: 7, gr: 11 } }, ins);
    }, INSUMOS);
    const mig = await pg.evaluate(() => ({
      hp: document.getElementById('sfHorasPq').value, hg: document.getElementById('sfHorasGr').value,
      esp: document.getElementById('sfEspera').value, linhas: document.querySelectorAll('[id^="recRow"]').length,
      receita: _getRecipeRows(), nota: document.getElementById('sfDaysNota').textContent,
      pq: document.getElementById('sfCostPq').value,
    }));
    assert.strictEqual(mig.hp, '7', 'horas do pequeno vieram da receita');
    assert.strictEqual(mig.hg, '11', 'horas do grande vieram da receita');
    assert.deepStrictEqual(Object.keys(mig.receita), ['cera-corte'], 'a mão de obra saiu dos insumos');
    assert.strictEqual(mig.linhas, 1, 'só uma linha de insumo na tela');
    // Antes eram 2 dias. 11 h dão 1; o outro vira espera: o prazo não muda.
    assert.strictEqual(mig.esp, '1', 'o que as horas não cobrem vira espera');
    assert.ok(mig.nota.includes('Retirada em 2 dias'), 'prazo do cliente igual ao de antes: ' + mig.nota);
    assert.ok(mig.nota.includes('veio para cá'), 'e a tela avisa da migração: ' + mig.nota);
    assert.strictEqual(parseFloat(mig.pq), Math.round((30 * 0.48 + 7 * 30) * 100) / 100, 'custo: cera + 7 h × 30');

    // ── salvar grava tudo e a receita sem mão de obra ───────────────────
    const salvo = await pg.evaluate(async () => {
      const servicos = {}, receitas = {};
      _servicesRef = { child: k => ({ set: async d => { servicos[k] = d; } }) };
      _stockRecipesRef = { child: k => ({ set: async d => { receitas[k] = d; } }) };
      await saveService('polimento-cristal');
      return { sv: servicos['polimento-cristal'], rc: receitas['polimento-cristal'] };
    });
    assert.deepStrictEqual(salvo.sv.horas, { pq: 7, gr: 11 }, 'grava as horas');
    assert.strictEqual(salvo.sv.diasEspera, 1, 'grava a espera');
    assert.strictEqual(salvo.sv.daysExtra, 2, 'o prazo gravado continua 2');
    assert.strictEqual(salvo.sv.pricing.pq.cost, 224.4, 'custo pequeno: 14,40 + 210');
    assert.strictEqual(salvo.sv.pricing.gr.cost, 354, 'custo grande: 24 + 330');
    assert.deepStrictEqual(salvo.rc, { 'cera-corte': { pq: 30, gr: 50 } }, 'receita sem a mão de obra');

    // ── salvar o custo da hora recalcula os serviços ────────────────────
    const recalc = await pg.evaluate(async () => {
      const banco = {
        services: {
          'revenda': { name: 'Revenda', veiculo: 'carro', horas: { pq: 11, gr: 11 },
            pricing: { pq: { cost: 0, sale: 400 }, gr: { cost: 0, sale: 400 } } },
          'antigo': { name: 'Antigo', veiculo: 'carro',   // ainda com mão de obra na receita
            pricing: { pq: { cost: 999, sale: 100 }, gr: { cost: 999, sale: 150 } } },
          'sem-nada': { name: 'Sem nada', veiculo: 'carro',   // nem receita nem horas: não mexe
            pricing: { pq: { cost: 50, sale: 100 }, gr: { cost: 60, sale: 150 } } },
        },
        stock: { 'cera-corte': { unit: 'g', costPerUnit: 0.48 }, 'mo': { unit: 'h', costPerUnit: 35 } },
        stockRecipes: { 'revenda': { 'cera-corte': { pq: 65, gr: 65 } }, 'antigo': { 'mo': { pq: 2, gr: 3 } } },
      };
      const snap = v => ({ val: () => v });
      const atualizados = {};
      let custoSalvo = null;
      _servicesRef = { once: async () => snap(banco.services),
        child: k => ({ update: async d => { atualizados[k] = d; } }) };
      _stockRef = { once: async () => snap(banco.stock) };
      _stockRecipesRef = { once: async () => snap(banco.stockRecipes) };
      _custosRef = { child: () => ({ set: async d => { custoSalvo = d; }, once: async () => snap(custoSalvo) }) };
      let alerta = '';
      uiAlert = (t, m) => { alerta = t + ': ' + m; };
      renderAdminEstoque = () => {};
      const inp = document.createElement('input');
      inp.id = 'estValorHora';
      inp.value = '30';
      document.body.prepend(inp);
      await salvarValorHora();
      return { atualizados, custoSalvo, alerta, valorHora: _valorHora };
    });
    assert.strictEqual(recalc.custoSalvo.valorHora, 30, 'grava o custo da hora em custos/maoDeObra');
    assert.strictEqual(recalc.valorHora, 30);
    assert.deepStrictEqual(recalc.atualizados.revenda, { pricing: { pq: { cost: 361.2, sale: 400 }, gr: { cost: 361.2, sale: 400 } } },
      'revenda: 65 g × 0,48 + 11 h × 30 = 361,20');
    assert.deepStrictEqual(recalc.atualizados.antigo, { pricing: { pq: { cost: 60, sale: 100 }, gr: { cost: 90, sale: 150 } } },
      'serviço antigo: horas da receita × 30 (não mais × 35 do insumo)');
    assert.ok(!('sem-nada' in recalc.atualizados), 'serviço sem receita nem horas não é zerado');
    assert.ok(recalc.alerta.includes('2 serviço(s)'), 'diz quantos mudaram: ' + recalc.alerta);

    assert.deepStrictEqual(erros, [], 'sem erro de JavaScript na página: ' + erros.join(' | '));
    console.log('ok — horas de serviço, prazo e custo da hora');
  } finally {
    await nav.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
