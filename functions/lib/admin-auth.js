'use strict';

// Confere tokens de login no servidor. Ponto único de troca do login — era o
// que o comentário anterior previa, e é o que esta versão faz.
//
// Aceita só token do Cognito: valida a assinatura RS256 contra o JWKS do pool
// e, para acesso administrativo, exige o grupo `admin` no token. O caminho do
// Firebase Auth foi removido em 14/11/2026 (ver identificar()).
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
    // `username` NÃO é o e-mail. O pool usa o e-mail só como apelido de login
    // (infra/auth.tf, username_attributes), e nesse modo o Cognito grava um
    // identificador interno aqui. Tratar este campo como e-mail fazia o
    // servidor "reconhecer" o cliente por um código que nunca bate com o
    // e-mail do agendamento. O e-mail de verdade vem de emailVerificado().
    username: String(corpo.username || ''),
    exp: corpo.exp,
    grupos: Array.isArray(corpo['cognito:groups']) ? corpo['cognito:groups'] : [],
  };
}

// E-mail por token, guardado por container: evita uma chamada ao Cognito a
// cada requisição. Curto de propósito — se o e-mail mudar, vale em minutos.
const _emailCache = new Map(); // token -> { email, ate }
const EMAIL_TTL_MS = 5 * 60_000;
const EMAIL_CACHE_MAX = 500;

/**
 * O e-mail VERIFICADO do dono do token, em minúsculas — ou '' se não houver.
 *
 * Pergunta ao próprio Cognito (operação GetUser, autenticada pelo access token
 * do usuário; não usa credencial da AWS). Só devolve e-mail com
 * `email_verified = true`: o cliente pode trocar o próprio atributo `email`, e
 * um e-mail não verificado daria a ele os agendamentos de outra pessoa.
 *
 * Falha de rede devolve '' — nunca um palpite. Quem chama trata "sem e-mail"
 * como "não é dono por e-mail".
 */
async function emailVerificado(token) {
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (!token || !pool) return '';
  const agora = Date.now();
  const guardado = _emailCache.get(token);
  if (guardado && guardado.ate > agora) return guardado.email;

  let email = '';
  try {
    const resp = await fetch(`https://cognito-idp.${pool.split('_')[0]}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser',
      },
      body: JSON.stringify({ AccessToken: token }),
    });
    if (!resp.ok) return '';
    const dados = await resp.json();
    const attrs = {};
    for (const a of dados.UserAttributes || []) attrs[a.Name] = a.Value;
    if (String(attrs.email_verified) === 'true' && attrs.email) email = String(attrs.email).trim().toLowerCase();
  } catch (err) {
    console.error('admin-auth: falha ao consultar o e-mail no Cognito:', err.message);
    return '';
  }
  if (_emailCache.size >= EMAIL_CACHE_MAX) _emailCache.clear();
  _emailCache.set(token, { email, ate: agora + EMAIL_TTL_MS });
  return email;
}

/**
 * Quem é o dono do token. Devolve { uid, email, grupos, origem } ou null.
 * `email` é o e-mail verificado, ou '' quando não há um.
 *
 * Só Cognito. O caminho do Firebase Auth saiu: a chave do projeto Google foi
 * apagada em 08/11/2026, então ele não autenticava mais ninguém — e enquanto
 * existiu, concedia admin por comparação de e-mail.
 */
async function identificar(token) {
  const cog = await verificarTokenCognito(token);
  if (!cog) return null;
  return { uid: cog.uid, email: await emailVerificado(token), grupos: cog.grupos, origem: 'cognito' };
}

/** O token dá acesso administrativo? Só pela presença do grupo `admin`. */
async function verifyAdmin(token) {
  const cog = await verificarTokenCognito(token);
  return !!cog && cog.grupos.includes(GRUPO_ADMIN);
}

function bearerToken(event) {
  return String((event.headers && event.headers.authorization) || '').replace(/^Bearer /, '');
}

module.exports = {
  verifyAdmin,
  verificarTokenCognito,
  emailVerificado,
  identificar,
  bearerToken,
  GRUPO_ADMIN,
};
