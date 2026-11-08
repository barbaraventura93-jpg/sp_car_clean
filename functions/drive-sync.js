'use strict';

// =====================================================================
// drive-sync — as fotos do site vindas do Google Drive.
//
// Por que existe: a tela de upload do painel depende de a pessoa LEMBRAR de
// voltar ao site depois de já ter jogado as fotos no Drive para o Instagram.
// Tela que depende de lembrar é tela que fica desatualizada. Aqui o Drive é a
// fonte, e o site acompanha sozinho.
//
// Quem chama é um Apps Script na conta Google que é dona das pastas (ver
// scripts/drive-sync.gs). Escolha deliberada: o Apps Script lê o Drive com a
// própria conta, então não existe conta de serviço, nem chave JSON, nem projeto
// no Google Cloud. A documentação do Google recomenda evitar chave de conta de
// serviço justamente para carga que roda fora do Google Cloud — que é o nosso
// caso, a Lambda está na AWS.
//
// NINGUÉM REDIMENSIONA AQUI, de propósito. As funções deste projeto não têm
// dependência de terceiros (o lib/s3.js chega a assinar SigV4 à mão para não
// usar o SDK), e decodificar JPEG exige biblioteca. Então quem reduz é o
// próprio Google: o Apps Script pede a miniatura grande do arquivo, que já vem
// com poucas centenas de KB e sem EXIF. O que chega aqui já está pronto.
//
// AUTENTICAÇÃO: segredo compartilhado no cabeçalho, conferido contra o
// DRIVE_SYNC_SECRET do SSM. Não é token de usuário porque não há usuário: é
// máquina falando com máquina. A comparação é em tempo constante.
//
// POST /api/drive-sync
//   { "op": "estado" }
//       -> { ids: [...] }  ids do Drive já importados, para o script pular
//   { "op": "carrossel", "arquivoId": "...", "nome": "...", "legenda": "...",
//     "conteudoBase64": "..." }
//       -> vira item de /portfolio ("só o depois")
//   { "op": "antes-depois", "legenda": "...",
//     "antes":  { "arquivoId": "...", "nome": "...", "conteudoBase64": "..." },
//     "depois": { "arquivoId": "...", "nome": "...", "conteudoBase64": "..." } }
//       -> vira item de /gallery (o par, junto)
//
// As duas formas são exatamente a regra do negócio: no site só aparecem fotos
// de antes e depois juntas, ou só do depois.
// =====================================================================

const crypto = require('crypto');
const { clientIp, rateLimit, corsHeaders } = require('./lib/guard');

const OPS = new Set(['estado', 'carrossel', 'antes-depois']);

