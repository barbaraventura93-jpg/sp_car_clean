'use strict';

// /api/upload-url — fotos e vídeos do painel admin vão direto para o S3
// (substitui o Firebase Storage). Só o admin pede URL.
//
// POST (Authorization: Bearer <token do admin>)
//   { folder: 'gallery' | 'checkin', bookingId?, filename, contentType, size }
// → { ok, uploadUrl, url }
//   uploadUrl: PUT pré-assinado no bucket de mídia (vale 15 min)
//   url:       endereço público, servido pelo CloudFront em /media/...
//
// Variáveis (Terraform): MEDIA_BUCKET, MEDIA_BASE_URL

const crypto = require('crypto');
const { presignPut } = require('./lib/s3');
const { verifyAdmin, bearerToken } = require('./lib/admin-auth');
const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

const MAX_BYTES = { image: 5 * 1024 * 1024, video: 30 * 1024 * 1024 };
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm'
};

// Nome legível + sufixo aleatório: a URL não é adivinhável (as fotos de
// check-in só são vistas por quem recebeu o link, como no Firebase).
function objectKey(folder, bookingId, filename, contentType) {
  const base = String(filename || 'arquivo').replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'arquivo';
  const rand = crypto.randomBytes(12).toString('hex');
  const name = `${Date.now()}_${base}_${rand}.${EXT[contentType]}`;
  return folder === 'checkin' ? `media/checkin/${bookingId}/${name}` : `media/gallery/${name}`;
}

exports.handler = async (event) => {
  const cors = { ...corsHeaders(event), 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  const reply = (status, body) => ({
    statusCode: status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });
  if (!originAllowed(event)) return reply(403, { ok: false, error: 'origem não permitida' });
  if (!rateLimit('upload-url', clientIp(event), { max: 200 })) {
    return reply(429, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }
  if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });

  const bucket = process.env.MEDIA_BUCKET;
  const baseUrl = String(process.env.MEDIA_BASE_URL || '').replace(/\/$/, '');
  if (!bucket || !baseUrl) return reply(503, { ok: false, error: 'armazenamento não configurado' });

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

  const folder = data.folder === 'checkin' ? 'checkin' : data.folder === 'gallery' ? 'gallery' : null;
  if (!folder) return reply(400, { ok: false, error: 'pasta inválida' });

  const bookingId = String(data.bookingId || '');
  if (folder === 'checkin' && !/^[A-Za-z0-9_-]{3,40}$/.test(bookingId)) {
    return reply(400, { ok: false, error: 'agendamento inválido' });
  }

  const contentType = String(data.contentType || '').toLowerCase();
  if (!EXT[contentType]) return reply(400, { ok: false, error: 'tipo de arquivo não aceito' });
  const kind = contentType.startsWith('video/') ? 'video' : 'image';
  if (folder === 'checkin' && kind === 'video') return reply(400, { ok: false, error: 'check-in aceita só fotos' });
  const size = Number(data.size) || 0;
  if (size > MAX_BYTES[kind]) {
    return reply(400, { ok: false, error: `arquivo muito grande (máx. ${MAX_BYTES[kind] / 1024 / 1024} MB)` });
  }

  const key = objectKey(folder, bookingId, data.filename, contentType);
  try {
    return reply(200, { ok: true, uploadUrl: presignPut({ bucket, key }), url: `${baseUrl}/${key.replace(/^media\//, '')}` });
  } catch (err) {
    console.error('upload-url:', err.message);
    return reply(500, { ok: false, error: 'falha ao gerar URL de envio' });
  }
};
