'use strict';

// Web Push padrão (sem Firebase): assinatura VAPID (RFC 8292) e conteúdo
// criptografado em aes128gcm (RFC 8291/8188), só com o crypto nativo do Node.
// Os aparelhos (do admin e dos clientes) ficam na tabela DynamoDB PUSH_TABLE.
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
// Cada item é um aparelho: { id, subscription, ua, audience, targets? }
//   audience 'admin'  → recebe os avisos da gestão (itens antigos, sem audience, também)
//   audience 'client' → recebe só o que é dos seus "targets": hashes de
//                       booking:<código>, uid:<uid> e email:<e-mail> do cliente
let _ddb = null;
function ddb() {
  if (!_ddb) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    _ddb = new DynamoDBClient({});
  }
  return _ddb;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// O aparelho do admin mantém o id antigo (hash do endpoint); o mesmo aparelho
// inscrito como cliente vira outro item, sem sobrescrever o do admin.
const subId = (endpoint, audience = 'admin') =>
  sha256(audience === 'client' ? `client|${endpoint}` : endpoint);

// Alvo de um push de cliente. Guardado como hash: a tabela não tem e-mail em claro.
function clientTarget(kind, value) {
  let v = String(value || '').trim();
  if (kind === 'email') v = v.toLowerCase();
  if (kind === 'booking') v = v.toUpperCase();
  return v ? `${kind}:${sha256(v).slice(0, 40)}` : null;
}

async function saveSubscription(subscription, ua) {
  const { PutItemCommand } = require('@aws-sdk/client-dynamodb');
  await ddb().send(new PutItemCommand({
    TableName: process.env.PUSH_TABLE,
    Item: {
      id: { S: subId(subscription.endpoint) },
      subscription: { S: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }) },
      ua: { S: String(ua || '').slice(0, 180) },
      audience: { S: 'admin' },
      createdAt: { S: new Date().toISOString() }
    }
  }));
}

// Inscreve (ou atualiza) o aparelho de um cliente, somando os novos alvos aos
// que ele já tinha — um mesmo celular acompanha vários agendamentos.
async function saveClientSubscription(subscription, ua, targets) {
  const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
  const list = [...new Set(targets.filter(Boolean))];
  if (!list.length) throw new Error('sem alvos');
  await ddb().send(new UpdateItemCommand({
    TableName: process.env.PUSH_TABLE,
    Key: { id: { S: subId(subscription.endpoint, 'client') } },
    UpdateExpression: 'SET subscription = :s, ua = :ua, audience = :a, updatedAt = :t ADD targets :tg',
    ExpressionAttributeValues: {
      ':s': { S: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }) },
      ':ua': { S: String(ua || '').slice(0, 180) },
      ':a': { S: 'client' },
      ':t': { S: new Date().toISOString() },
      ':tg': { SS: list }
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
  return items.map((it) => ({
    id: it.id.S,
    subscription: JSON.parse(it.subscription.S),
    audience: (it.audience && it.audience.S) || 'admin',
    targets: (it.targets && it.targets.SS) || []
  }));
}

async function deleteSubscription(id) {
  const { DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
  await ddb().send(new DeleteItemCommand({ TableName: process.env.PUSH_TABLE, Key: { id: { S: id } } }));
}

// Envia o mesmo push para uma lista de aparelhos e remove os que o navegador invalidou.
async function deliver(subs, msg, keys) {
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
          TTL: '86400',
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

async function sendTo(filter, msg) {
  const keys = vapidKeys();
  if (!keys || !process.env.PUSH_TABLE) return { ok: false, skipped: 'push-not-configured' };
  let subs;
  try { subs = await listSubscriptions(); }
  catch (err) { return { ok: false, skipped: 'list-failed: ' + err.message }; }
  return deliver(subs.filter(filter), msg, keys);
}

/**
 * Envia um push para todos os aparelhos do admin. Best-effort: nunca lança.
 * @param {{title:string, body:string, link?:string, tag?:string}} msg
 */
async function sendAdminPush(msg) {
  return sendTo((s) => s.audience !== 'client', msg);
}

/**
 * Envia um push aos aparelhos do cliente que têm algum dos alvos (clientTarget).
 * Best-effort: nunca lança.
 */
async function sendClientPush(targets, msg) {
  const wanted = new Set(targets.filter(Boolean));
  if (!wanted.size) return { ok: true, sent: 0 };
  return sendTo((s) => s.audience === 'client' && s.targets.some((t) => wanted.has(t)),
    { tag: 'spcc-cliente', ...msg });
}

// Alvos de um agendamento: o código, a conta (uid) e o e-mail do cliente.
function bookingTargets(booking) {
  if (!booking) return [];
  return [
    clientTarget('booking', booking.id),
    clientTarget('uid', booking.clientUid),
    clientTarget('email', booking.email)
  ].filter(Boolean);
}

// Push de "seu agendamento mudou" — painel admin (notify-client) e webhook de pagamento.
async function pushBookingUpdate(booking, title, body) {
  if (!booking || !booking.id) return { ok: false, skipped: 'sem agendamento' };
  const site = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');
  return sendClientPush(bookingTargets(booking), {
    title: String(title || '🔔 Atualização do seu agendamento').slice(0, 120),
    body: String(body || `Agendamento ${booking.id}`).slice(0, 240),
    link: `${site}/?app=cliente&consulta=${encodeURIComponent(booking.id)}`,
    tag: `spcc-${booking.id}`
  });
}

module.exports = {
  publicKey, isValidSubscription, saveSubscription, saveClientSubscription,
  sendAdminPush, sendClientPush, pushBookingUpdate, clientTarget, bookingTargets,
  encrypt, vapidAuthorization
};