// Teto do corpo. Uma miniatura grande dá ~200–500 KB; em base64, ~1,4x. Um par
// de antes/depois cabe com folga em 4 MB, e o teto protege contra engano no
// script (mandar o original de 23 MB, por exemplo), que o API Gateway recusaria
// de um jeito bem menos claro.
const CORPO_MAX_BYTES = 4 * 1024 * 1024;
const FOTO_MAX_BYTES = 1_200_000;   // por foto, já decodificada
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function reply(statusCode, cors, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Comparação em tempo constante: evita descobrir o segredo byte a byte. */
function segredoConfere(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(String(esperado));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function cabecalho(event, nome) {
  const h = event.headers || {};
  const alvo = nome.toLowerCase();
  for (const [k, v] of Object.entries(h)) if (String(k).toLowerCase() === alvo) return v;
  return '';
}

/** Id de arquivo do Drive: só o alfabeto que o Google usa. */
function idDriveValido(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id);
}

function textoCurto(s, max = 160) {
  return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/**
 * Valida uma foto do corpo e devolve { bytes, ext } ou { erro }.
 *
 * O tipo é deduzido dos BYTES (assinatura do arquivo), não do nome nem de um
 * campo do corpo: nome e campo são escritos por quem chama, e aqui o conteúdo
 * vai para um bucket servido ao público.
 */
function validarFoto(foto, rotulo) {
  if (!foto || typeof foto !== 'object') return { erro: `${rotulo}: ausente` };
  if (!idDriveValido(foto.arquivoId)) return { erro: `${rotulo}: arquivoId inválido` };
  if (typeof foto.conteudoBase64 !== 'string' || !foto.conteudoBase64) {
    return { erro: `${rotulo}: conteudoBase64 ausente` };
  }
  let bytes;
  try {
    bytes = Buffer.from(foto.conteudoBase64, 'base64');
  } catch {
    return { erro: `${rotulo}: base64 inválido` };
  }
  if (!bytes.length) return { erro: `${rotulo}: vazio` };
  if (bytes.length > FOTO_MAX_BYTES) {
    return { erro: `${rotulo}: ${Math.round(bytes.length / 1024)} KB — acima do teto de ${FOTO_MAX_BYTES / 1024} KB. Peça uma miniatura menor.` };
  }
  const tipo = tipoPelosBytes(bytes);
  if (!tipo) return { erro: `${rotulo}: não parece JPEG, PNG nem WebP` };
  return { bytes, tipo, ext: TIPOS[tipo] };
}

/** Assinatura do arquivo (magic bytes). */
function tipoPelosBytes(b) {
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length > 8 && b.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Nome do objeto no bucket: legível, com sufixo aleatório (URL não adivinhável). */
function chaveS3(nome, ext) {
  const base = String(nome || 'foto')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'foto';
  return `media/gallery/${Date.now()}_drive_${base}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
}

async function enviarAoS3(chave, bytes, tipo) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  await s3.send(new PutObjectCommand({
    Bucket: process.env.MEDIA_BUCKET,
    Key: chave,
    Body: bytes,
    ContentType: tipo,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${String(process.env.MEDIA_BASE_URL || '').replace(/\/$/, '')}/${chave.replace(/^media\//, '')}`;
}

async function firebase(metodo, caminho, corpo) {
  const base = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const secret = process.env.FIREBASE_DATABASE_SECRET;
  if (!base || !secret) throw new Error('Firebase não configurado');
  const resp = await fetch(`${base}/${caminho}.json?auth=${encodeURIComponent(secret)}`, {
    method: metodo,
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`Firebase HTTP ${resp.status}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

/**
 * Marca o arquivo do Drive como importado.
 *
 * É o que impede a foto de entrar de novo a cada execução do cron. A marca fica
 * no banco, e não numa propriedade do script, porque o script pode ser recriado
 * e porque é o banco que sabe o que o site está mostrando.
 */
async function marcarImportado(arquivoId, dados) {
  await firebase('PUT', `driveImports/${encodeURIComponent(arquivoId)}`, {
    at: new Date().toISOString(), ...dados,
  });
}

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, cors, { ok: false, error: 'método não permitido' });

  // Sem originAllowed(): quem chama é o Apps Script do Google, não o navegador
  // no nosso domínio, então não há Origin nosso para conferir. O que autentica
  // aqui é o segredo compartilhado.
  if (!rateLimit('drive-sync', clientIp(event), { max: 200 })) {
    return reply(429, cors, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }

  const esperado = process.env.DRIVE_SYNC_SECRET;
  if (!esperado) {
    console.error('drive-sync: DRIVE_SYNC_SECRET não configurado no SSM');
    return reply(503, cors, { ok: false, error: 'sincronização não configurada' });
  }
  if (!segredoConfere(cabecalho(event, 'x-drive-sync-secret'), esperado)) {
    console.warn(`drive-sync: segredo inválido de ${clientIp(event)}`);
    return reply(401, cors, { ok: false, error: 'não autorizado' });
  }

  const bruto = event.body || '';
  if (bruto.length > CORPO_MAX_BYTES) {
    return reply(413, cors, { ok: false, error: 'corpo grande demais — mande a miniatura, não o original' });
  }

  let body;
  try {
    body = JSON.parse(bruto);
  } catch {
    return reply(400, cors, { ok: false, error: 'JSON inválido' });
  }

  const op = body && body.op;
  if (!OPS.has(op)) return reply(400, cors, { ok: false, error: 'op inválida' });

  try {
    if (op === 'estado') {
      const marcas = await firebase('GET', 'driveImports');
      return reply(200, cors, { ok: true, ids: marcas && typeof marcas === 'object' ? Object.keys(marcas) : [] });
    }

    if (op === 'carrossel') {
      const v = validarFoto(body, 'foto');
      if (v.erro) return reply(400, cors, { ok: false, error: v.erro });

      const url = await enviarAoS3(chaveS3(body.nome, v.ext), v.bytes, v.tipo);
      const chaveItem = `drive_${crypto.randomBytes(9).toString('hex')}`;
      await firebase('PUT', `portfolio/${chaveItem}`, {
        url, type: 'image',
        caption: textoCurto(body.legenda) || 'SP Car Clean',
        createdAt: Date.now(),
        driveFileId: body.arquivoId,
      });
      await marcarImportado(body.arquivoId, { destino: 'portfolio', item: chaveItem, url });
      console.log(`drive-sync: carrossel += ${body.arquivoId} (${Math.round(v.bytes.length / 1024)} KB)`);
      return reply(200, cors, { ok: true, dados: { url, item: chaveItem } });
    }

    // antes-depois: os dois lados no mesmo pedido. Fazer em duas chamadas
    // deixaria meio par gravado se a segunda falhasse, e meio par é uma
    // vitrine mentindo.
    const a = validarFoto(body.antes, 'antes');
    if (a.erro) return reply(400, cors, { ok: false, error: a.erro });
    const d = validarFoto(body.depois, 'depois');
    if (d.erro) return reply(400, cors, { ok: false, error: d.erro });
    if (body.antes.arquivoId === body.depois.arquivoId) {
      return reply(400, cors, { ok: false, error: 'antes e depois são o mesmo arquivo' });
    }

    const urlAntes = await enviarAoS3(chaveS3(`antes-${body.antes.nome}`, a.ext), a.bytes, a.tipo);
    const urlDepois = await enviarAoS3(chaveS3(`depois-${body.depois.nome}`, d.ext), d.bytes, d.tipo);
    const chaveItem = `drive_${crypto.randomBytes(9).toString('hex')}`;
    await firebase('PUT', `gallery/${chaveItem}`, {
      beforeUrl: urlAntes, afterUrl: urlDepois,
      caption: textoCurto(body.legenda) || 'SP Car Clean',
      createdAt: Date.now(),
      driveFileIds: [body.antes.arquivoId, body.depois.arquivoId],
    });
    await marcarImportado(body.antes.arquivoId, { destino: 'gallery', item: chaveItem, lado: 'antes' });
    await marcarImportado(body.depois.arquivoId, { destino: 'gallery', item: chaveItem, lado: 'depois' });
    console.log(`drive-sync: antes/depois += ${chaveItem}`);
    return reply(200, cors, { ok: true, dados: { item: chaveItem, antes: urlAntes, depois: urlDepois } });
  } catch (err) {
    console.error(`drive-sync: ${op} falhou: ${err.message}`);
    return reply(502, cors, { ok: false, error: 'falha ao gravar a foto' });
  }
};

// Exportado para teste: a validação é o que separa "foto do Drive" de "qualquer
// coisa que alguém mandou", e precisa ser verificável sem rede.
exports._interno = {
  validarFoto, tipoPelosBytes, chaveS3, idDriveValido, textoCurto,
  segredoConfere, FOTO_MAX_BYTES, OPS,
};
