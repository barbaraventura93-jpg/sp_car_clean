#!/usr/bin/env node
// Migra as fotos/vídeos do Firebase Storage para o bucket de mídia no S3 e
// troca as URLs gravadas no Realtime Database. Passo a passo: README →
// "Fotos e vídeos (S3)".
//
// Uso (Node 20+):
//   eval "$(aws configure export-credentials --format env)"   # credenciais AWS no terminal
//   export AWS_REGION=sa-east-1
//   export MEDIA_BUCKET=$(cd infra && terraform output -raw media_bucket)
//   export MEDIA_BASE_URL=https://www.spcarclean.com.br/media
//   export FIREBASE_DATABASE_URL=https://sp-car-clean-default-rtdb.firebaseio.com
//   export FIREBASE_DATABASE_SECRET=...                        # mesmo valor do SSM
//   node scripts/migrate-storage-to-s3.js --dry-run            # só lista o que faria
//   node scripts/migrate-storage-to-s3.js                      # copia e troca as URLs
//
// Procura URLs do Firebase Storage em /portfolio, /gallery e /bookings (fotos
// do check-in). Pode rodar de novo sem problema: o que já foi migrado é pulado.

'use strict';

const crypto = require('crypto');
const { putObject } = require('../functions/lib/s3');

const DRY = process.argv.includes('--dry-run');
const NODES = ['portfolio', 'gallery', 'bookings'];
const dbUrl = String(process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
const bucket = process.env.MEDIA_BUCKET;
const baseUrl = String(process.env.MEDIA_BASE_URL || '').replace(/\/$/, '');

for (const [k, v] of Object.entries({ FIREBASE_DATABASE_URL: dbUrl, FIREBASE_DATABASE_SECRET: dbSecret, MEDIA_BUCKET: bucket, MEDIA_BASE_URL: baseUrl, AWS_REGION: process.env.AWS_REGION })) {
  if (!v) { console.error(`Falta a variável ${k}.`); process.exit(1); }
}

const isFirebaseUrl = (s) => typeof s === 'string' &&
  /^https:\/\/(firebasestorage\.googleapis\.com|[^/]+\.firebasestorage\.app)\//.test(s);

async function db(method, path, body) {
  const resp = await fetch(`${dbUrl}/${path}.json?auth=${dbSecret}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!resp.ok) throw new Error(`Firebase ${method} ${path}: ${resp.status}`);
  return resp.json();
}

// Todas as strings que são URL do Firebase Storage, com o caminho no banco.
function findUrls(value, path, out) {
  if (isFirebaseUrl(value)) out.push({ path, url: value });
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findUrls(v, `${path}/${k}`, out);
  }
  return out;
}

// gs://.../o/checkin%2FSPC-X%2Fpainel_123?alt=media → "checkin/SPC-X/painel_123"
function storagePath(url) {
  const m = new URL(url).pathname.match(/\/o\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

function newKey(path, contentType) {
  let key = 'media/' + path.replace(/[^A-Za-z0-9/._-]+/g, '-');
  // Check-in: sufixo aleatório para a URL pública não ser adivinhável.
  if (path.startsWith('checkin/')) key += '_' + crypto.randomBytes(12).toString('hex');
  if (!/\.[a-z0-9]{2,4}$/i.test(key) && EXT[contentType]) key += '.' + EXT[contentType];
  return key;
}

(async () => {
  const refs = [];
  for (const node of NODES) findUrls(await db('GET', node), node, refs);

  const byUrl = new Map();
  for (const r of refs) (byUrl.get(r.url) || byUrl.set(r.url, []).get(r.url)).push(r.path);
  console.log(`${refs.length} referência(s) a ${byUrl.size} arquivo(s) no Firebase Storage.${DRY ? ' (simulação)' : ''}`);

  let done = 0, failed = 0;
  for (const [url, paths] of byUrl) {
    const src = storagePath(url);
    if (!src) { console.warn('  ? URL sem caminho reconhecível:', url); failed++; continue; }
    try {
      if (DRY) { console.log(`  • ${src}  →  ${paths.join(', ')}`); continue; }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`download ${resp.status}`);
      const contentType = (resp.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      const key = newKey(src, contentType);
      await putObject({ bucket, key, body: Buffer.from(await resp.arrayBuffer()), contentType, cacheControl: 'public, max-age=31536000, immutable' });

      const newUrl = `${baseUrl}/${key.replace(/^media\//, '')}`;
      for (const p of paths) {
        const i = p.lastIndexOf('/');
        await db('PATCH', p.slice(0, i), { [p.slice(i + 1)]: newUrl });
      }
      done++;
      console.log(`  ✓ ${src}  →  ${newUrl}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${src}: ${err.message}`);
    }
  }

  if (!DRY) console.log(`\nMigrados: ${done} · Falhas: ${failed}${failed ? ' — rode de novo para tentar as que falharam.' : ''}`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error(err.message); process.exit(1); });
