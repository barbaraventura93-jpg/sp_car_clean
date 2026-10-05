'use strict';

// S3 sem SDK: URL pré-assinada (AWS Signature V4, query string) para o
// navegador enviar uma foto direto ao bucket de mídia, e um PUT assinado para
// scripts (migração do Firebase Storage). Só usa o crypto nativo do Node.
//
// Credenciais: as do próprio Lambda (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
// AWS_SESSION_TOKEN, AWS_REGION) — ou as exportadas no terminal, no script.

const crypto = require('crypto');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Codificação de URI exigida pela SigV4 (RFC 3986; "/" preservada no caminho).
function uriEncode(str, keepSlash) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/g, keepSlash ? '/' : '%2F');
}

function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('credenciais AWS ausentes');
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN || '' };
}

function signingKey(secret, date, region) {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function amzDates(now = new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261005T120000Z
  return { amzDate, date: amzDate.slice(0, 8) };
}

/**
 * URL pré-assinada para PUT de um objeto. O navegador envia o arquivo com
 * fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': … } }).
 */
function presignPut({ bucket, key, region = process.env.AWS_REGION, expires = 900 }) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials();
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const { amzDate, date } = amzDates();
  const scope = `${date}/${region}/s3/aws4_request`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host'
  };
  if (sessionToken) params['X-Amz-Security-Token'] = sessionToken;

  const query = Object.keys(params).sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`).join('&');
  const path = '/' + uriEncode(key, true);
  const canonical = ['PUT', path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretAccessKey, date, region))
    .update(toSign).digest('hex');

  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}

/** PUT direto (assinado no header) — usado pelo script de migração. */
async function putObject({ bucket, key, body, contentType, cacheControl, region = process.env.AWS_REGION }) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials();
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const { amzDate, date } = amzDates();
  const scope = `${date}/${region}/s3/aws4_request`;
  const payloadHash = sha256(body);

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'content-type': contentType || 'application/octet-stream'
  };
  if (cacheControl) headers['cache-control'] = cacheControl;
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;

  const names = Object.keys(headers).sort();
  const path = '/' + uriEncode(key, true);
  const canonical = [
    'PUT', path, '',
    names.map((h) => `${h}:${String(headers[h]).trim()}`).join('\n') + '\n',
    names.join(';'), payloadHash
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretAccessKey, date, region))
    .update(toSign).digest('hex');

  const { host: _h, ...sendHeaders } = headers;
  const resp = await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      ...sendHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
    },
    body
  });
  if (!resp.ok) throw new Error(`S3 PUT ${key}: ${resp.status} ${await resp.text()}`);
}

module.exports = { presignPut, putObject };
