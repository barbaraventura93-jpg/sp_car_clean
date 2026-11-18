'use strict';

// Testa as contas da mão de obra (app.js: diasExtrasPorHoras, prazoDoServico,
// separarMaoDeObra, custoDoServico).
//
// Rodar: node scripts/test-mao-de-obra.js
//
// Por que existe: o pedido (18/11/2026) foi tirar a mão de obra do estoque —
// "não é estocável" —, cadastrar as HORAS de serviço no próprio serviço, tirar
// o prazo dessas horas com 8 h por dia útil, e ter o custo da hora num campo
// à parte (R$ 30). Errar aqui muda o prazo prometido ao cliente ou o lucro.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function recortar(nome) {
  const m = fonte.match(new RegExp('function ' + nome + '\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, 'não achei ' + nome + ' no app.js');
  return m[0];
}
const horasPorDia = fonte.match(/const HORAS_POR_DIA = (\d+);/);
const padrao = fonte.match(/const VALOR_HORA_PADRAO = (\d+);/);
assert.ok(horasPorDia && padrao, 'constantes da mão de obra no app.js');
assert.strictEqual(Number(horasPorDia[1]), 8, 'um dia útil tem 8 h de trabalho');
assert.strictEqual(Number(padrao[1]), 30, 'a hora começa em R$ 30');

const nomes = ['diasExtrasPorHoras', 'prazoDoServico', 'separarMaoDeObra', 'custoDoServico'];
const mod = new Function('const HORAS_POR_DIA = 8;\n' + nomes.map(recortar).join('\n') +
  '\nreturn {' + nomes.join(',') + '};')();
const { diasExtrasPorHoras, prazoDoServico, separarMaoDeObra, custoDoServico } = mod;

// ── horas → prazo (dias extras; 0 = mesmo dia) ────────────────────────
assert.strictEqual(diasExtrasPorHoras(0), 0, 'sem horas, mesmo dia');
assert.strictEqual(diasExtrasPorHoras(3), 0, '3 h cabem no dia');
assert.strictEqual(diasExtrasPorHoras(8), 0, '8 h fecham um dia: ainda mesmo dia');
assert.strictEqual(diasExtrasPorHoras(8.5), 1, 'passou de 8 h: dia seguinte');
assert.strictEqual(diasExtrasPorHoras(11), 1, '11 h (revendedor) = 2 dias de trabalho = dia seguinte');
assert.strictEqual(diasExtrasPorHoras(16), 1, '16 h = 2 dias');
assert.strictEqual(diasExtrasPorHoras(17), 2, '17 h = 3 dias');
assert.strictEqual(diasExtrasPorHoras('abc'), 0, 'lixo não vira NaN');

// O prazo é um só: vale o porte que leva mais horas, mais a espera.
assert.strictEqual(prazoDoServico({ pq: 7, gr: 11 }, 0), 1, 'o carro grande decide');
assert.strictEqual(prazoDoServico({ pq: 7, gr: 11 }, 1), 2, 'espera de cura soma');
assert.strictEqual(prazoDoServico(null, 2), 2, 'só espera');
assert.strictEqual(prazoDoServico({ pq: 4, gr: 6 }, -3), 0, 'espera negativa não reduz');

// ── migração: mão de obra cadastrada como insumo vira horas ──────────
const insumos = {
  'flotador-apc':  { unit: 'ml', costPerUnit: 0.01 },
  'desengraxante': { unit: 'ml', costPerUnit: 0.03 },
  'cera-corte':    { unit: 'g',  costPerUnit: 0.48 },
  'mo':            { unit: 'h',  costPerUnit: 35 },
  'mo-especializada': { unit: 'h', costPerUnit: 45 },
};
let sep = separarMaoDeObra({ 'cera-corte': { pq: 30, gr: 50 }, 'mo': { pq: 6, gr: 10 } }, insumos);
assert.deepStrictEqual(sep.receita, { 'cera-corte': { pq: 30, gr: 50 } }, 'a mão de obra sai da receita');
assert.deepStrictEqual(sep.horas, { pq: 6, gr: 10 }, 'e vira horas');
assert.strictEqual(sep.tinha, true);
sep = separarMaoDeObra({ 'mo': { pq: 1, gr: 1 }, 'mo-especializada': { pq: 2, gr: 3 } }, insumos);
assert.deepStrictEqual(sep.horas, { pq: 3, gr: 4 }, 'dois itens em horas somam');
sep = separarMaoDeObra({ 'cera-corte': { pq: 30, gr: 50 } }, insumos);
assert.strictEqual(sep.tinha, false, 'receita sem mão de obra fica como está');
assert.deepStrictEqual(separarMaoDeObra(undefined, insumos).receita, {}, 'sem receita, sem erro');

// ── custo = insumos + horas × custo da hora ──────────────────────────
// O serviço de revendedor do pedido: 80 ml flotador, 140 ml desengraxante,
// 65 g de cera de corte e 11 h de mão de obra a R$ 30/h.
const revenda = {
  'flotador-apc':  { pq: 80,  gr: 80 },
  'desengraxante': { pq: 140, gr: 140 },
  'cera-corte':    { pq: 65,  gr: 65 },
};
const c = custoDoServico(revenda, insumos, { pq: 11, gr: 11 }, 30);
// 0,80 + 4,20 + 31,20 + 330 = 366,20
assert.deepStrictEqual(c, { pq: 366.2, gr: 366.2 }, 'revendedor: 0,80 + 4,20 + 31,20 + 330 = 366,20');

// Mão de obra deixada na receita antiga não conta duas vezes.
const comMo = { ...revenda, 'mo': { pq: 11, gr: 11 } };
assert.deepStrictEqual(custoDoServico(comMo, insumos, { pq: 11, gr: 11 }, 30), c,
  'item em horas na receita é ignorado: a mão de obra vem só das horas');

assert.deepStrictEqual(custoDoServico(revenda, insumos, null, 30), { pq: 36.2, gr: 36.2 }, 'sem horas, só insumos');
assert.deepStrictEqual(custoDoServico({}, insumos, { pq: 2, gr: 3 }, 30), { pq: 60, gr: 90 }, 'só mão de obra, por porte');
assert.deepStrictEqual(custoDoServico({ 'sumiu': { pq: 10, gr: 10 } }, insumos, null, 30), { pq: 0, gr: 0 },
  'insumo que não existe mais não quebra a conta');
// Mudar o custo da hora muda o custo.
assert.strictEqual(custoDoServico({}, insumos, { pq: 11, gr: 11 }, 35).pq, 385, '11 h × 35');

console.log('mão de obra: horas, prazo e custo — todos passaram');
