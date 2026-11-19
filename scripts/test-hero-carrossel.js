'use strict';

// Testa o PISO do carrossel do hero (_heroMedia no app.js).
//
// Rodar: node scripts/test-hero-carrossel.js
//
// Por que existe: o carrossel era ou/ou — `media.length ? media : HERO_FALLBACK`.
// Enquanto /portfolio ficava vazio ninguém percebia, porque as 7 fotos estáticas
// apareciam. A sincronização do Drive quebra esse silêncio: a primeira rodada
// grava 2 fotos e o carrossel cairia de 7 para 2, tirando acervo bom do ar sem
// ninguém pedir. Este teste fixa a regra nova: as estáticas são o piso.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Carrega só o HERO_FALLBACK e a _heroMedia do app.js (que é um arquivo de
// navegador e não dá para exigir inteiro no Node).
const fonte = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function recortar(re, oque) {
  const m = fonte.match(re);
  assert.ok(m, 'não achei ' + oque + ' no app.js — o teste precisa ser atualizado');
  return m[0];
}
const trechoFallback = recortar(/const HERO_FALLBACK = \[[\s\S]*?\n\];/, 'HERO_FALLBACK');
const trechoHeroMedia = recortar(/function _heroMedia\(val\) \{[\s\S]*?\n\}/, '_heroMedia');
const { HERO_FALLBACK, _heroMedia } = new Function(
  trechoFallback + '\n' + trechoHeroMedia + '\nreturn { HERO_FALLBACK, _heroMedia };')();

const N = HERO_FALLBACK.length;
assert.strictEqual(N, 7, 'o site tem 7 fotos estáticas; se mudou, confira este teste');

const srcs = (ms) => ms.map((m) => m.src);

// ── nó vazio: só as estáticas ──────────────────────────────────────────
assert.deepStrictEqual(srcs(_heroMedia(null)), srcs(HERO_FALLBACK), 'nó nulo');
assert.deepStrictEqual(srcs(_heroMedia({})), srcs(HERO_FALLBACK), 'nó vazio');

// ── o caso que ia acontecer amanhã: 2 fotos do Drive ───────────────────
// O ensaio real escolheu duas fotos do mesmo Fusca. Antes, o carrossel viraria
// essas duas e as 7 sairiam. Agora são 9, com as novas na frente.
const doDrive = {
  drive_a: { url: 'https://cdn/x/fusca-1.webp', caption: 'Lavagem Detalhada Carros — Fusca preto', createdAt: 2000 },
  drive_b: { url: 'https://cdn/x/fusca-2.webp', caption: 'Lavagem Detalhada Carros — Fusca preto', createdAt: 1000 },
};
const comDrive = _heroMedia(doDrive);
assert.strictEqual(comDrive.length, 2 + N, 'as 7 estáticas continuam no ar');
assert.deepStrictEqual(srcs(comDrive).slice(0, 2),
  ['https://cdn/x/fusca-1.webp', 'https://cdn/x/fusca-2.webp'], 'mais novas primeiro');
assert.deepStrictEqual(srcs(comDrive).slice(2), srcs(HERO_FALLBACK), 'estáticas no fim, na ordem');
HERO_FALLBACK.forEach((m) => assert.ok(srcs(comDrive).includes(m.src), 'não perdeu ' + m.src));

// ── ordenação por createdAt, não pela ordem das chaves ─────────────────
const foraDeOrdem = _heroMedia({
  z: { url: 'u/velha.webp', createdAt: 1 },
  a: { url: 'u/nova.webp', createdAt: 9 },
});
assert.deepStrictEqual(srcs(foraDeOrdem).slice(0, 2), ['u/nova.webp', 'u/velha.webp']);

// ── estáticas assumidas pelo painel: o piso sai de cena ────────────────
// Depois de "Importar as fotos atuais do site", as 7 são registros normais.
// Remover uma pelo painel tem que remover DE VERDADE — sem o piso repondo.
const assumidas = {};
HERO_FALLBACK.forEach((m, i) => { assumidas['k' + i] = { url: m.src, caption: m.alt, createdAt: 500 - i }; });
assert.strictEqual(_heroMedia(assumidas).length, N, 'assumidas: nada é reposto nem duplicado');

const umaRemovida = Object.assign({}, assumidas);
delete umaRemovida.k3;
const depoisDeRemover = _heroMedia(umaRemovida);
assert.strictEqual(depoisDeRemover.length, N - 1, 'remover pelo painel remove de verdade');
assert.ok(!srcs(depoisDeRemover).includes(HERO_FALLBACK[3].src), 'a removida não volta');

// E com as assumidas convivendo com as do Drive, nada duplica.
const misto = Object.assign({ drive_a: { url: 'https://cdn/x/fusca-1.webp', createdAt: 9000 } }, assumidas);
const rMisto = _heroMedia(misto);
assert.strictEqual(rMisto.length, N + 1);
assert.strictEqual(new Set(srcs(rMisto)).size, N + 1, 'sem duplicata');

// ── vídeo do painel continua marcado como vídeo ────────────────────────
const comVideo = _heroMedia({ v: { url: 'u/clipe.mp4', type: 'video', createdAt: 1 } });
assert.strictEqual(comVideo[0].type, 'video');
assert.strictEqual(comVideo[1].type, undefined, 'foto estática não é vídeo');

// ── legenda ausente não deixa alt vazio ────────────────────────────────
assert.strictEqual(_heroMedia({ s: { url: 'u/a.webp', createdAt: 1 } })[0].alt, 'SP Car Clean');

console.log('hero: o piso das 7 fotos estáticas se mantém — todos passaram');
