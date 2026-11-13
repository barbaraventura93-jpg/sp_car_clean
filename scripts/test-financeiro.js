'use strict';

// Testa receita × custo × lucro do relatório semanal
// (functions/lib/core/financeiro.js).
//
// Rodar: node scripts/test-financeiro.js
//
// Por que existe: o pedido foi incluir "análise receita x custos x lucro" no
// relatório semanal, que é usado de verdade. É um número para decidir preço.
// Errar o custo para menos infla o lucro e faz cobrar de menos sem ninguém
// perceber — o erro não aparece em lugar nenhum até a conta do mês não fechar.

const assert = require('assert');
const fin = require('../functions/lib/core/financeiro.js');

const SVCS = {
  lavagem:   { name: 'Lavagem',   pricing: { pq: { cost: 58.50,  sale: 180 }, gr: { cost: 75,  sale: 300 } } },
  polimento: { name: 'Polimento', pricing: { pq: { cost: 240.40, sale: 320 }, gr: { cost: 400, sale: 520 } } },
  // Serviço sem insumos cadastrados: custo zero. O caso que infla o lucro.
  vidros:    { name: 'Vidros',    pricing: { pq: { cost: 0,      sale: 120 }, gr: { cost: 0,   sale: 180 } } },
};

// ── receita: o pago vence o preço de tabela ────────────────────────────
assert.strictEqual(fin.receitaDoAgendamento({ price: 300 }), 300);
assert.strictEqual(fin.receitaDoAgendamento({ price: 300, finalPrice: 270 }), 270, 'desconto aplicado');
assert.strictEqual(fin.receitaDoAgendamento({ price: 300, finalPrice: 270, paidAmount: 250 }), 250,
  'o que entrou no caixa manda');
assert.strictEqual(fin.receitaDoAgendamento({}), 0);
assert.strictEqual(fin.receitaDoAgendamento(null), 0);
assert.strictEqual(fin.receitaDoAgendamento({ price: 'abc' }), 0, 'lixo não vira NaN na receita');

// ── custo pelo porte do carro ──────────────────────────────────────────
assert.deepStrictEqual(fin.custoDoAgendamento({ services: ['lavagem'], carSize: 'pq' }, SVCS),
  { custo: 58.5, semCusto: [] });
assert.deepStrictEqual(fin.custoDoAgendamento({ services: ['lavagem'], carSize: 'gr' }, SVCS),
  { custo: 75, semCusto: [] }, 'carro grande custa mais');
assert.deepStrictEqual(fin.custoDoAgendamento({ services: ['lavagem', 'polimento'], carSize: 'pq' }, SVCS),
  { custo: 298.9, semCusto: [] }, 'soma os serviços do agendamento');
assert.deepStrictEqual(fin.custoDoAgendamento({ service: 'lavagem' }, SVCS),
  { custo: 58.5, semCusto: [] }, 'agendamento antigo de serviço único, sem porte → pequeno');

// ── o que NÃO pode passar calado: serviço sem custo ────────────────────
// Custo zero vira lucro inflado. Quem chama precisa saber QUAIS serviços,
// senão o relatório afirma uma margem que não existe.
const semC = fin.custoDoAgendamento({ services: ['lavagem', 'vidros'], carSize: 'pq' }, SVCS);
assert.strictEqual(semC.custo, 58.5, 'o que tem custo entra');
assert.deepStrictEqual(semC.semCusto, ['vidros'], 'e o que não tem é denunciado');
assert.deepStrictEqual(fin.custoDoAgendamento({ services: ['fantasma'], carSize: 'pq' }, SVCS),
  { custo: 0, semCusto: ['fantasma'] }, 'serviço fora do catálogo também');
assert.deepStrictEqual(fin.custoDoAgendamento({ services: ['lavagem'] }, null),
  { custo: 0, semCusto: ['lavagem'] }, 'sem catálogo, nada é inventado');

// ── resumo do período ──────────────────────────────────────────────────
const semana = [
  { services: ['lavagem'],              carSize: 'pq', price: 180 },
  { services: ['polimento'],            carSize: 'gr', price: 520, paidAmount: 500 },
  { services: ['lavagem', 'polimento'], carSize: 'pq', price: 500 },
];
const r = fin.resumoFinanceiro(semana, SVCS);
assert.strictEqual(r.receita, 1180, '180 + 500 pago + 500');
assert.strictEqual(r.custo, 58.5 + 400 + 298.9);
assert.strictEqual(r.lucro, Math.round((1180 - (58.5 + 400 + 298.9)) * 100) / 100);
assert.strictEqual(r.margem, Math.round(r.lucro / r.receita * 100));
assert.strictEqual(r.agendamentos, 3);
assert.strictEqual(r.servicos, 4, 'quatro serviços em três agendamentos');
assert.deepStrictEqual(r.semCusto, [], 'todos com custo');

// Semana com um serviço sem custo: o aviso tem que subir.
const r2 = fin.resumoFinanceiro([{ services: ['vidros'], carSize: 'pq', price: 120 }], SVCS);
assert.strictEqual(r2.custo, 0);
assert.strictEqual(r2.lucro, 120);
assert.strictEqual(r2.margem, 100, 'margem de 100% é o sintoma...');
assert.deepStrictEqual(r2.semCusto, ['vidros'], '...e esta é a explicação dele');

// Cada serviço sem custo aparece UMA vez, por mais agendamentos que tenha.
const r3 = fin.resumoFinanceiro([
  { services: ['vidros'], carSize: 'pq', price: 120 },
  { services: ['vidros'], carSize: 'gr', price: 180 },
], SVCS);
assert.deepStrictEqual(r3.semCusto, ['vidros'], 'sem repetir o nome no aviso');

// ── semana vazia não vira divisão por zero nem "margem 0%" ─────────────
const vazio = fin.resumoFinanceiro([], SVCS);
assert.strictEqual(vazio.receita, 0);
assert.strictEqual(vazio.lucro, 0);
assert.strictEqual(vazio.margem, null, 'sem venda não há margem — null, não zero');
assert.strictEqual(fin.resumoFinanceiro(null, SVCS).agendamentos, 0);

// ── prejuízo é um resultado possível e tem que aparecer ────────────────
const prej = fin.resumoFinanceiro([{ services: ['polimento'], carSize: 'gr', price: 300 }], SVCS);
assert.strictEqual(prej.lucro, -100, 'vendeu a 300 o que custa 400');
assert.ok(prej.margem < 0, 'margem negativa: ' + prej.margem);

// ── variação ───────────────────────────────────────────────────────────
assert.strictEqual(fin.variacao(110, 100), 10);
assert.strictEqual(fin.variacao(90, 100), -10);
assert.strictEqual(fin.variacao(100, 0), null, 'crescer a partir de zero não é "+100%"');
assert.strictEqual(fin.variacao(0, 0), null);
assert.strictEqual(fin.variacao(50, 100), -50);

console.log('financeiro: receita, custo e lucro da semana — todos passaram');
