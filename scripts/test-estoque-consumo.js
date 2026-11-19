'use strict';

// Testa o consumo de estoque pelas vendas e a previsão de quando comprar
// (app.js: consumoDoAgendamento, consumoPorDia, previsaoCompra).
//
// Rodar: node scripts/test-estoque-consumo.js
//
// Por que existe: o pedido foi "a partir da data que foi cadastrado, o saldo
// deve ser atualizado de acordo com as vendas vs o quanto é projetado de uso de
// cada produto, para indicar quando for precisar comprar". Errar aqui faz a
// pessoa comprar o que não precisa, ou descobrir que acabou no meio do serviço.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function recortar(nome) {
  const m = fonte.match(new RegExp('function ' + nome + '\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, 'não achei ' + nome + ' no app.js');
  return m[0];
}
const nomes = ['consumoDoAgendamento', 'consumoPorDia', 'previsaoCompra', '_spParaCompra', '_spParaUso'];
const mod = new Function(nomes.map(recortar).join('\n') + '\nreturn {' + nomes.join(',') + '};')();
const { consumoDoAgendamento, consumoPorDia, previsaoCompra, _spParaCompra, _spParaUso } = mod;

const RECEITAS = {
  'lavagem':   { 'shampoo': { pq: 100, gr: 150 }, 'mo': { pq: 1, gr: 1.5 } },
  'polimento': { 'cera':    { pq: 120, gr: 200 }, 'shampoo': { pq: 50, gr: 80 }, 'mo': { pq: 2, gr: 3 } },
};

// ── consumo de um agendamento ──────────────────────────────────────────
assert.deepStrictEqual(
  consumoDoAgendamento({ services: ['lavagem'], carSize: 'pq' }, RECEITAS),
  { shampoo: 100, mo: 1 });
assert.deepStrictEqual(
  consumoDoAgendamento({ services: ['lavagem'], carSize: 'gr' }, RECEITAS),
  { shampoo: 150, mo: 1.5 }, 'carro grande consome mais');

// O DEFEITO que isto corrige: dois serviços no mesmo agendamento usando o mesmo
// insumo. Antes, o segundo sobrescrevia o primeiro dentro do deductStock e o
// consumo de um deles sumia — o estoque ficava mais cheio no sistema do que na
// prateleira, justamente no agendamento maior.
assert.deepStrictEqual(
  consumoDoAgendamento({ services: ['lavagem', 'polimento'], carSize: 'pq' }, RECEITAS),
  { shampoo: 150, mo: 3, cera: 120 }, '100 + 50 de shampoo, 1 + 2 de mão de obra');

// Formatos antigos e lixo não podem derrubar a baixa.
assert.deepStrictEqual(consumoDoAgendamento({ service: 'lavagem', carSize: 'pq' }, RECEITAS),
  { shampoo: 100, mo: 1 }, 'agendamento antigo, de serviço único');
assert.deepStrictEqual(consumoDoAgendamento({ services: ['lavagem'] }, RECEITAS),
  { shampoo: 100, mo: 1 }, 'sem porte declarado, vale o pequeno');
assert.deepStrictEqual(consumoDoAgendamento({ services: ['inexistente'], carSize: 'pq' }, RECEITAS), {},
  'serviço sem receita não consome');
assert.deepStrictEqual(consumoDoAgendamento({ services: [] }, RECEITAS), {});
assert.deepStrictEqual(consumoDoAgendamento({ services: ['lavagem'] }, null), {}, 'sem receitas');

// ── ritmo por dia, só do que foi realizado ─────────────────────────────
const HOJE = new Date('2026-11-09T12:00:00Z');
const diasAtras = n => new Date(HOJE.getTime() - n * 86400000).toISOString();

const agenda = [
  { status: 'completed', completedAt: diasAtras(5),  services: ['lavagem'],   carSize: 'pq' },
  { status: 'completed', completedAt: diasAtras(20), services: ['polimento'], carSize: 'gr' },
  // Não realizados: não tiraram nada da prateleira.
  { status: 'confirmed', completedAt: diasAtras(2),  services: ['polimento'], carSize: 'gr' },
  { status: 'cancelled', completedAt: diasAtras(3),  services: ['lavagem'],   carSize: 'pq' },
  { status: 'pending',                                services: ['lavagem'],   carSize: 'pq' },
  // Fora da janela de 60 dias.
  { status: 'completed', completedAt: diasAtras(90), services: ['polimento'], carSize: 'gr' },
  // Sujeira que não pode derrubar a conta.
  { status: 'completed', completedAt: 'data-invalida', services: ['lavagem'], carSize: 'pq' },
  { status: 'completed',                               services: ['lavagem'], carSize: 'pq' },
  null,
];

const r = consumoPorDia(agenda, RECEITAS, 60, HOJE);
// shampoo: 100 (lavagem pq) + 80 (polimento gr) = 180 em 60 dias
assert.strictEqual(r.shampoo, 3, '180 ÷ 60 = 3 ml por dia');
assert.strictEqual(r.cera, 200 / 60, 'só o polimento usou cera');
assert.strictEqual(r.mo, (1 + 3) / 60);
assert.strictEqual(Object.keys(r).length, 3, 'nenhum insumo a mais entrou: ' + Object.keys(r));
assert.deepStrictEqual(consumoPorDia([], RECEITAS, 60, HOJE), {}, 'sem venda, sem consumo');
assert.deepStrictEqual(consumoPorDia(null, RECEITAS, 60, HOJE), {});

// Agendamento no futuro (data à frente de hoje) não conta como consumido.
assert.deepStrictEqual(
  consumoPorDia([{ status: 'completed', completedAt: new Date(HOJE.getTime() + 86400000).toISOString(),
                   services: ['lavagem'], carSize: 'pq' }], RECEITAS, 60, HOJE),
  {}, 'concluído com data futura não consumiu ainda');

// ── previsão de compra ─────────────────────────────────────────────────
// 1000 ml, mínimo 200, gastando 3 por dia: (1000-200)/3 = 266 dias.
let pv = previsaoCompra(1000, 200, 3, HOJE);
assert.strictEqual(pv.dias, 266);
assert.strictEqual(pv.jaAbaixo, false);
assert.strictEqual(pv.data.toISOString().slice(0, 10), '2027-08-02');

// Arredonda para BAIXO: prometer um dia a mais é o erro que deixa faltar.
pv = previsaoCompra(100, 0, 30, HOJE);
assert.strictEqual(pv.dias, 3, '100 ÷ 30 = 3,33 → 3 dias');

// Já no mínimo, ou abaixo: comprar agora, não "em 0 dias" como se desse tempo.
pv = previsaoCompra(200, 200, 3, HOJE);
assert.strictEqual(pv.jaAbaixo, true);
assert.strictEqual(pv.dias, 0);
assert.strictEqual(previsaoCompra(50, 200, 3, HOJE).jaAbaixo, true);
assert.strictEqual(previsaoCompra(0, 0, 3, HOJE).jaAbaixo, true);

// Sem consumo medido NÃO é "acaba hoje": é não saber. Devolver null evita a
// tela mandar comprar insumo que ninguém usa.
assert.strictEqual(previsaoCompra(1000, 200, 0, HOJE), null, 'nenhum serviço usou este insumo');
assert.strictEqual(previsaoCompra(1000, 200, undefined, HOJE), null);
assert.strictEqual(previsaoCompra(1000, 200, -1, HOJE), null, 'ritmo negativo não projeta');

// ── saldo contado na unidade de compra ─────────────────────────────────
// Ela conta "17,5 litros", o sistema guarda 17500 ml. A unidade é o litro, não
// a embalagem de 5 L — foi o que o pedido disse: "unidade de compra (kg, L,
// ml, g)".
assert.strictEqual(_spParaUso(17.5, 1000), 17500);
assert.strictEqual(_spParaCompra(17500, 1000), 17.5);
assert.strictEqual(_spParaUso(3.5, 5000), 17500, 'o fator da embalagem ainda serve ao custo');
assert.strictEqual(_spParaCompra(17500, 5000), 3.5);
assert.strictEqual(_spParaCompra(17500, 0), 17500, 'sem fator, o número é o próprio');
assert.strictEqual(_spParaUso(0.25, 1000), 250, 'um quarto de litro');
assert.strictEqual(_spParaCompra(0, 5000), 0);
assert.strictEqual(_spParaUso('', 5000), 0, 'campo vazio não vira NaN no banco');
// Ida e volta fecha, senão abrir e salvar a tela mexeria no saldo sozinho.
[0, 1, 3.5, 0.25, 12.75].forEach(v => {
  assert.strictEqual(_spParaCompra(_spParaUso(v, 5000), 5000), v, 'ida e volta de ' + v);
});

console.log('estoque: consumo pelas vendas e previsão de compra — todos passaram');
