// Troca do `code` do Embedded Signup (Facebook Login for Business) por um
// access token de longa duração, feita 100% server-side.
//
// O frontend (botão "Conectar WhatsApp Business" na área admin) dispara o
// FB.login com response_type=code e, no callback de sucesso, envia o `code`
// aqui via POST. Esta função troca o code por um token na Graph API e o
// PERSISTE no Firebase — o token NUNCA volta para o frontend.
//
// Variáveis de ambiente necessárias (Netlify → Site settings → Env):
//   FB_APP_ID       → App ID do app da Meta (público)
//   FB_APP_SECRET   → App Secret (SECRETO — nunca no código nem no frontend)
//   FIREBASE_DATABASE_URL / FIREBASE_DATABASE_SECRET → já usados pelas outras
//                     functions; onde o token é salvo.
//
// Endpoint da Meta:
//   GET https://graph.facebook.com/v21.0/oauth/access_token
//       ?client_id=FB_APP_ID&client_secret=FB_APP_SECRET&code=CODE
//   → { access_token, token_type, expires_in }
//
// No Embedded Signup (response_type=code) NÃO se envia redirect_uri na troca.

const { dbPatch } = require('./lib/core/firebase');

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const appId     = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'FB_APP_ID/FB_APP_SECRET não configurados' })
    };
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const code = (data.code || '').trim();
  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'code é obrigatório' })
    };
  }

  try {
    // ---- Troca do code por access token (server-side) ----
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('code', code);

    const resp = await fetch(url.toString());
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.access_token) {
      const msg = body?.error?.message || `HTTP ${resp.status}`;
      console.error('whatsapp-exchange-token: falha na troca:', msg);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Falha ao trocar o code por token' })
      };
    }

    // ---- Persiste o token no Firebase (nó privado, nunca lido no client) ----
    // Deixa o token exatamente em integrations/whatsapp/accessToken, com
    // metadados irmãos para diagnóstico. As regras do Firebase não expõem
    // /integrations em nenhuma leitura pública/cliente.
    await dbPatch('/integrations/whatsapp', {
      accessToken: body.access_token,
      tokenType:   body.token_type || 'bearer',
      expiresIn:   typeof body.expires_in === 'number' ? body.expires_in : null,
      appId,
      obtainedAt:  new Date().toISOString()
    });

    // Só devolvemos confirmação — nunca o token em si.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('whatsapp-exchange-token: erro:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Erro interno ao processar o token' })
    };
  }
};
