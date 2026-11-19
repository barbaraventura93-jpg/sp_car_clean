'use strict';

// Dado digitado pelo cliente não pode virar código no painel.
//
// Por que existe: nome, carro, placa, observação, lista de espera e nome do
// comprador de gift card são escritos por qualquer visitante, e o painel
// montava HTML com eles sem tratamento (achado S-02 da revisão de 09/11/2026).
// Um "nome" contendo <img onerror=...> rodaria no navegador de quem abre o
// pedido, com a sessão de administradora.
//
// Duas travas:
//   1. ESTÁTICA: nenhuma linha de HTML em app.js interpola campo de dado de
//      cliente sem passar por esc() ou escAttrJs(). Vale para código novo.
//   2. COMPORTAMENTO, num navegador de verdade: com as funções reais de
//      app.js, cargas maliciosas não executam, e o valor que chega ao
//      onclick é exatamente o texto original.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

// Campos que vêm de fora. Acrescente aqui ao criar um campo novo de cliente.
const CAMPOS = /\.(name|car|plate|obs|note|notes|adminNotes|email|phone|bairro|cep|message|recipientName|buyerName|buyerEmail|buyerPhone|comment|clientName|caption|comoConheceu|comoConheceuDetalhe|friendName|friendEmail|friendPhone|referrerName|referrerEmail|referrerPhone|reason|approvedLocation|bodyType|model|address|street|city|label|id|code|bookingId|couponCode|giftCardCode|uid|key|photoUrl)\b/;
// A expressão inteira já é segura quando começa por uma destas chamadas.
const SEGURA = /^\s*(esc|escHtml|escAttrJs|encodeURIComponent|fmtMoney|fmtDate|fmtDateShort|Number|parseInt|parseFloat)\(/;
// Expressões que montam HTML de propósito e escapam por dentro. Cada uma foi
// lida na revisão; uma nova precisa ser lida e acrescentada aqui.
const REVISADAS = [
  'bodyTypeOptions(booking.bodyType)',
  "vehicles.map(v => _clientVehicleRowHtml(v.car || '', v.plate || '')).join('')",
];
const EM_EVENTO = /\bon[a-z]+="[^"]*$/;

