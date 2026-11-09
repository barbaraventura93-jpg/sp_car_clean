'use strict';

// Testa a CONTA do custo de insumo (app.js: _spCustoDerivado, _spPrecoInicial,
// _spArredonda, _spMoeda).
//
// Rodar: node scripts/test-estoque-custo.js
//
// Por que existe: o pedido foi "eu compro em galão de 5 l e sei o preço do galão
// de 5 l, não deveria ter que ficar fazendo a conversão". O número que as
// receitas leem (`costPerUnit`) passou a ser DERIVADO dessa divisão. Errar aqui
// erra o custo de todo serviço que usa o insumo — e erra calado, porque o preço
// na tela continuaria parecendo certo.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function recortar(re, oque) {
  const m = fonte.match(re);
  assert.ok(m, 'não achei ' + oque + ' no app.js — o teste precisa ser atualizado');
  return m[0];
}
const puras = ['_spArredonda', '_spCustoDerivado', '_spPrecoInicial', '_spMoeda']
  .map(n => recortar(new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}'), n))
  .join('\n');
const { _spArredonda, _spCustoDerivado, _spPrecoInicial, _spMoeda } =
  new Function(puras + '\nreturn { _spArredonda, _spCustoDerivado, _spPrecoInicial, _spMoeda };')();

// ── o caso exato do pedido ─────────────────────────────────────────────
// "compro em galão de 5 l e sei o preço do galão de 5 l"
assert.strictEqual(_spCustoDerivado(180, 5000), 0.036, 'galão de 5L a R$180 → R$0,036/ml');
// Antes era isto que ela tinha que digitar à mão, com passo de 0,0001:
assert.strictEqual(Number((180 / 5000).toFixed(4)), 0.036, 'o número que ela calculava na mão');

// ── outros formatos de compra que aparecem no estoque dela ─────────────
assert.strictEqual(_spCustoDerivado(45, 1000), 0.045, 'litro a R$45');
assert.strictEqual(_spCustoDerivado(89.9, 500), 0.1798, 'frasco de 500ml');
assert.strictEqual(_spCustoDerivado(35, 1), 35, 'hora de mão de obra: fator 1');
assert.strictEqual(_spCustoDerivado(1200, 20000), 0.06, 'bombona de 20L');

// ── sem como derivar é DIFERENTE de derivar zero ───────────────────────
// Isto é o que protege o custo salvo: null faz o salvamento manter o valor que
// a pessoa informou, em vez de gravar 0 e zerar o custo das receitas.
assert.strictEqual(_spCustoDerivado(0, 5000), null, 'sem preço');
assert.strictEqual(_spCustoDerivado(180, 0), null, 'sem conversão');
assert.strictEqual(_spCustoDerivado(0, 0), null, 'sem nada');
assert.strictEqual(_spCustoDerivado(NaN, 5000), null, 'campo vazio virando NaN');
assert.strictEqual(_spCustoDerivado(180, NaN), null, 'conversão vazia');
assert.strictEqual(_spCustoDerivado(-180, 5000), null, 'preço negativo não deriva');
assert.strictEqual(_spCustoDerivado(180, -5000), null, 'conversão negativa não deriva');

// ── ruído de ponto flutuante não vaza para o banco ─────────────────────
// 0.1 + 0.2 do mundo do dinheiro: sem arredondar, 29.9/700 dá 0.042714285714...
const c = _spCustoDerivado(29.9, 700);
assert.ok(String(c).length <= 10, 'valor curto o bastante para um campo de dinheiro: ' + c);
assert.strictEqual(c, 0.042714, 'arredondado em 6 casas');
assert.strictEqual(_spArredonda(1 / 3), 0.333333);
assert.strictEqual(_spArredonda(0.036), 0.036, 'valor exato não é alterado');

// ── seis casas são suficientes para o insumo mais barato do estoque ────
// O mais barato hoje é R$0,01/ml (pretinho, flotador). Mesmo um insumo 100x
// mais barato que isso sobreviveria ao arredondamento.
assert.strictEqual(_spCustoDerivado(50, 500000), 0.0001, 'R$0,0001/ml ainda é representável');

// ── reabrir a tela: o preço aparece, o custo salvo NÃO muda ────────────
// Produto salvo pelo caminho novo: mostra o preço guardado.
assert.strictEqual(_spPrecoInicial({ purchasePrice: 180, purchaseConversionFactor: 5000, costPerUnit: 0.036 }), 180);
// Produto antigo COM conversão: reconstitui o preço como referência.
assert.strictEqual(_spPrecoInicial({ purchaseConversionFactor: 5000, costPerUnit: 0.03 }), 150,
  'R$0,03/ml × 5000ml = R$150 o galão');
// E reconstituir e derivar de volta tem que fechar, senão abrir a tela mexeria
// no custo de um produto que ninguém pediu para mudar.
const antigo = { purchaseConversionFactor: 5000, costPerUnit: 0.03 };
assert.strictEqual(_spCustoDerivado(_spPrecoInicial(antigo), antigo.purchaseConversionFactor),
  antigo.costPerUnit, 'ida e volta fecha');
// Produto antigo SEM conversão (granel, mão de obra): campo de preço vazio.
assert.strictEqual(_spPrecoInicial({ costPerUnit: 35 }), '', 'sem conversão, sem preço a mostrar');
assert.strictEqual(_spPrecoInicial({}), '', 'produto novo');
assert.strictEqual(_spPrecoInicial({ purchaseConversionFactor: 5000 }), '', 'conversão sem custo');

// ── a nota de conferência mostra casas suficientes para não dizer zero ─
assert.strictEqual(_spMoeda(0.036), '0,0360');
assert.strictEqual(_spMoeda(35), '35,0000');
// R$0,00004/ml em 4 casas seria "0,0000", que não informa nada.
assert.strictEqual(_spMoeda(0.00004), '0,00004', 'abre casas até o número aparecer');
assert.strictEqual(_spMoeda(0), '0,0000', 'zero não entra em laço infinito');

console.log('estoque: a conta do custo pela unidade de compra — todos passaram');
