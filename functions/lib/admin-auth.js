'use strict';

// Confere se o token de login (Firebase Auth) é do e-mail do admin.
// Ponto único de troca quando o login migrar para o Cognito (Fase 4).
async function verifyAdmin(token) {
  const apiKey     = process.env.FIREBASE_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL || 'spcarclean0@gmail.com';
  if (!apiKey || !token) return false;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.users?.[0]?.email === adminEmail;
  } catch { return false; }
}

function bearerToken(event) {
  return String((event.headers && event.headers.authorization) || '').replace(/^Bearer /, '');
}

module.exports = { verifyAdmin, bearerToken };