/** Devolve as interpolações perigosas de um código-fonte: [{ linha, expr }]. */
function interpolacoesSemEscape(fonte) {
  const achados = [];
  function varrer(texto, linha, prefixo) {
    let i = 0;
    let visto = '';
    while (i < texto.length) {
      const k = texto.indexOf('${', i);
      if (k < 0) break;
      let j = k + 2;
      let nivel = 1;
      while (j < texto.length && nivel > 0) { if (texto[j] === '{') nivel++; else if (texto[j] === '}') nivel--; j++; }
      if (nivel > 0) break;
      const expr = texto.slice(k + 2, j - 1);
      visto += texto.slice(i, k);
      const antes = prefixo + visto;
      const emEvento = EM_EVENTO.test(antes);
      if (expr.includes('`')) {
        varrer(expr, linha, antes + '${'); // template aninhado: olha por dentro
      } else if (emEvento && /^\s*esc(Html)?\(/.test(expr)) {
        // esc() dentro de onclick não protege (ver escAttrJs em app.js)
        achados.push({ linha, expr: expr.trim() + '  <- em atributo de evento use escAttrJs()' });
      } else if (CAMPOS.test(expr) && !SEGURA.test(expr)) {
        const escapaPorDentro = /\besc(Html|AttrJs)?\(/.test(expr) && !emEvento;
        if (!escapaPorDentro && !REVISADAS.includes(expr.trim())) achados.push({ linha, expr: expr.trim() });
      }
      visto += texto.slice(k, j);
      i = j;
    }
  }
  fonte.split('\n').forEach((l, n) => {
    if (/<[a-zA-Z\/]/.test(l) || /\bon[a-z]+="/.test(l)) varrer(l, n + 1, '');
  });
  return achados;
}

// ── 1. Trava estática ─────────────────────────────────────────────────────
const abertos = interpolacoesSemEscape(APP);
assert.deepStrictEqual(abertos, [],
  'app.js interpola dado de cliente em HTML sem esc()/escAttrJs():\n' +
  abertos.map((a) => `  linha ${a.linha}: \${${a.expr}}`).join('\n'));

// Teste do teste: o verificador tem que acusar o que já foi defeito de verdade.
const acusa = (codigo, rotulo) => assert.strictEqual(interpolacoesSemEscape(codigo).length, 1, `deveria acusar: ${rotulo}`);
const passa = (codigo, rotulo) => assert.strictEqual(interpolacoesSemEscape(codigo).length, 0, `não deveria acusar: ${rotulo}`);
acusa('x.innerHTML = `<div>${b.name}</div>`;', 'nome cru');
acusa('x.innerHTML = `<div>${b.car}${esc(b.plate)}</div>`;', 'um campo cru ao lado de um tratado');
acusa('x = `${b.obs ? `<span>${b.obs}</span>` : ""}`;', 'campo cru dentro de template aninhado');
acusa('x = `<button onclick="ver(\'${b.id}\')">`;', 'id cru em onclick');
acusa('x = `<button onclick="ver(\'${esc(b.id)}\')">`;', 'esc() em onclick não basta');
acusa('x = `<input value="${st.note}"/>`;', 'valor de atributo cru');
passa('x.innerHTML = `<div>${esc(b.name)}</div>`;', 'nome tratado');
passa('x = `<button onclick="ver(\'${escAttrJs(b.id)}\')">`;', 'id tratado em onclick');
passa('x = `<td>${fmtMoney(b.price)}</td>`;', 'número formatado');
passa('const msg = `Olá ${b.name}, seu carro está pronto`;', 'texto de WhatsApp não é HTML');
passa('x = `<i>${c.bairro ? " · " + esc(c.bairro) : ""}</i>`;', 'trata por dentro');

// ── 2. Comportamento, com as funções reais ────────────────────────────────
const inicio = APP.indexOf('function escHtml');
const fim = APP.indexOf('\n}', APP.indexOf('function escAttrJs')) + 2;
assert.ok(inicio > 0 && fim > inicio, 'escHtml e escAttrJs precisam existir em app.js');
const FUNCOES = APP.slice(inicio, fim);

const CARGAS = [
  '<img src=x onerror="window.__xss=1">',
  '"><script>window.__xss=1</script>',
  "');window.__xss=1;//",
  "\\');window.__xss=1;//",
  '&#39;);window.__xss=1;//',
  '</button><svg onload="window.__xss=1">',
  "a'b\"c\\d\ne",
  'João & Maria <3',
  "D'Ávila",
];

(async () => {
  const nav = await chromium.launch();
  try {
    const pg = await nav.newPage();
    const erros = [];
    pg.on('pageerror', (e) => erros.push(e.message));
    await pg.setContent('<!doctype html><div id="alvo"></div>');
    await pg.addScriptTag({ content: FUNCOES + '\nwindow.__recebidos = []; function receber(v) { window.__recebidos.push(v); }' });

    for (const carga of CARGAS) {
      const r = await pg.evaluate((c) => {
        window.__xss = 0;
        window.__recebidos = [];
        const alvo = document.getElementById('alvo');
        alvo.innerHTML =
          `<div class="texto">${esc(c)}</div>` +
          `<input class="valor" value="${esc(c)}"/>` +
          `<span class="aspas-simples" title='${esc(c)}'></span>` +
          `<button class="botao" onclick="receber('${escAttrJs(c)}')">ok</button>`;
        alvo.querySelector('.botao').click();
        return {
          texto: alvo.querySelector('.texto').textContent,
          filhos: alvo.querySelector('.texto').children.length,
          valor: alvo.querySelector('.valor').value,
          titulo: alvo.querySelector('.aspas-simples').getAttribute('title'),
          elementos: alvo.children.length,
          recebidos: window.__recebidos,
        };
      }, carga);
      await pg.waitForTimeout(30); // dá tempo a um onerror/onload indevido disparar
      const xss = await pg.evaluate(() => window.__xss);

      assert.strictEqual(xss, 0, `carga executou código: ${carga}`);
      assert.strictEqual(r.texto, carga, `o texto exibido tem que ser o original: ${carga}`);
      assert.strictEqual(r.filhos, 0, `a carga não pode criar elemento: ${carga}`);
      // Um <input> de uma linha descarta quebra de linha: é do navegador, não do escape.
      assert.strictEqual(r.valor, carga.replace(/\n/g, ''), `value do input tem que ser o original: ${carga}`);
      assert.strictEqual(r.titulo, carga, `atributo em aspas simples tem que ser o original: ${carga}`);
      assert.strictEqual(r.elementos, 4, `a estrutura não pode mudar: ${carga}`);
      assert.deepStrictEqual(r.recebidos, [carga], `o onclick recebe exatamente o original, uma vez: ${carga}`);
    }
    assert.deepStrictEqual(erros, [], 'nenhuma carga pode quebrar o JavaScript do atributo');

    // Prova de que o teste enxerga o problema: SEM escape, a mesma carga executa.
    const semEscape = await pg.evaluate(async (c) => {
      window.__xss = 0;
      document.getElementById('alvo').innerHTML = `<div>${c}</div>`;
      await new Promise((ok) => setTimeout(ok, 80));
      return window.__xss;
    }, CARGAS[0]);
    assert.strictEqual(semEscape, 1, 'sem escape a carga executa — é isso que o teste protege');
  } finally {
    await nav.close();
  }
  console.log('painel: dado de cliente não vira código (estático + navegador) — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
