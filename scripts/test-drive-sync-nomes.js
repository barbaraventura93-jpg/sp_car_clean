'use strict';

// Testa o ROTEAMENTO e a VARIEDADE do scripts/drive-sync.gs contra a estrutura
// e os nomes reais do Drive.
//
// Rodar: node scripts/test-drive-sync-nomes.js
//
// Por que existe: o que decide se uma foto entra como resultado, como par de
// antes/depois, ou se não entra, é o nome do arquivo e o nome da pasta. Errar aí
// põe foto de carro sujo na vitrine. O .gs não roda no Node, mas estas funções
// são JS puro — são carregadas daqui e exercitadas com os dados que existem.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Carrega o .gs inteiro e devolve as funções puras. As declarações ficam
// intactas (nada é transformado em expressão), senão uma não veria a outra.
const fonte = fs.readFileSync(path.join(__dirname, 'drive-sync.gs'), 'utf8');
const puras = ['classificar', 'legendaDe', 'limparPrefixos', 'emProcesso', 'intercalar', 'maiuscula', 'baseDoNome'];
const mod = new Function(fonte + '\nreturn {' + puras.join(',') + '};')();
const { classificar, legendaDe, limparPrefixos, emProcesso, intercalar, baseDoNome } = mod;

// ── ruído que o Drive e o WhatsApp acrescentam ─────────────────────────
assert.strictEqual(limparPrefixos('Cópia de fusca-preto depois 3.jpg'), 'fusca-preto depois 3.jpg');
assert.strictEqual(limparPrefixos('Copia de x.jpg'), 'x.jpg', 'sem acento também');
assert.strictEqual(limparPrefixos('Copy of x.jpg'), 'x.jpg');
assert.strictEqual(limparPrefixos('foto (2)'), 'foto');

// ── serviço em andamento não é resultado ───────────────────────────────
assert.strictEqual(emProcesso('fusca-preto em processo de polimento.jpg'), true);
assert.strictEqual(emProcesso('Cópia de polimento em andamento.jpg'), true);
assert.strictEqual(emProcesso('fusca-preto depois 3.jpg'), false);
assert.strictEqual(emProcesso('polimento-fusca-capo-brilho.jpg'), false);

// ── classificação com nomes REAIS do Drive ─────────────────────────────
const casos = [
  ['Up Antes.jpg',                        'up',             'antes'],
  ['Up Depois.jpg',                       'up',             'depois'],
  ['Up Antes costas.jpg',                 'up',             'antes'],  // o verso do mesmo serviço
  ['Cópia de fusca-preto depois 3.jpg',   'fusca-preto',    'depois'],
  ['fusca-preto depois de costas 8.jpg',  'fusca-preto',    'depois'],
  ['roda antes.jpg',                      'roda',           'antes'],
  ['teto-antes.jpg',                      'teto',           'antes'],
  ['limpeza estepe antes 1.jpg',          'limpeza estepe', 'antes'],
  ['Lavagem detalhada Caçamba antes.jpg', 'lavagem detalhada caçamba', 'antes'],
  ['Cópia de IMG-20260806-WA0031.jpeg',   null,             null],
  ['IMG_20261020_095116.jpg',             null,             null],
  ['Cópia de moto-tanque-preto-01.jpg',   null,             null],
  ['polimento-fusca-capo-brilho.jpg',     null,             null],
];
for (const [nome, grupo, lado] of casos) {
  const r = classificar(nome);
  if (grupo === null) assert.strictEqual(r, null, `"${nome}" não deveria classificar: ${JSON.stringify(r)}`);
  else {
    assert.ok(r, `"${nome}" deveria classificar`);
    assert.strictEqual(r.grupo, grupo, `grupo de "${nome}": ${r.grupo}`);
    assert.strictEqual(r.lado, lado, `lado de "${nome}": ${r.lado}`);
  }
}
// O par que de fato existe no Drive dela
assert.strictEqual(classificar('Up Antes.jpg').grupo, classificar('Up Depois.jpg').grupo);

// "Up Antes.jpg" e "Up Antes costas.jpg" caem no MESMO grupo e no mesmo lado.
// O executar() guarda o primeiro e descarta o segundo: o par da frente é usado,
// o do verso é ignorado. Perder uma foto de "antes" não estraga nada — o que
// não podia acontecer era um "antes" virar resultado.
const a1 = classificar('Up Antes.jpg'), a2 = classificar('Up Antes costas.jpg');
assert.strictEqual(a1.grupo, a2.grupo);
assert.strictEqual(a1.lado, a2.lado);
// E "Up Depois (costas).jpg" não classifica (os parênteses não casam), então vai
// ao carrossel como resultado — que é o que ela é.
assert.strictEqual(classificar('Up Depois (costas).jpg'), null);

// ── legenda: a PASTA manda, porque a pasta é o serviço ─────────────────
assert.strictEqual(legendaDe('Polimento Carro', 'IMG_20261020_095116.jpg'), 'Polimento Carro',
  'nome de câmera não acrescenta nada: fica só o serviço');
