'use strict';

// Descadastro de e-mails de marketing, pelo link do rodapé.
//
// Precisa funcionar com UM clique, sem login: quem recebeu o e-mail não
// necessariamente tem conta, e exigir senha para parar de receber marketing é
// o mesmo que não oferecer saída.
//
// O token no link é um HMAC do endereço (ver lib/core/optout.js). Sem ele,
// qualquer um descadastraria qualquer endereço, e a página viraria um oráculo
// de "este e-mail está na base?".
//
// Responde HTML, não JSON: o destino é um navegador aberto a partir do e-mail.

const optout   = require('./lib/core/optout');
const firebase = require('./lib/core/firebase');

const MARCA = 'SP Car Clean';

function pagina(titulo, corpo, cor) {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${titulo} — ${MARCA}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px}
  .cartao{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:2rem 1.6rem;max-width:460px;width:100%;text-align:center}
  h1{font-size:1.15rem;margin:0 0 .7rem;color:${cor}}
  p{font-size:.92rem;line-height:1.6;margin:.4rem 0;color:#cbd5e1}
  a{color:#38bdf8}
</style>
</head><body><div class="cartao">
<h1>${titulo}</h1>
${corpo}
</div></body></html>`;
}

exports.handler = async (event) => {
  const html = (status, body) => ({
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body
  });

  const metodo = event?.httpMethod || 'GET';
  if (metodo !== 'GET' && metodo !== 'POST') {
    return html(405, pagina('Método não permitido', '<p>Use o link do e-mail.</p>', '#f87171'));
  }

  const q = event?.queryStringParameters || {};
  const email = optout.normaliza(q.e || '');
  const token = String(q.t || '');

  const segredo = process.env.FIREBASE_DATABASE_SECRET;
  if (!segredo) {
    console.error('unsubscribe: FIREBASE_DATABASE_SECRET ausente');
    return html(503, pagina('Indisponível no momento',
      `<p>Não conseguimos processar agora. Tente de novo mais tarde, ou responda ao e-mail pedindo a remoção — nós tiramos você da lista na mão.</p>`,
      '#fbbf24'));
  }

  // Link inválido e e-mail inexistente dão a MESMA resposta: dizer "este
  // endereço não está na base" entregaria de graça se alguém é cliente.
  if (!email || !email.includes('@') || !optout.tokenConfere(email, token, segredo)) {
    return html(400, pagina('Link inválido ou expirado',
      `<p>Confira se copiou o endereço inteiro do e-mail.</p>
       <p>Se preferir, é só responder ao e-mail pedindo a remoção.</p>`,
      '#f87171'));
  }

  try {
    await optout.registrarDescadastro({ email, origem: 'link', dbSet: firebase.dbSet });
  } catch (err) {
    console.error('unsubscribe: falha ao registrar', err.message);
    return html(500, pagina('Não conseguimos concluir',
      `<p>Tente de novo em alguns minutos. Se persistir, responda ao e-mail pedindo a remoção.</p>`,
      '#f87171'));
  }

  console.log(`unsubscribe: ${email} descadastrado`);
  return html(200, pagina('Pronto, você saiu da lista',
    `<p>Não vamos mais enviar e-mails promocionais para <strong>${email.replace(/[<>&]/g, '')}</strong>.</p>
     <p style="font-size:.84rem;opacity:.75">Você continuará recebendo apenas o que é do seu agendamento —
     confirmação, lembrete e recibo. Isso não é promoção.</p>
     <p style="font-size:.84rem;opacity:.75">Mudou de ideia? É só agendar de novo pelo site.</p>`,
    '#4ade80'));
};
