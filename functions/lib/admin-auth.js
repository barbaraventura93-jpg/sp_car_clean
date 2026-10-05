'use strict';

// Confere tokens de login (Firebase Auth) no servidor.
// Ponto único de troca quando o login migrar para o Cognito (Fase 4).

// Dono do token: { uid, email } — ou null se o token for inválido/expirado.
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
  } catch { return null; }
}

// O token é do e-mail do admin?
async function verifyAdmin(token) {
  const adminEmail = (process.env.ADMIN_EMAIL || 'spcarclean0@gmail.com').toLowerCase();
  const user = await lookupUser(token);
  return Boolean(user && user.email === adminEmail);
}

function bearerToken(event) {
  return String((event.headers && event.headers.authorization) || '').replace(/^Bearer /, '');
}

module.exports = { lookupUser, verifyAdmin, bearerToken };
