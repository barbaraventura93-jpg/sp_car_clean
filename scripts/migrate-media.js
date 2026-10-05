#!/usr/bin/env node
'use strict';

// Migra as fotos/vídeos do Firebase Storage para o bucket de mídia na AWS e troca
// os links no Realtime Database. Varre o banco inteiro: qualquer texto que seja um
// link do Firebase Storage é copiado para o S3 e substituído pelo endereço em /media/.
//
// Uso (no AWS CloudShell, dentro do repositório):
//   node scripts/migrate-media.js            # simulação: só lista o que seria migrado
//   node scripts/migrate-media.js --apply    # copia os arquivos e atualiza os links
//
// Pode rodar de novo com segurança: links já migrados não são mais do Firebase.
// Fotos de check-in ganham um nome aleatório (o caminho antigo era previsível).

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIREBASE_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/;
const SITE = 'https://spcarclean.com.br';

// Encontra todos os links do Firebase Storage no banco: [{ path: [...chaves], url }]
function findStorageLinks(node, at = [], out = []) {
  if (typeof node === 'string') {
    if (FIREBASE_URL.test(node)) out.push({ path: at, url: node });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) findStorageLinks(v, [...at, k], out);
  }
  return out;
}

// Caminho do objeto no Firebase → chave no bucket de mídia.
function targetKey(url) {
  const objectPath = decodeURIComponent(url.match(FIREBASE_URL)[1]);
  const parts = objectPath.split('/');
  if (parts[0] === 'checkin') {
    const name = parts.pop();
    return ['media', ...parts, `${crypto.randomUUID()}-${name}`].join('/');
  }
  return `media/${objectPath}`;
}

const publicUrl = (key) => `${SITE}/${key.split('/').map(encodeURIComponent).join('/')}`;

/**
 * @param {object} deps
 *   db: objeto do banco inteiro
 *   download(url) → { body: Buffer, contentType }
 *   upload(key, body, contentType)
 *   patch(pathArray, value)
 *   apply: boolean, log(msg)
 */
async function migrate({ db, download, upload, patch, apply, log }) {
  const links = findStorageLinks(db);
  const byUrl = new Map();
  for (const l of links) {
    if (!byUrl.has(l.url)) byUrl.set(l.url, []);
    byUrl.get(l.url).push(l.path);
  }

  const summary = {};
  for (const l of links) summary[l.path[0]] = (summary[l.path[0]] || 0) + 1;
  log(`Links do Firebase Storage encontrados: ${links.length} (${byUrl.size} arquivos distintos)`);
  for (const [node, n] of Object.entries(summary)) log(`  ${node}: ${n}`);
  if (!apply) {
    log('Simulação: nada foi alterado. Rode com --apply para migrar.');
    return { found: links.length, files: byUrl.size, migrated: 0, failed: [] };
  }

  let migrated = 0;
  const failed = [];
  for (const [url, paths] of byUrl) {
    try {
      const { body, contentType } = await download(url);
      const key = targetKey(url);
      await upload(key, body, contentType);
      const newUrl = publicUrl(key);
      for (const p of paths) await patch(p, newUrl);
      migrated++;
      log(`ok   ${paths[0].join('/')} → ${newUrl}`);
    } catch (err) {
      failed.push({ url, paths, error: err.message });
      log(`ERRO ${paths[0].join('/')}: ${err.message}`);
    }
  }
  log(`Migrados: ${migrated} de ${byUrl.size}. Falhas: ${failed.length}.`);
  return { found: links.length, files: byUrl.size, migrated, failed };
}

module.exports = { findStorageLinks, targetKey, publicUrl, migrate };

// ---------------------------------------------------------------------------
// Execução no CloudShell (AWS CLI já autenticada)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const aws = (...args) => execFileSync('aws', [...args, '--region', 'sa-east-1', '--output', 'text'], { encoding: 'utf8' }).trim();
  const param = (name) => aws('ssm', 'get-parameter', '--name', `/sp-car-clean/${name}`, '--with-decryption', '--query', 'Parameter.Value');

  (async () => {
    const apply = process.argv.includes('--apply');
    const dbUrl = param('FIREBASE_DATABASE_URL').replace(/\/$/, '');
    const secret = param('FIREBASE_DATABASE_SECRET');
    const bucket = `sp-car-clean-media-${aws('sts', 'get-caller-identity', '--query', 'Account')}`;
    const dbPath = (p) => p.map(encodeURIComponent).join('/');

    const resp = await fetch(`${dbUrl}/.json?auth=${secret}`);
    if (!resp.ok) throw new Error(`leitura do banco falhou: HTTP ${resp.status}`);
    const db = await resp.json();

    const result = await migrate({
      db, apply, log: (m) => console.log(m),
      download: async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`download HTTP ${r.status}`);
        return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'application/octet-stream' };
      },
      upload: async (key, body, contentType) => {
        const tmp = path.join(os.tmpdir(), `media-${crypto.randomUUID()}`);
        fs.writeFileSync(tmp, body);
        try {
          aws('s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', tmp, '--content-type', contentType);
        } finally {
          fs.rmSync(tmp, { force: true });
        }
      },
      patch: async (p, value) => {
        const r = await fetch(`${dbUrl}/${dbPath(p)}.json?auth=${secret}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
        });
        if (!r.ok) throw new Error(`atualização do banco falhou: HTTP ${r.status}`);
      }
    });
    process.exitCode = result.failed.length ? 1 : 0;
  })().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
