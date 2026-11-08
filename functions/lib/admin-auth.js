'use strict';

// Confere tokens de login no servidor. Ponto único de troca do login — era o
// que o comentário anterior previa, e é o que esta versão faz.
//
// Aceita DUAS origens de token, nesta ordem:
//
//   1. Cognito (atual) — valida a assinatura RS256 contra o JWKS do pool e
//      exige o grupo `admin` no token. É o caminho novo da migração.
//   2. Firebase Auth (legado) — mantido para não quebrar nada durante a
//      transição. Na prática já não produz token: a chave de API do projeto
//      Google foi apagada em 08/11/2026 e `signInWithEmailAndPassword` falha
//      com `auth/api-key-not-valid`. Sai quando o frontend terminar de migrar.
//
// A diferença de fundo: antes, "é admin" era o e-mail do token igual a uma
// constante. Agora é a presença do grupo `admin`, atribuído no Cognito e
// assinado pela AWS — o cliente não tem como se declarar admin, e trocar quem
// é admin não exige deploy.

const crypto = require('crypto');

const GRUPO_ADMIN = 'admin';
const TOLERANCIA_SEG = 60; // folga de relógio entre a AWS e o Lambda

// JWKS cacheado por container: são poucas chaves e mudam raramente. Sem isso,
// cada request faria uma chamada HTTP só para validar o token.
let _jwksCache = null;
let _jwksBuscadoEm = 0;
const JWKS_TTL_MS = 3_600_000;

function _b64urlJson(parte) {
  const s = parte.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64').toString('utf8'));
}

function _issuer() {
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (!pool) return null;
  const regiao = pool.split('_')[0];
  return `https://cognito-idp.${regiao}.amazonaws.com/${pool}`;
}

async function _jwks() {
  const agora = Date.now();
  if (_jwksCache && agora - _jwksBuscadoEm < JWKS_TTL_MS) return _jwksCache;
  const iss = _issuer();
  if (!iss) return null;
  const resp = await fetch(`${iss}/.well-known/jwks.json`);
  if (!resp.ok) throw new Error(`JWKS HTTP ${resp.status}`);
  const { keys } = await resp.json();
  if (!Array.isArray(keys) || !keys.length) throw new Error('JWKS vazio');
  _jwksCache = keys;
  _jwksBuscadoEm = agora;
  return keys;
}

/**
 * Valida um access token do Cognito e devolve { uid, email, grupos } — ou null.
 *
 * A assinatura é verificada de verdade, não apenas decodificada: um token
 * decodificado sem checar assinatura é texto que o cliente escreveu.
 */
async function verificarTokenCognito(token) {
  const clientId = process.env.COGNITO_CLIENT_ID;
  const iss = _issuer();
  if (!token || !clientId || !iss) return null;

  const partes = String(token).split('.');
  if (partes.length !== 3) return null;

  let cabecalho, corpo;
  try {
    cabecalho = _b64urlJson(partes[0]);
    corpo = _b64urlJson(partes[1]);
  } catch {
    return null;
  }

  // Só RS256. Aceitar `alg` do token sem restringir é o caminho para o ataque
  // clássico de trocar o algoritmo por `none` ou por HMAC.
  if (cabecalho.alg !== 'RS256' || !cabecalho.kid) return null;

  let chaves;
  try {
    chaves = await _jwks();
  } catch (err) {
    console.error('admin-auth: falha ao obter JWKS:', err.message);
    return null;
  }
  const jwk = chaves.find((k) => k.kid === cabecalho.kid);
  if (!jwk) return null;

  let assinaturaOk = false;
  try {
    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    assinaturaOk = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${partes[0]}.${partes[1]}`),
      pub,
      Buffer.from(partes[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    );
  } catch (err) {
    console.error('admin-auth: erro ao verificar assinatura:', err.message);
    return null;
  }
  if (!assinaturaOk) return null;

  const agora = Math.floor(Date.now() / 1000);
  if (corpo.iss !== iss) return null;
  if (corpo.token_use !== 'access') return null; // o id token não serve aqui
  if (corpo.client_id !== clientId) return null;
  if (!corpo.exp || corpo.exp + TOLERANCIA_SEG < agora) return null;
  if (corpo.iat && corpo.iat - TOLERANCIA_SEG > agora) return null;

  return {
    uid: corpo.sub,
    email: String(corpo.username || corpo.sub || '').toLowerCase(),
    grupos: Array.isArray(corpo['cognito:groups']) ? corpo['cognito:groups'] : [],
  };
}

// --- Legado: Firebase Auth. Mantido durante a transição. ---------------
async function lookupUser(token) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey || !token) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const user = data.users?.[0];
    return user ? { uid: user.localId, email: String(user.email || '').toLowerCase() } : null;
  } catch {
    return null;
  }
}

/**
 * Quem é o dono do token, de qualquer uma das duas origens.
 * Devolve { uid, email, grupos, origem } ou null.
 */
async function identificar(token) {
  const cog = await verificarTokenCognito(token);
  if (cog) return { ...cog, origem: 'cognito' };
  const fb = await lookupUser(token);
  if (fb) return { ...fb, grupos: [], origem: 'firebase' };
  return null;
}

/** O token dá acesso administrativo? */
async function verifyAdmin(token) {
  const u = await identificar(token);
  if (!u) return false;
  if (u.origem === 'cognito') return u.grupos.includes(GRUPO_ADMIN);
  // No legado não existe grupo: cai na regra antiga, o e-mail do admin.
  const adminEmail = (process.env.ADMIN_EMAIL || 'spcarclean0@gmail.com').toLowerCase();
  return u.email === adminEmail;
}

function bearerToken(event) {
  return String((event.headers && event.headers.authorization) || '').replace(/^Bearer /, '');
}

module.exports = {
  lookupUser,
  verifyAdmin,
  verificarTokenCognito,
  identificar,
  bearerToken,
  GRUPO_ADMIN,
};
