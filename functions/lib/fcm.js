// Helper de envio de push via Firebase Cloud Messaging (HTTP v1).
// Não usa firebase-admin: minta o token OAuth2 manualmente com a service account
// (crypto nativo do Node) e lê/limpa os tokens dos dispositivos admin via RTDB REST.

const crypto = require('crypto');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// Aceita a service account como JSON puro ou base64 (env FCM_SERVICE_ACCOUNT).
function parseServiceAccount(raw) {
  if (!raw) return null;
  let txt = raw.trim();
  if (txt[0] !== '{') {
    try { txt = Buffer.from(txt, 'base64').toString('utf8'); } catch (_) { return null; }
  }
  try { return JSON.parse(txt); } catch (_) { return null; }
}

// Gera um access token OAuth2 com escopo de FCM a partir da service account.
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key);
  const jwt = `${unsigned}.${b64url(signature)}`;

  const resp = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString()
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('FCM OAuth falhou: ' + JSON.stringify(data));
  return data.access_token;
}

/**
 * Envia um push (data-only) para todos os dispositivos admin registrados.
 * Best-effort: silencioso se a service account ou o DB não estiverem configurados.
 * @param {{title:string, body:string, link?:string, tag?:string}} msg
 * @returns {Promise<{ok:boolean, sent?:number, pruned?:number, skipped?:string}>}
 */
async function sendAdminPush(msg) {
  const sa = parseServiceAccount(process.env.FCM_SERVICE_ACCOUNT);
  const dbUrl = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;

  if (!sa || !sa.private_key || !sa.client_email) return { ok: false, skipped: 'no-service-account' };
  if (!dbUrl || !dbSecret) return { ok: false, skipped: 'no-db' };

  // Lê os tokens dos dispositivos admin.
  let tokensObj;
  try {
    const r = await fetch(`${dbUrl}/adminPushTokens.json?auth=${dbSecret}`);
    tokensObj = await r.json();
  } catch (err) {
    return { ok: false, skipped: 'db-read-failed: ' + err.message };
  }
  const tokens = tokensObj && typeof tokensObj === 'object' ? Object.keys(tokensObj) : [];
  if (!tokens.length) return { ok: true, sent: 0 };

  const projectId = sa.project_id;
  const accessToken = await getAccessToken(sa);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const data = {
    title: String(msg.title || 'SP Car Clean'),
    body: String(msg.body || 'Nova atividade no painel.'),
    link: String(msg.link || '/?admin'),
    tag: String(msg.tag || 'spcc-admin')
  };

  let sent = 0;
  const invalid = [];

  await Promise.all(tokens.map(async (token) => {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            token,
            data,
            webpush: {
              headers: { Urgency: 'high', TTL: '3600' },
              fcm_options: { link: data.link }
            }
          }
        })
      });
      if (resp.ok) { sent++; return; }
      const err = await resp.json().catch(() => ({}));
      const code = err && err.error && (err.error.status || err.error.message);
      // Token morto/inválido → agenda remoção.
      if (resp.status === 404 || resp.status === 400 ||
          /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(String(code))) {
        invalid.push(token);
      }
    } catch (_) { /* rede: ignora este token nesta rodada */ }
  }));

  // Limpa tokens inválidos para não acumular lixo.
  await Promise.all(invalid.map((t) =>
    fetch(`${dbUrl}/adminPushTokens/${encodeURIComponent(t)}.json?auth=${dbSecret}`, { method: 'DELETE' })
      .catch(() => {})
  ));

  return { ok: true, sent, pruned: invalid.length };
}

module.exports = { sendAdminPush };
