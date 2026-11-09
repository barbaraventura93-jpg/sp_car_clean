'use strict';

// Testa a frase de prazo de entrega (app.js: prazoDeEntrega).
//
// Rodar: node scripts/test-prazo-entrega.js
//
// Por que existe: a frase vivia inline no seletor de serviços e era
//   dias===0 ? 'mesmo dia' : dias===1 ? 'dia seguinte' : 'Retirada em 2 dias'
// — ou seja, um serviço configurado para 3, 4 ou 10 dias prometia DOIS ao
// cliente. O campo aceita até 10. Promessa de prazo errada no site é a espécie
// de erro que só aparece quando o cliente volta buscar o carro.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const m = fonte.match(/function prazoDeEntrega\(dias\) \{[\s\S]*?\n\}/);
assert.ok(m, 'não achei prazoDeEntrega no app.js');
const { prazoDeEntrega } = new Function(m[0] + '\nreturn { prazoDeEntrega };')();

assert.strictEqual(prazoDeEntrega(0), 'Entrega no mesmo dia');
assert.strictEqual(prazoDeEntrega(1), 'Retirada no dia seguinte');
assert.strictEqual(prazoDeEntrega(2), 'Retirada em 2 dias');

// O caso que estava errado: tudo acima de 1 dizia "2 dias".
assert.strictEqual(prazoDeEntrega(3), 'Retirada em 3 dias', 'três dias diz três');
assert.strictEqual(prazoDeEntrega(7), 'Retirada em 7 dias');
assert.strictEqual(prazoDeEntrega(10), 'Retirada em 10 dias', 'o campo aceita até 10');

// Valor ausente ou sujo não pode virar frase estranha no site do cliente.
assert.strictEqual(prazoDeEntrega(undefined), 'Entrega no mesmo dia', 'serviço antigo sem o campo');
assert.strictEqual(prazoDeEntrega(null), 'Entrega no mesmo dia');
assert.strictEqual(prazoDeEntrega(''), 'Entrega no mesmo dia');
assert.strictEqual(prazoDeEntrega('2'), 'Retirada em 2 dias', 'veio do input como texto');
assert.strictEqual(prazoDeEntrega(-3), 'Entrega no mesmo dia', 'negativo não vira "-3 dias"');
assert.strictEqual(prazoDeEntrega(1.7), 'Retirada no dia seguinte', 'quebrado não vira "1,7 dias"');

console.log('prazo de entrega: a frase diz o número certo — todos passaram');
