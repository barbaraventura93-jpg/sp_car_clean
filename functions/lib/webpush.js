'use strict';

// Web Push padrão (sem Firebase): assinatura VAPID (RFC 8292) e conteúdo
// criptografado em aes128gcm (RFC 8291/8188), só com o crypto nativo do Node.
// Os aparelhos do admin ficam na tabela DynamoDB PUSH_TABLE.
//
// Variáveis:
//   WEB_PUSH_VAPID_PRIVATE_KEY → chave EC P-256 em PEM (criada pelo Terraform, no SSM)
//   PUSH_TABLE                 → nome da tabela DynamoDB das inscrições
//   URL                        → site; vai no "sub" do VAPID (exigido pela Apple)

const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s || ''), 'base64url');

let _keys = null;
function vapidKeys() {
  if (_keys) return _keys;
  const pem = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!pem) return null;
  const privateKey = crypto.createPrivateKey(pem);
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const publicRaw = Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]);
  _keys = { privateKey, publicKey: b64url(publicRaw) };
  return _keys;
}

// Chave pública no formato que o navegador espera em applicationServerKey.
function publicKey() {
  const k = vapidKeys();
  return k ? k.publicKey : null;
}

function vapidAuthorization(endpoint, keys) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: (process.env.URL || 'https://spcarclean.com.br').replace(/\/$/, '')
  }));
  const unsigned = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64url(sig)}, k=${keys.publicKey}`;
}

// Criptografa o payload para uma inscrição (um único registro aes128gcm).
function encrypt(subscription, payload) {
  const uaPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), // 0x02 = último registro
    cipher.final(),
    cipher.getAuthTag()
  ]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

function isValidSubscription(s) {
  return Boolean(s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) &&
    s.keys && fromB64url(s.keys.p256dh).length === 65 && fromB64url(s.keys.auth).length === 16);
}

// ---------------------------------------------------------------------------
// Inscrições (DynamoDB)
// ---------------------------------------------------------------------------
let _ddb = null;
function ddb() {
  if (!_ddb) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    _ddb = new DynamoDBClient({});
  }
  return _ddb;
}

const subId = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex');

async function saveSubscription(subscription, ua) {
  const { PutItemCommand } = require('@aws-sdk/client-dynamodb');
  await ddb().send(new PutItemCommand({
    TableName: process.env.PUSH_TABLE,
    Item: {
      id: { S: subId(subscription.endpoint) },
      subscription: { S: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }) },
      ua: { S: String(ua || '').slice(0, 180) },
      createdAt: { S: new Date().toISOString() }
    }
  }));
}

async function listSubscriptions() {
  const { ScanCommand } = require('@aws-sdk/client-dynamodb');
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await ddb().send(new ScanCommand({ TableName: process.env.PUSH_TABLE, ExclusiveStartKey }));
    items.push(...(out.Items || []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.map((it) => ({ id: it.id.S, subscription: JSON.parse(it.subscription.S) }));
}

async function deleteSubscription(id) {
  const { DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
  await ddb().send(new DeleteItemCommand({ TableName: process.env.PUSH_TABLE, Key: { id: { S: id } } }));
}

/**
 * Envia um push para todos os aparelhos do admin. Best-effort: nunca lança.
 * @param {{title:string, body:string, link?:string, tag?:string}} msg
 */
async function sendAdminPush(msg) {
  const keys = vapidKeys();
  if (!keys || !process.env.PUSH_TABLE) return { ok: false, skipped: 'push-not-configured' };

  let subs;
  try { subs = await listSubscriptions(); }
  catch (err) { return { ok: false, skipped: 'list-failed: ' + err.message }; }
  if (!subs.length) return { ok: true, sent: 0 };

  const payload = JSON.stringify({
    title: String(msg.title || 'SP Car Clean'),
    body: String(msg.body || 'Nova atividade no painel.'),
    link: String(msg.link || '/?admin'),
    tag: String(msg.tag || 'spcc-admin')
  });

  let sent = 0;
  const expired = [];
  await Promise.all(subs.map(async ({ id, subscription }) => {
    try {
      const resp = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(subscription.endpoint, keys),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '3600',
          Urgency: 'high'
        },
        body: encrypt(subscription, payload)
      });
      if (resp.ok) sent++;
      else if (resp.status === 404 || resp.status === 410) expired.push(id);
    } catch (_) { /* rede: tenta de novo no próximo evento */ }
  }));

  await Promise.all(expired.map((id) => deleteSubscription(id).catch(() => {})));
  return { ok: true, sent, pruned: expired.length };
}

module.exports = { publicKey, isValidSubscription, saveSubscription, sendAdminPush, encrypt, vapidAuthorization };
