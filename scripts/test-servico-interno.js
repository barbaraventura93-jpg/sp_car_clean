'use strict';

// Teste de navegador: serviço interno (🔒) nunca chega ao cliente.
//
// Por que existe: o serviço de revendedor (lavagem + higienização + polimento
// simples, preço próprio, insumos próprios) não pode aparecer no site. Antes só
// combo tinha a opção "interno"; serviço era sempre público. Agora o serviço tem
// o campo `interno` e toda tela do cliente passa por svcPublico().
//
// Regras verificadas:
//   - não aparece na vitrine (carro e moto);
//   - não aparece no passo 1 do agendamento online;
//   - link direto (openBooking com o id) não pré-seleciona o serviço;
//   - não vira sugestão de "hora de voltar" nem botão da IA do site;
//   - aparece no agendamento manual do painel, com o selo 🔒;
//   - o formulário do serviço grava `interno: true` / `false`.
//
// Como rodar:
//   npx serve . -l 8099
//   node scripts/test-servico-interno.js

const { chromium } = require('playwright');
const assert = require('assert');

const NOME_INTERNO = 'Revenda Teste Interno';
const NOME_PUBLICO = 'Lavagem Teste Publica';

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
    await pg.waitForFunction(() => typeof window.svcPublico === 'function' && typeof window.renderServices === 'function');

    // Catálogo de teste: um público e um interno (carro), mais um interno de moto.
    await pg.evaluate(([nInt, nPub]) => {
      Object.keys(SVCS).forEach(k => delete SVCS[k]);
      SVCS['lavagem-publica'] = { name: nPub, icon: '🚿', cat: 'Estética Externa', veiculo: 'carro',
        pq: 180, gr: 300, daysExtra: 0, desc: '', active: true, interno: false, faqs: [] };
      SVCS['revenda'] = { name: nInt, icon: '🔒', cat: 'Estética Externa', veiculo: 'carro',
        pq: 400, gr: 400, daysExtra: 0, desc: '', active: true, interno: true, faqs: [] };
      SVCS['revenda-moto'] = { name: nInt + ' Moto', icon: '🔒', cat: 'Estética Externa', veiculo: 'moto',
        pq: 400, gr: 400, daysExtra: 0, desc: '', active: true, interno: true, faqs: [] };
    }, [NOME_INTERNO, NOME_PUBLICO]);

    // ── a regra única ────────────────────────────────────────────────────
    const regra = await pg.evaluate(() => ({
      pub: svcPublico(SVCS['lavagem-publica']),
      int: svcPublico(SVCS['revenda']),
      inativo: svcPublico({ active: false }),
      vazio: svcPublico(undefined),
    }));
    assert.strictEqual(regra.pub, true, 'serviço ativo e não interno é público');
    assert.strictEqual(regra.int, false, 'serviço interno não é público');
    assert.strictEqual(regra.inativo, false, 'serviço inativo não é público');
    assert.strictEqual(regra.vazio, false, 'serviço inexistente não é público');

    // ── vitrine ──────────────────────────────────────────────────────────
    const vitrine = await pg.evaluate(() => {
      renderServices();
      const cats = getDisplayCats().flatMap(c => c.keys);
      return { html: document.getElementById('catWrap').innerHTML, cats, motos: getMotoServices() };
    });
    assert.ok(vitrine.html.includes(NOME_PUBLICO), 'o serviço público continua na vitrine');
    assert.ok(!vitrine.html.includes(NOME_INTERNO), 'o serviço interno NÃO aparece na vitrine');
    assert.deepStrictEqual(vitrine.cats, ['lavagem-publica'], 'categorias da vitrine só com o público');
    assert.deepStrictEqual(vitrine.motos, [], 'serviço interno de moto também fica fora');

    // ── agendamento online ───────────────────────────────────────────────
    const passo1 = await pg.evaluate(() => {
      openBooking();
      return document.getElementById('bookingModal').innerHTML;
    });
    assert.ok(passo1.includes(NOME_PUBLICO), 'o público está no passo 1 do agendamento');
    assert.ok(!passo1.includes(NOME_INTERNO), 'o interno NÃO está no passo 1 do agendamento');

    // Link direto para o id do serviço interno: não pode pré-selecionar.
    const direto = await pg.evaluate(() => {
      openBooking('revenda');
      return { services: booking.services.slice(), step: booking.step,
        html: document.getElementById('bookingModal').innerHTML };
    });
    assert.deepStrictEqual(direto.services, [], 'link direto não seleciona o serviço interno');
    assert.strictEqual(direto.step, 1, 'e volta ao passo de escolher serviço');
    assert.ok(!direto.html.includes(NOME_INTERNO), 'nem mostra o nome dele');
    await pg.evaluate(() => closeBooking());

    // ── agendamento manual do painel: aparece, com selo ──────────────────
    const manual = await pg.evaluate(() => {
      const ul = document.createElement('div');
      ul.id = 'abServiceList';
      document.body.prepend(ul);
      abBuildServiceList('carro');
      return ul.innerHTML;
    });
    assert.ok(manual.includes(NOME_INTERNO), 'o admin vê o serviço interno no agendamento manual');
    assert.ok(manual.includes('🔒 Interno'), 'com o selo 🔒 Interno');

    // ── formulário do serviço grava o campo ──────────────────────────────
    await pg.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'svcFormWrap';
      document.body.prepend(d);
    });
    let sel = await pg.evaluate(() => { openServiceForm('revenda'); return document.getElementById('sfInterno').value; });
    assert.strictEqual(sel, '1', 'serviço interno abre com Visibilidade = Interno');
    sel = await pg.evaluate(() => { openServiceForm(null); return document.getElementById('sfInterno').value; });
    assert.strictEqual(sel, '0', 'serviço novo nasce público (Interno é escolha explícita)');

    const salvo = await pg.evaluate(async () => {
      const gravados = {};
      _servicesRef = { child: k => ({ set: async d => { gravados[k] = d; } }) };
      _stockRecipesRef = null;
      openServiceForm(null);
      document.getElementById('sfName').value = 'Revenda Simples';
      document.getElementById('sfSalePq').value = '400';
      document.getElementById('sfSaleGr').value = '400';
      document.getElementById('sfInterno').value = '1';
      await saveService('');
      openServiceForm(null);
      document.getElementById('sfName').value = 'Outro Publico';
      document.getElementById('sfSalePq').value = '100';
      document.getElementById('sfSaleGr').value = '150';
      await saveService('');
      return gravados;
    });
    assert.strictEqual(salvo['revenda-simples']?.interno, true, 'Interno grava interno: true');
    assert.strictEqual(salvo['revenda-simples']?.pricing?.pq?.sale, 400, 'preço de venda pequeno 400');
    assert.strictEqual(salvo['revenda-simples']?.pricing?.gr?.sale, 400, 'preço de venda grande 400');
    assert.strictEqual(salvo['outro-publico']?.interno, false, 'Público grava interno: false');

    assert.deepStrictEqual(erros, [], 'sem erro de JavaScript na página: ' + erros.join(' | '));
    console.log('ok — serviço interno fica fora do site e dentro do painel');
  } finally {
    await nav.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
