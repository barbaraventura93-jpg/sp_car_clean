'use strict';

// Testa as regras puras do scripts/copias-web.gs: quem ganha cópia reduzida,
// quando a cópia é recusada e a leitura do tamanho da imagem.
//
// Rodar: node scripts/test-copias-web.js
//
// Por que existe: o script grava arquivos no Drive da Bárbara. Errar a regra
// faria cópia de cópia (pasta _web percorrida), cópia duplicada a cada rodada,
// ou cópia pequena demais para post. O .gs não roda no Node, mas estas funções
// são JS puro — são carregadas daqui, como no test-drive-sync-nomes.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, 'copias-web.gs'), 'utf8');
const puras = ['ehPastaWeb', 'precisaDeCopia', 'urlMiniatura', 'motivoParaPular', 'dimensoes',
  'LIMITE_BYTES', 'LARGURA', 'LADO_MINIMO'];
const mod = new Function(fonte + '\nreturn {' + puras.join(',') + '};')();
const { ehPastaWeb, precisaDeCopia, urlMiniatura, motivoParaPular, dimensoes, LIMITE_BYTES } = mod;

const MB = 1024 * 1024;

// ── o limite fica abaixo dos 10 MB do conector ─────────────────────────
assert.ok(LIMITE_BYTES <= 10 * MB, 'acima de 10 MiB o conector recusa: o limite não pode passar disso');
assert.ok(mod.LARGURA >= 2600, 'a cópia não pode ser menor que o teto que os scripts de arte usam');

// ── quem ganha cópia ───────────────────────────────────────────────────
const foto = (nome, mb, mime = 'image/jpeg') => ({ nome, bytes: Math.round(mb * MB), mime });

// Tamanhos reais do Drive em 17/11/2026.
assert.strictEqual(precisaDeCopia(({ nome: 'motor mini depois.jpg', bytes: 11561558, mime: 'image/jpeg' }), {}), true, '11 MB não baixa: ganha cópia');
assert.strictEqual(precisaDeCopia(foto('Teto Depois 2.jpg', 14.98), {}), true);
assert.strictEqual(precisaDeCopia(foto('Up Depois (costas).jpg', 4.2), {}), false, 'foto que já baixa não ganha cópia');
assert.strictEqual(precisaDeCopia(({ nome: 'motor mini antes.jpg', bytes: 10091930, mime: 'image/jpeg' }), {}), false,
  '10.091.930 bytes baixou no teste de 17/11: fica sem cópia');
assert.strictEqual(precisaDeCopia(foto('limite.jpg', 10), {}), false, 'exatamente no limite não ganha');

// Rodar de novo não duplica.
assert.strictEqual(precisaDeCopia(foto('Teto Depois 2.jpg', 14.98), { 'Teto Depois 2.jpg': true }), false,
  'se _web já tem o mesmo nome, não cria de novo');
assert.strictEqual(precisaDeCopia(foto('Teto Depois 2.jpg', 14.98), { 'Teto Depois 1.jpg': true }), true,
  'outro nome em _web não conta');

// Vídeo e arquivo que não é imagem ficam fora.
assert.strictEqual(precisaDeCopia(foto('processo.mp4', 80, 'video/mp4'), {}), false, 'vídeo não ganha cópia');
assert.strictEqual(precisaDeCopia(foto('nota.pdf', 12, 'application/pdf'), {}), false);
assert.strictEqual(precisaDeCopia(foto('iphone.heic', 12, 'image/heic'), {}), true,
  'HEIC grande ganha cópia: a miniatura do Google vem em JPEG');
assert.strictEqual(precisaDeCopia(null, {}), false);

// ── a pasta de cópias não é percorrida ─────────────────────────────────
assert.strictEqual(ehPastaWeb('_web'), true);
assert.strictEqual(ehPastaWeb(' _WEB '), true, 'maiúscula e espaço contam');
assert.strictEqual(ehPastaWeb('Lavagem de Motor'), false);
assert.strictEqual(ehPastaWeb('Projeto PickupCorsa Uva Antes'), false);

// ── sufixo de tamanho da miniatura ─────────────────────────────────────
assert.strictEqual(urlMiniatura('https://lh3.googleusercontent.com/abc=s220', 2600),
  'https://lh3.googleusercontent.com/abc=s2600');
assert.strictEqual(urlMiniatura('https://lh3.googleusercontent.com/abc=s220-c', 2600),
  'https://lh3.googleusercontent.com/abc=s2600', 'o recorte -c sai junto: queremos a foto inteira');
assert.strictEqual(urlMiniatura('https://lh3.googleusercontent.com/abc', 2600),
  'https://lh3.googleusercontent.com/abc=s2600');

// ── quando a cópia é recusada ──────────────────────────────────────────
assert.strictEqual(motivoParaPular(900 * 1024, 2600), '', 'cópia de 900 KB e 2600 px serve');
assert.match(motivoParaPular(0, 0), /vazia/);
assert.match(motivoParaPular(11 * MB, 2600), /10 MB/, 'cópia que ainda não baixa não serve');
assert.match(motivoParaPular(80 * 1024, 220), /220 px/, 'miniatura pequena (o padrão do Drive) não serve para post');
assert.strictEqual(motivoParaPular(500 * 1024, 0), '', 'formato que não deu para ler o tamanho não é recusado por isso');

// ── tamanho lido do cabeçalho ──────────────────────────────────────────
// JPEG montado à mão: SOI, um APP0 qualquer, DQT, e o SOF0 com 3456 x 4608.
function jpeg(largura, altura, sof = 0xc0) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sofSeg = [0xff, sof, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return [0xff, 0xd8, ...app0, ...dqt, ...sofSeg, 0xff, 0xd9];
}
assert.deepStrictEqual(dimensoes(jpeg(4608, 3456)), { largura: 4608, altura: 3456 });
assert.deepStrictEqual(dimensoes(jpeg(1950, 2600, 0xc2)), { largura: 1950, altura: 2600 }, 'JPEG progressivo (SOF2)');
// O Apps Script devolve bytes com sinal (-128 a 127): tem de dar o mesmo.
const comSinal = jpeg(2600, 1950).map((x) => (x > 127 ? x - 256 : x));
assert.deepStrictEqual(dimensoes(comSinal), { largura: 2600, altura: 1950 }, 'bytes com sinal do Apps Script');

const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0x0a, 0x28, 0, 0, 0x07, 0x9e, 8, 2, 0, 0, 0];
assert.deepStrictEqual(dimensoes(png), { largura: 2600, altura: 1950 });
assert.strictEqual(dimensoes([1, 2, 3]), null, 'curto demais');
assert.strictEqual(dimensoes(new Array(40).fill(0)), null, 'formato desconhecido');

console.log('test-copias-web: ok');
