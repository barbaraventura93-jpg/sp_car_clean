'use strict';

// Teste de navegador: o formulário de insumo pede o preço do GALÃO.
//
// Por que existe: a conta está coberta por scripts/test-estoque-custo.js, mas a
// conta certa num campo que a pessoa não consegue usar não resolve nada. Aqui o
// que se verifica é o comportamento da tela — se o custo aparece calculado, se a
// conta fica à vista, se dá para escapar do automático quando a compra é a
// granel, e se o campo deixa de aceitar digitação quando está sendo calculado
// (campo calculado que aceita digitação mostra um número e salva outro).
//
// Como rodar:
//   npx serve . -l 8099        # ou qualquer servidor estático na porta 8099
//   node scripts/test-estoque-form.js

const { chromium } = require('playwright');
const assert = require('assert');
const _spArredonda = v => Math.round(v * 1e6) / 1e6;  // igual ao do app.js

(async () => {
  const nav = await chromium.launch();
  const pg = await (await nav.newContext()).newPage();
  const erros = [];
  pg.on('pageerror', e => erros.push(e.message));
  await pg.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await pg.route('https://cognito-idp.*.amazonaws.com/**',
    r => r.fulfill({ status: 200, contentType: 'application/x-amz-json-1.1', body: '{}' }));

  try {
    await pg.goto('http://localhost:8099/', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.openProductForm === 'function');

    // Insumo novo: o formulário abre sem depender do Firebase.
    await pg.evaluate(() => window.openProductForm());
    await pg.waitForSelector('#spPurchasePrice', { state: 'visible' });

    const ler = () => pg.evaluate(() => ({
      custo:  document.getElementById('spCost').value,
      somenteLeitura: document.getElementById('spCost').readOnly,
      nota:   document.getElementById('spCostNota').textContent,
      auto:   document.getElementById('spCostAuto').checked,
    }));

    // ── estado inicial: nada preenchido, custo livre ────────────────────
    let r = await ler();
    assert.strictEqual(r.somenteLeitura, false, 'sem preço, o custo é digitável');
    assert.match(r.nota, /Informado direto/, 'a tela diz de onde vem o número: ' + r.nota);

    // ── o caso do pedido, digitado como ela digitaria ───────────────────
    await pg.fill('#spName', 'Shampoo Automotivo');
    await pg.fill('#spPurchaseLabel', 'Galão 5L');
    await pg.fill('#spPurchaseFactor', '5000');
    await pg.fill('#spPurchasePrice', '180');

    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.036, 'custo por ml calculado: ' + r.custo);
    assert.strictEqual(r.somenteLeitura, true, 'campo calculado não aceita digitação');
    // A conta à vista é o que permite conferir sem confiar: 180 ÷ 5000.
    assert.ok(r.nota.includes('180,00') && r.nota.includes('5000') && r.nota.includes('0,0360'),
      'a nota mostra a conta inteira: ' + r.nota);
    assert.ok(r.nota.includes('ml'), 'a nota diz a unidade: ' + r.nota);
    // O modo fica VISÍVEL na tela, não escondido num botão de mão única.
    assert.strictEqual(r.auto, true, 'o seletor mostra que está calculando');

    // ── mudar o preço recalcula na hora ─────────────────────────────────
    await pg.fill('#spPurchasePrice', '200');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.04, 'preço novo, custo novo: ' + r.custo);

    // ── mudar a unidade de medida reaparece na nota ─────────────────────
    await pg.selectOption('#spUnit', 'g');
    r = await ler();
    assert.ok(r.nota.includes(' g'), 'a nota acompanha a unidade escolhida: ' + r.nota);
    await pg.selectOption('#spUnit', 'ml');

    // ── preço sem conversão: diz o que falta, e não inventa custo ───────
    await pg.fill('#spPurchaseFactor', '');
    r = await ler();
    assert.match(r.nota, /Falta dizer quantos ml tem um "Galão 5L"/, 'instrução exata: ' + r.nota);
    assert.strictEqual(r.somenteLeitura, false, 'sem poder calcular, devolve o campo');
    // E salvar neste estado é barrado, em vez de gravar um custo errado.
    await pg.evaluate(() => window.saveProduct(null));
    const avisoVisivel = await pg.evaluate(() => {
      const t = document.body.innerText || '';
      return /Falta a convers|quantos ml ela tem/i.test(t);
    });
    assert.ok(avisoVisivel, 'salvar sem a conversão avisa em vez de gravar custo errado');
    // O aviso é um modal por cima do formulário; fechar é parte do fluxo real.
    await pg.click('#confirmModalOk');
    await pg.waitForSelector('#confirmModal', { state: 'hidden' });

    // ── granel: a saída manual existe e funciona ────────────────────────
    await pg.fill('#spPurchaseFactor', '5000');
    r = await ler();
    assert.strictEqual(r.somenteLeitura, true, 'voltou a calcular');
    await pg.uncheck('#spCostAuto');
    r = await ler();
    assert.strictEqual(r.somenteLeitura, false, 'o modo manual libera o campo');
    assert.strictEqual(r.auto, false, 'e o seletor reflete isso');
    await pg.fill('#spCost', '0.0275');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.0275, 'o valor digitado permanece');

    // ── o valor digitado à mão NÃO é sobrescrito pelo automático ────────
    // Este caso foi encontrado por este teste: antes, mexer no preço depois de
    // escolher o modo manual apagava o número que ela acabara de digitar, sem
    // aviso e sem a tela mostrar que o modo havia mudado.
    await pg.fill('#spPurchasePrice', '999');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.0275,
      'registrar o preço pago não apaga o custo digitado: ' + r.custo);
    assert.strictEqual(r.auto, false, 'e o modo continua manual');
    // Mas a tela OFERECE a conta, para a escolha não ficar escondida.
    assert.ok(r.nota.includes('999,00') && r.nota.includes('Marque'),
      'a tela mostra a conta disponível: ' + r.nota);

    // Marcar o seletor é decisão explícita: aí sim o cálculo assume.
    await pg.check('#spCostAuto');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), _spArredonda(999 / 5000), 'assume ao ser marcado: ' + r.custo);
    assert.strictEqual(r.somenteLeitura, true);

    // ── produto antigo: preço novo supera o custo que veio do banco ─────
    // Diferente do caso acima — ninguém digitou custo nesta edição, então o
    // preço novo manda. É como atualizar preço de insumo que subiu.
    await pg.evaluate(() => window.openProductForm());
    await pg.waitForSelector('#spPurchasePrice', { state: 'visible' });
    await pg.evaluate(() => { document.getElementById('spCost').value = '0.03'; });
    await pg.fill('#spPurchaseFactor', '5000');
    await pg.fill('#spPurchasePrice', '200');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.04,
      'custo vindo do banco é legitimamente superado pelo preço novo: ' + r.custo);

    assert.deepStrictEqual(erros, [], 'console sem erro: ' + erros.join(' | '));
    console.log('estoque (formulário): o preço da unidade de compra é o caminho — todos passaram');
  } catch (e) {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await nav.close();
  }
})();