assert.strictEqual(legendaDe('Polimento Carro', 'Cópia de fusca-preto depois 3.jpg'),
  'Polimento Carro — Fusca preto', 'o arquivo diz o carro, e isso entra');
assert.strictEqual(legendaDe('Lavagem Detalhada Carros', 'Up Depois.jpg'),
  'Lavagem Detalhada Carros — Up');
assert.strictEqual(legendaDe('Polimento Carro', 'polimento carro.jpg'), 'Polimento Carro',
  'arquivo repetindo a pasta não duplica a legenda');
assert.strictEqual(legendaDe('', 'IMG_1234.jpg'), 'SP Car Clean', 'sem pasta e sem nome útil');
assert.strictEqual(legendaDe('Hidrofast', 'Cópia de IMG-20260806-WA0031.jpeg'), 'Hidrofast');

// ── variedade do carrossel: intercala serviços ─────────────────────────
const foto = (n) => ({ id: 'id-' + n, nome: n + '.jpg' });
const porPasta = {
  'Polimento Carro':          { pasta: { nome: 'Polimento Carro' },          fotos: [foto('pc1'), foto('pc2'), foto('pc3'), foto('pc4')] },
  'Lavagem Detalhada Carros': { pasta: { nome: 'Lavagem Detalhada Carros' }, fotos: [foto('ld1'), foto('ld2')] },
  'Polimento Moto':           { pasta: { nome: 'Polimento Moto' },           fotos: [foto('pm1')] },
};
const esc = intercalar(porPasta, 2, 12);
const servicos = esc.map((x) => x.pasta.nome);
// Primeira rodada: uma de cada pasta, em ordem alfabética. Só então a segunda.
assert.deepStrictEqual(servicos.slice(0, 3),
  ['Lavagem Detalhada Carros', 'Polimento Carro', 'Polimento Moto'],
  'a primeira rodada pega uma de cada serviço: ' + JSON.stringify(servicos));
assert.strictEqual(esc.length, 5, 'teto de 2 por pasta: 2+2+1 = 5, não 7');
const contagem = {};
servicos.forEach((s) => { contagem[s] = (contagem[s] || 0) + 1; });
assert.ok(Object.values(contagem).every((n) => n <= 2), 'nenhum serviço passa de 2: ' + JSON.stringify(contagem));
// Teto geral respeitado
assert.strictEqual(intercalar(porPasta, 5, 3).length, 3, 'teto geral corta');

// O caso REAL do Drive hoje: uma pasta só, com 10 fotos nomeadas "depois".
// Com teto 2 o carrossel teria duas fotos — menos que as 8 estáticas que o site
// já mostrava. Com 4 ele enche razoavelmente, e a variedade volta sozinha
// quando outras pastas tiverem fotos nomeadas.
const umaPasta = {
  'Lavagem Detalhada Carros': {
    pasta: { nome: 'Lavagem Detalhada Carros' },
    fotos: Array.from({ length: 10 }, (_, i) => foto('fusca-preto depois ' + (i + 1))),
  },
};
assert.strictEqual(intercalar(umaPasta, 2, 12).length, 2, 'teto 2 sufocaria: só 2 fotos');
assert.strictEqual(intercalar(umaPasta, 4, 12).length, 4, 'teto 4 dá 4 — o escolhido');
// E com várias pastas o teto não atrapalha a variedade: a 1ª rodada é uma de
// cada. (`umaPasta` usa a mesma chave de `porPasta`, então o merge dá 3 pastas —
// é o número de pastas que define o tamanho da 1ª rodada, não o teto.)
const varias = Object.assign({}, porPasta, umaPasta);
const nPastas = Object.keys(varias).length;
const primeiraRodada = intercalar(varias, 4, 12).slice(0, nPastas).map((x) => x.pasta.nome);
assert.strictEqual(new Set(primeiraRodada).size, nPastas,
  'a 1ª rodada pega uma de cada pasta: ' + primeiraRodada);
// Sem o intercalar, as 4 primeiras seriam todas de "Polimento Carro" — é
// exatamente isso que o teto por pasta evita.
assert.notDeepStrictEqual(servicos.slice(0, 4),
  ['Polimento Carro', 'Polimento Carro', 'Polimento Carro', 'Polimento Carro']);

// ── o caso que não pode falhar nunca ───────────────────────────────────
// Pasta cujo nome termina em "antes": nada dela vira resultado.
const soAntes = /\bantes\s*$/i;
assert.strictEqual(soAntes.test('Projeto PickupCorsa Uva Antes'), true,
  'a pasta de projeto "Antes" é reconhecida como só-antes');
assert.strictEqual(soAntes.test('Polimento Carro'), false);
assert.strictEqual(soAntes.test('Lavagem Detalhada Motos'), false);
assert.strictEqual(soAntes.test('Retirada de Insulfilm'), false);

