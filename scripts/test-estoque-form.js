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
      saldoUn: document.getElementById('spQtyUn').textContent,
      saldoNota: document.getElementById('spQtyNota').textContent,
    }));

    // ── estado inicial: o custo nunca é digitável ───────────────────────
    // Não existe opção de informá-lo à mão: duas origens para o mesmo número é
    // como o custo do serviço passa a discordar do que ela pagou.
    let r = await ler();
    assert.strictEqual(r.somenteLeitura, true, 'o custo é sempre calculado');
    assert.strictEqual(await pg.locator('#spCostAuto').count(), 0, 'a opção não existe mais');
    assert.match(r.nota, /Preencha o múltiplo/, 'a tela diz o que falta: ' + r.nota);

    // ── o caso do pedido, digitado como ela digitaria ───────────────────
    await pg.fill('#spName', 'Shampoo Automotivo');
    await pg.fill('#spPurchaseMult', '5');
    await pg.selectOption('#spPurchaseUnit', 'L');
    await pg.fill('#spPurchasePrice', '180');

    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.036, 'custo por ml calculado: ' + r.custo);
    assert.strictEqual(r.somenteLeitura, true, 'campo calculado não aceita digitação');
    // A conta à vista é o que permite conferir sem confiar: 180 ÷ 5000.
    // A conversão aparece inteira — é a parte que ela deixou de calcular.
    assert.ok(r.nota.includes('180,00') && r.nota.includes('5 L = 5000 ml') && r.nota.includes('0,0360'),
      'a nota mostra a conversão e a divisão: ' + r.nota);
    assert.strictEqual(r.somenteLeitura, true, 'continua calculado');

    // ── o saldo é contado na UNIDADE de compra, e aceita decimal ────────
    // "Tenho 17 litros e meio", não "tenho 17500 ml" nem "3,5 embalagens".
    assert.strictEqual(r.saldoUn, 'L', 'o rótulo do saldo é a unidade: ' + r.saldoUn);
    await pg.fill('#spQty', '17.5');
    await pg.fill('#spMin', '2.5');
    r = await ler();
    assert.ok(r.saldoNota.includes('17500') && r.saldoNota.includes('2500'),
      'a tela mostra quanto é em ml: ' + r.saldoNota);
    // E quantas embalagens isso representa, que é como ela vê na prateleira.
    assert.ok(r.saldoNota.includes('3.5 × 5 L'), 'e em embalagens: ' + r.saldoNota);

    // ── mudar o preço recalcula na hora ─────────────────────────────────
    await pg.fill('#spPurchasePrice', '200');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.04, 'preço novo, custo novo: ' + r.custo);

    // ── trocar a unidade de uso refaz as opções de compra ───────────────
    // Deixar "L" selecionado com uso em gramas daria uma conversão impossível.
    await pg.selectOption('#spUnit', 'g');
    const opcoesMassa = await pg.$$eval('#spPurchaseUnit option', os => os.map(o => o.value));
    assert.deepStrictEqual(opcoesMassa.sort(), ['g', 'kg'], 'só unidades de massa: ' + opcoesMassa);
    await pg.selectOption('#spPurchaseUnit', 'kg');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.04, '5 kg a R$200 = R$0,04/g: ' + r.custo);
    assert.strictEqual(r.saldoUn, 'kg', 'o rótulo do saldo acompanha: ' + r.saldoUn);
    // E de volta para volume, sem sobrar "kg" no seletor.
    await pg.selectOption('#spUnit', 'ml');
    const opcoesVolume = await pg.$$eval('#spPurchaseUnit option', os => os.map(o => o.value));
    assert.deepStrictEqual(opcoesVolume.sort(), ['L', 'ml'], 'só unidades de volume: ' + opcoesVolume);
    await pg.selectOption('#spPurchaseUnit', 'L');

    // ── preço sem múltiplo: diz o que falta, e não inventa custo ────────
    await pg.fill('#spPurchaseMult', '');
    r = await ler();
    assert.match(r.nota, /Falta o múltiplo de compra/, 'instrução do que falta: ' + r.nota);
    assert.strictEqual(parseFloat(r.custo), 0, 'sem poder calcular, o custo não é inventado');
    assert.strictEqual(r.somenteLeitura, true, 'e o campo segue calculado, nunca digitável');
    // E salvar neste estado é barrado, em vez de gravar um custo errado.
    await pg.evaluate(() => window.saveProduct(null));
    const avisoVisivel = await pg.evaluate(() => {
      const t = document.body.innerText || '';
      return /Falta a compra deste insumo|vêm na embalagem/i.test(t);
    });
    assert.ok(avisoVisivel, 'salvar sem a compra avisa em vez de gravar custo zero');
    // O aviso é um modal por cima do formulário; fechar é parte do fluxo real.
    await pg.click('#confirmModalOk');
    await pg.waitForSelector('#confirmModal', { state: 'hidden' });

    // ── a granel: múltiplo 1 e o preço de 1 unidade ─────────────────────
    // É a saída que substitui o antigo "informar o custo à mão": quem compra
    // sem embalagem fixa diz quanto custa uma unidade de uso.
    await pg.selectOption('#spPurchaseUnit', 'ml');
    await pg.fill('#spPurchaseMult', '1');
    await pg.fill('#spPurchasePrice', '0.0275');
    r = await ler();
    assert.strictEqual(parseFloat(r.custo), 0.0275, 'granel: 1 ml custa R$0,0275: ' + r.custo);
    assert.strictEqual(r.saldoUn, 'ml', 'e o saldo volta a ser contado em ml: ' + r.saldoUn);

    assert.deepStrictEqual(erros, [], 'console sem erro: ' + erros.join(' | '));
    console.log('estoque (formulário): o preço da unidade de compra é o caminho — todos passaram');
  } catch (e) {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await nav.close();
  }
})();
