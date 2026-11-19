'use strict';

// Teste de navegador: trocar o serviço de um agendamento CONCLUÍDO.
//
// Por que existe: o relatório de lucro (functions/lib/core/financeiro.js) tira
// o custo dos serviços gravados no agendamento. Serviço de revendedor que foi
// registrado como lavagem comum entrava com o custo da lavagem comum, e o lucro
// saía errado. Agora dá para trocar o serviço depois de concluído, com motivo e
// histórico, e opcionalmente acertar o valor para o preço de tabela.
//
// Como rodar:
//   npx serve . -l 8099
//   node scripts/test-troca-servico.js

const { chromium } = require('playwright');
const assert = require('assert');
const fin = require('../functions/lib/core/financeiro.js');

const AGORA = '2026-11-18T12:00:00.000Z';

(async () => {
  const nav = await chromium.launch();
  const pg = await (await nav.newContext()).newPage();
  const erros = [];
  pg.on('pageerror', e => erros.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }));
  await pg.route('https://cognito-idp.*.amazonaws.com/**',
    r => r.fulfill({ status:200, contentType:'application/x-amz-json-1.1', body:'{}' }));

  try {
    await pg.goto('http://localhost:8099/', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.aplicarTrocaDeServico === 'function');

    await pg.evaluate(() => {
      Object.keys(SVCS).forEach(k => delete SVCS[k]);
      SVCS['lavagem'] = { name: 'Lavagem', icon: '🚿', cat: 'Estética Externa', veiculo: 'carro',
        pq: 180, gr: 300, active: true, interno: false, _cost_pq: 60, _cost_gr: 80, faqs: [] };
      SVCS['revenda'] = { name: 'Revenda', icon: '🔒', cat: 'Estética Externa', veiculo: 'carro',
        pq: 400, gr: 400, active: true, interno: true, _cost_pq: 390, _cost_gr: 390, faqs: [] };
    });

    const troca = (b, novos, opts) => pg.evaluate(([b, n, o]) => aplicarTrocaDeServico(b, n, o), [b, novos, opts]);
    const base = { id: 'B1', status: 'completed', services: ['lavagem'], service: 'lavagem',
      carSize: 'pq', price: 180, name: 'Cliente Teste' };

    // ── troca só o serviço ───────────────────────────────────────────────
    let r = await troca(base, ['revenda'], { motivo: 'Serviço de revendedor', quem: 'adm', agora: AGORA });
    assert.ok(!r.erro, 'troca válida: ' + r.erro);
    assert.deepStrictEqual(r.booking.services, ['revenda'], 'grava o serviço novo');
    assert.strictEqual(r.booking.service, 'revenda', 'e o campo antigo de serviço único');
    assert.strictEqual(r.booking.finalPrice, undefined, 'sem pedir, o valor não muda');
    assert.strictEqual(r.mudaValor, false);
    assert.deepStrictEqual(r.booking.serviceCorrections, [{ oldServices: ['lavagem'], newServices: ['revenda'],
      reason: 'Serviço de revendedor', correctedBy: 'adm', correctedAt: AGORA }], 'fica no histórico');

    // E o relatório de lucro passa a usar o custo do serviço novo.
    const svcMap = { lavagem: { pricing: { pq: { cost: 60 } } }, revenda: { pricing: { pq: { cost: 390 } } } };
    assert.strictEqual(fin.custoDoAgendamento(base, svcMap).custo, 60, 'antes: custo da lavagem');
    assert.strictEqual(fin.custoDoAgendamento(r.booking, svcMap).custo, 390, 'depois: custo do revendedor');

    // ── troca serviço e valor ────────────────────────────────────────────
    r = await troca(base, ['revenda'], { novoValor: 400, motivo: 'Serviço de revendedor', quem: 'adm', agora: AGORA });
    assert.strictEqual(r.booking.finalPrice, 400, 'valor de tabela aplicado');
    assert.strictEqual(r.mudaValor, true);
    assert.deepStrictEqual(r.booking.priceCorrections, [{ oldPrice: 180, newPrice: 400,
      reason: 'Serviço de revendedor', correctedBy: 'adm', correctedAt: AGORA }], 'valor também no histórico');
    assert.strictEqual(fin.receitaDoAgendamento(r.booking), 400, 'a receita do relatório acompanha');

    // Histórico anterior é preservado, não substituído.
    r = await troca({ ...base, serviceCorrections: [{ x: 1 }] }, ['revenda'], { motivo: 'Serviço de revendedor', agora: AGORA });
    assert.strictEqual(r.booking.serviceCorrections.length, 2, 'acrescenta ao histórico existente');

    // ── recusas ──────────────────────────────────────────────────────────
    r = await troca({ ...base, status: 'confirmed' }, ['revenda'], { motivo: 'Serviço de revendedor' });
    assert.match(r.erro || '', /concluído/, 'só agendamento concluído');
    r = await troca(base, [], { motivo: 'Serviço de revendedor' });
    assert.match(r.erro || '', /pelo menos um/, 'precisa de serviço');
    r = await troca(base, ['lavagem'], { motivo: 'Serviço de revendedor' });
    assert.match(r.erro || '', /Nada mudou/, 'mesmo serviço e mesmo valor: nada a fazer');
    r = await troca(base, ['revenda'], { motivo: 'curto' });
    assert.match(r.erro || '', /motivo/, 'motivo obrigatório');
    r = await troca(base, ['revenda'], { novoValor: 0, motivo: 'Serviço de revendedor' });
    assert.match(r.erro || '', /valor válido/, 'valor zero recusado');
    // Mesmo serviço, só valor diferente: vale (é correção de valor) e não cria troca de serviço.
    r = await troca(base, ['lavagem'], { novoValor: 200, motivo: 'Ajuste de valor do serviço' });
    assert.ok(!r.erro && r.booking.finalPrice === 200 && !r.booking.serviceCorrections, 'só valor muda');

    // ── fluxo na tela ────────────────────────────────────────────────────
    const tela = await pg.evaluate(async (b) => {
      _bookings = [b];
      _bookingsRef = null;
      renderAdminBookings = () => {};   // a lista do painel exige login; aqui não importa
      for (const id of ['detailBody', 'detailFooter']) {
        if (!document.getElementById(id)) { const d = document.createElement('div'); d.id = id; document.body.prepend(d); }
      }
      viewBooking = () => {};
      openServiceCorrection('B1');
      const lista = document.getElementById('detailBody').innerHTML;
      document.querySelector('#scServicos input[value="lavagem"]').checked = false;
      document.querySelector('#scServicos input[value="revenda"]').checked = true;
      document.getElementById('scAtualizaValor').checked = true;
      _scAtualiza('B1');
      const tabela = document.getElementById('scTabela').textContent;
      document.getElementById('scMotivo').value = 'Serviço de revendedor registrado errado';
      saveServiceCorrection('B1');
      const salvo = getBookings().find(x => x.id === 'B1');
      return { lista, tabela, services: salvo.services, finalPrice: salvo.finalPrice,
        hist: (salvo.serviceCorrections || []).length };
    }, base);
    assert.ok(tela.lista.includes('Revenda') && tela.lista.includes('🔒 Interno'),
      'o serviço interno aparece na troca, com selo');
    assert.ok(tela.tabela.includes('400'), 'mostra o preço de tabela do novo serviço: ' + tela.tabela);
    assert.deepStrictEqual(tela.services, ['revenda'], 'a tela salvou o serviço novo');
    assert.strictEqual(tela.finalPrice, 400, 'e o valor de tabela');
    assert.strictEqual(tela.hist, 1, 'com histórico');

    assert.deepStrictEqual(erros, [], 'sem erro de JavaScript na página: ' + erros.join(' | '));
    console.log('ok — troca de serviço em agendamento concluído');
  } finally {
    await nav.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
