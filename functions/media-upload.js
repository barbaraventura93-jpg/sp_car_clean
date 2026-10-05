'use strict';

// POST /api/media-upload — prepara o envio de uma foto/vídeo do painel admin
// direto para o S3 (sem passar pelo Lambda: vídeos podem ter até 30 MB).
// Corpo: { kind: 'checkin'|'gallery'|'portfolio', contentType, size, bookingId? }
// Resposta: { uploadUrl (PUT, vale 5 min), url (endereço público em /media/...) }
// O navegador deve enviar o PUT com o mesmo Content-Type informado aqui.

const crypto = require('crypto');
const { presignPut } = require('./lib/s3-presign');
const { verifyAdmin, bearerToken } = require('./lib/admin-auth');
const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');

const MB = 1024 * 1024;
const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm'
};
const KINDS = {
  checkin:   { video: false, maxImage: 15 * MB },
  gallery:   { video: false, maxImage: 5 * MB },
  portfolio: { video: true,  maxImage: 5 * MB, maxVideo: 30 * MB }
};

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  const reply = (status, body) => ({
    statusCode: status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });
  if (!originAllowed(event)) return reply(403, { ok: false, error: 'origem não permitida' });
  if (!rateLimit('media-upload', clientIp(event), { max: 120 })) {
    return reply(429, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }
  if (!await verifyAdmin(bearerToken(event))) return reply(403, { ok: false, error: 'não autorizado' });

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

  const kind = KINDS[data.kind];
  const ext = TYPES[data.contentType];
  const isVideo = String(data.contentType || '').startsWith('video/');
  const size = Number(data.size);
  if (!kind) return reply(400, { ok: false, error: 'tipo de envio inválido' });
  if (!ext || (isVideo && !kind.video)) return reply(400, { ok: false, error: 'formato de arquivo não aceito' });
  if (!(size > 0) || size > (isVideo ? kind.maxVideo : kind.maxImage)) {
    return reply(400, { ok: false, error: 'arquivo muito grande' });
  }

  const id = `${Date.now()}_${crypto.randomUUID()}.${ext}`;
  let key;
  if (data.kind === 'checkin') {
    const booking = String(data.bookingId || '');
    if (!/^[A-Za-z0-9-]{3,40}$/.test(booking)) return reply(400, { ok: false, error: 'agendamento inválido' });
    key = `media/checkin/${booking}/${id}`;
  } else {
    key = `media/${data.kind}/${id}`;
  }

  const uploadUrl = presignPut({
    bucket: process.env.MEDIA_BUCKET,
    region: process.env.AWS_REGION,
    key,
    contentType: data.contentType,
    expires: 300
  });
  const site = (process.env.URL || 'https://spcarclean.com.br').replace(/\/$/, '');
  return reply(200, { ok: true, uploadUrl, url: `${site}/${key}` });
};
