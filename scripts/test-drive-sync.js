'use strict';

// Testes da validação do /api/drive-sync. Sem rede.
//
// Rodar: node scripts/test-drive-sync.js
//
// O que importa aqui: o que chega neste endpoint vai para um bucket servido ao
// público. Então o tipo do arquivo é decidido pelos BYTES, não pelo nome nem por
// um campo do corpo — nome e campo são escritos por quem chama.

const assert = require('assert');
const { _interno } = require('../functions/drive-sync.js');
const { validarFoto, tipoPelosBytes, chaveS3, idDriveValido, textoCurto, segredoConfere, FOTO_MAX_BYTES } = _interno;

const b64 = (buf) => Buffer.from(buf).toString('base64');
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 7)]);
const PNG  = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(200, 7)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(200, 7)]);
const ID = 'A'.repeat(33);

// ── tipo pelos bytes ───────────────────────────────────────────────────
assert.strictEqual(tipoPelosBytes(JPEG), 'image/jpeg');
assert.strictEqual(tipoPelosBytes(PNG), 'image/png');
assert.strictEqual(tipoPelosBytes(WEBP), 'image/webp');
assert.strictEqual(tipoPelosBytes(Buffer.from('<?php echo 1; ?>')), null, 'não é imagem');
assert.strictEqual(tipoPelosBytes(Buffer.from('GIF89a')), null, 'GIF não entra');
assert.strictEqual(tipoPelosBytes(Buffer.alloc(2)), null, 'curto demais');

// ── validação da foto ──────────────────────────────────────────────────
const ok = validarFoto({ arquivoId: ID, nome: 'fusca.jpg', conteudoBase64: b64(JPEG) }, 'foto');
assert.strictEqual(ok.ext, 'jpg');
assert.strictEqual(ok.tipo, 'image/jpeg');

// Nome mentindo sobre o conteúdo: manda .jpg, bytes de PNG -> vale o byte.
const mentiu = validarFoto({ arquivoId: ID, nome: 'foto.jpg', conteudoBase64: b64(PNG) }, 'foto');
assert.strictEqual(mentiu.ext, 'png', 'o nome não decide o tipo, os bytes decidem');

// Conteúdo que não é imagem é recusado, mesmo com nome de imagem.
assert.match(
  validarFoto({ arquivoId: ID, nome: 'inocente.jpg', conteudoBase64: b64(Buffer.from('<svg onload=alert(1)>')) }, 'foto').erro,
  /não parece JPEG/, 'SVG/HTML disfarçado de jpg é recusado');

assert.match(validarFoto({ arquivoId: 'curto', conteudoBase64: b64(JPEG) }, 'foto').erro, /arquivoId inválido/);
assert.match(validarFoto({ arquivoId: ID }, 'foto').erro, /conteudoBase64 ausente/);
// String não vazia que decodifica para nada — é o caso real do "vazio".
// (base64 de buffer vazio é string vazia, e essa cai na checagem anterior.)
assert.match(validarFoto({ arquivoId: ID, conteudoBase64: '!!!!' }, 'foto').erro, /vazio/);
assert.match(validarFoto({ arquivoId: ID, conteudoBase64: '' }, 'foto').erro, /ausente/);
assert.match(validarFoto(null, 'antes').erro, /^antes: ausente/, 'o rótulo diz qual lado falhou');

// Teto por foto: é o que impede o script de mandar o original de 23 MB.
const gigante = Buffer.concat([JPEG, Buffer.alloc(FOTO_MAX_BYTES, 9)]);
assert.match(validarFoto({ arquivoId: ID, conteudoBase64: b64(gigante) }, 'foto').erro,
  /acima do teto/, 'original grande é recusado com mensagem acionável');

// ── id do Drive ────────────────────────────────────────────────────────
assert.strictEqual(idDriveValido('1Cd1_YDE_XU_FyBh-GZ0lATQ2r83eOKxE'), true);
assert.strictEqual(idDriveValido('../../config'), false, 'não escapa do nó');
assert.strictEqual(idDriveValido('abc'), false, 'curto demais');
assert.strictEqual(idDriveValido('a'.repeat(201)), false, 'longo demais');
assert.strictEqual(idDriveValido(null), false);

// ── chave no bucket ────────────────────────────────────────────────────
const c1 = chaveS3('Fusca Preto depois 1.jpg', 'jpg');
assert.match(c1, /^media\/gallery\/\d+_drive_Fusca-Preto-depois-1_[0-9a-f]{12}\.jpg$/, c1);
assert.match(chaveS3('revitalização.jpg', 'jpg'), /_drive_revitalizacao_/, 'acento sai do nome do objeto');
// Entrada hostil: o que importa não é o nome que sobra, é a chave continuar
// dentro de media/gallery/ sem barra nenhuma a mais. Neste caso nada da entrada
// sobrevive e cai no padrão 'foto' — mais seguro do que eu havia previsto.
for (const hostil of ['../../etc/passwd', '/etc/passwd', 'a/b/c.jpg', '..', './../x']) {
  const k = chaveS3(hostil, 'jpg');
  assert.ok(k.startsWith('media/gallery/'), `prefixo preservado para ${hostil}: ${k}`);
  assert.strictEqual(k.split('/').length, 3, `nenhuma barra extra para ${hostil}: ${k}`);
  assert.ok(!k.includes('..'), `sem .. para ${hostil}: ${k}`);
}
assert.match(chaveS3('', 'jpg'), /_drive_foto_/, 'sem nome, cai no padrão');
// Duas chamadas com o mesmo nome não colidem.
assert.notStrictEqual(chaveS3('x.jpg','jpg'), chaveS3('x.jpg','jpg'));

// ── legenda ────────────────────────────────────────────────────────────
assert.strictEqual(textoCurto('  Polimento \n do Fusca  '), 'Polimento   do Fusca');
assert.strictEqual(textoCurto('x'.repeat(300)).length, 160, 'legenda truncada');
assert.strictEqual(textoCurto(null), '');

// ── segredo em tempo constante ─────────────────────────────────────────
assert.strictEqual(segredoConfere('abc123', 'abc123'), true);
assert.strictEqual(segredoConfere('abc123', 'abc124'), false);
assert.strictEqual(segredoConfere('abc', 'abc123'), false, 'tamanho diferente não estoura');
assert.strictEqual(segredoConfere('', 'abc123'), false);
assert.strictEqual(segredoConfere(undefined, 'abc123'), false);
assert.strictEqual(segredoConfere('abc123', ''), false, 'segredo vazio no servidor não libera');

console.log('drive-sync: todos os testes passaram');