// ── organização (b): subpastas Antes/Depois ────────────────────────────
// Aqui o nome do arquivo não precisa dizer nada: a subpasta diz. O pareamento é
// pelo nome base, e tem que casar nos dois sentidos.
assert.strictEqual(baseDoNome('Fusca 1.jpg'), 'fusca 1');
assert.strictEqual(baseDoNome('Cópia de Fusca 1.jpg'), 'fusca 1', 'ruído do Drive não quebra o par');
assert.strictEqual(baseDoNome('Fusca antes.jpg'), 'fusca', 'a palavra sai do nome base');
assert.strictEqual(baseDoNome('Fusca depois.jpg'), 'fusca');
assert.strictEqual(baseDoNome('Fusca antes.jpg'), baseDoNome('Fusca depois.jpg'),
  'dentro das subpastas, "Fusca antes" e "Fusca depois" ainda casam');
assert.strictEqual(baseDoNome('fusca-preto de costas 8.jpg'), 'fusca preto 8');
assert.strictEqual(baseDoNome('IMG_20261020_095116.jpg'), 'img 20261020 095116',
  'nome de câmera também pareia, se o mesmo nome estiver nas duas subpastas');
assert.notStrictEqual(baseDoNome('Fusca 1.jpg'), baseDoNome('Fusca 2.jpg'),
  'numeração diferente é processo diferente');

// ── A REGRA: o nome declara, o script não adivinha ─────────────────────
// Reproduz a decisão do ramo (a) do executar().
function rotear(arquivos, pastaSoAntes) {
  const grupos = {}, carrossel = [], fora = [];
  for (const nome of arquivos) {
    const ext = nome.split('.').pop().toLowerCase();
    if (!['jpg','jpeg','png','webp'].includes(ext)) { fora.push(nome); continue; }
    if (emProcesso(nome)) { fora.push(nome); continue; }
    const m = classificar(nome);
    if (!m) { fora.push(nome); continue; }          // nome não declara: não entra
    grupos[m.grupo] = grupos[m.grupo] || {};
    if (!grupos[m.grupo][m.lado]) grupos[m.grupo][m.lado] = nome;
    else if (m.lado === 'depois' && !pastaSoAntes) carrossel.push(nome);
  }
  const pares = [];
  for (const g of Object.keys(grupos)) {
    const x = grupos[g];
    if (x.antes && x.depois) pares.push(g);
    else if (x.depois && !pastaSoAntes) carrossel.push(x.depois);
    else fora.push(x.antes || x.depois);
  }
  return { pares, carrossel, fora };
}

// Nome de câmera NÃO ENTRA. É a regra mais importante do arquivo.
const r1 = rotear([
  'IMG_20261020_095116.jpg',
  'Cópia de IMG-20260806-WA0031.jpeg',
  'Cópia de moto-tanque-preto-01.jpg',
  'polimento-fusca-capo-brilho.jpg',
  'roda-chrome-01.jpg',
]);
assert.deepStrictEqual(r1.pares, [], 'nenhum par');
assert.deepStrictEqual(r1.carrossel, [], 'nome de câmera NÃO vai ao carrossel');
assert.strictEqual(r1.fora.length, 5, 'as cinco ficam de fora');

// "depois" sem par vai ao carrossel; "antes" sem par não vai a lugar nenhum.
const r2 = rotear([
  'Cópia de fusca-preto depois 3.jpg',
  'fusca-preto depois 1.jpg',
  'roda antes.jpg',
  'teto-antes.jpg',
]);
assert.deepStrictEqual(r2.pares, []);
assert.strictEqual(r2.carrossel.length, 2, 'as duas "depois" entram: ' + JSON.stringify(r2.carrossel));
assert.ok(r2.carrossel.every((n) => /depois/i.test(n)), 'tudo no carrossel tem "depois" no nome');
assert.ok(r2.fora.includes('roda antes.jpg') && r2.fora.includes('teto-antes.jpg'),
  '"antes" sozinho fica fora');

// Par completo vira cartão, e não aparece também no carrossel.
const r3 = rotear(['Up Antes.jpg', 'Up Depois.jpg', 'fusca-preto depois 5.jpg']);
assert.deepStrictEqual(r3.pares, ['up'], 'o par vira cartão');
assert.deepStrictEqual(r3.carrossel, ['fusca-preto depois 5.jpg'],
  'o par NÃO se repete no carrossel: ' + JSON.stringify(r3.carrossel));

// Pasta cujo nome termina em "antes": nem o "depois" de dentro entra.
const r4 = rotear(['Corsa depois.jpg'], true);
assert.deepStrictEqual(r4.carrossel, [], 'pasta de "antes" não alimenta o carrossel');

// Serviço em andamento fica fora mesmo tendo nome informativo.
const r5 = rotear(['fusca-preto em processo de polimento.jpg']);
assert.deepStrictEqual(r5.carrossel, []);
assert.strictEqual(r5.fora.length, 1);

console.log('drive-sync (nomes, legendas, variedade, subpastas e a regra): todos os testes passaram');
