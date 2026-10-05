'use strict';

// URL pré-assinada (AWS SigV4, via query string) para o navegador enviar um
// arquivo direto ao S3 com PUT. Usa as credenciais da própria Lambda.

const crypto = require('crypto');

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

/**
 * @param {{bucket:string, region:string, key:string, contentType:string, expires?:number,
 *          credentials?:{accessKeyId:string, secretAccessKey:string, sessionToken?:string}, now?:Date}} p
 */
function presignPut(p) {
  const creds = p.credentials || {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  };
  const now = p.now || new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const host = `${p.bucket}.s3.${p.region}.amazonaws.com`;
  const scope = `${date}/${p.region}/s3/aws4_request`;
  const path = '/' + p.key.split('/').map(enc).join('/');

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(p.expires || 300),
    'X-Amz-SignedHeaders': 'content-type;host'
  };
  if (creds.sessionToken) params['X-Amz-Security-Token'] = creds.sessionToken;
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');

  const canonical = [
    'PUT', path, query,
    `content-type:${p.contentType}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + creds.secretAccessKey, date), p.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');

  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}

module.exports = { presignPut };
