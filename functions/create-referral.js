// Função "Indique um Amigo"
// Recebe a indicação feita pelo cliente (nome/e-mail/telefone do amigo),
// cria o cupom de boas-vindas do amigo no Firebase e registra a indicação.
// Roda server-side com o FIREBASE_DATABASE_SECRET para não depender das regras
// de escrita do cliente (mesmo padrão do birthday-check.js).

const FRIEND_PCT   = Number(process.env.REFERRAL_FRIEND_PCT   || 15); // % desconto p/ o amigo
const REFERRER_PCT = Number(process.env.REFERRAL_REFERRER_PCT || 15); // % desconto p/ quem indicou (na conversão)
const VALID_DAYS   = Number(process.env.REFERRAL_VALID_DAYS   || 90); // validade dos cupons

const crypto = require('crypto');
const { clientIp, rateLimit, originAllowed } = require('./lib/guard');

// Tetos de entrada. O nome do amigo e de quem indica entram no texto de um
// e-mail enviado em nome da SP Car Clean: sem teto e sem filtro, a função
// servia para mandar texto livre (e link) a qualquer endereço.
const MAX_NOME  = 80;
const MAX_EMAIL = 120;
const MAX_FONE  = 30;
const POR_HORA  = 5; // indicações por IP por hora

// Código do cupom com sorteio criptográfico e 8 posições: o anterior tinha 5
// posições com Math.random, curto e previsível para algo que vale desconto.
function refCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (const b of crypto.randomBytes(8)) r += chars[b % chars.length];
  return `${prefix}-${r}`;
}

/** Nome de pessoa: curto, numa linha só, sem endereço de site. */
function nomeValido(nome) {
  return nome.length <= MAX_NOME && !/[\r\n<>]/.test(nome) && !/(https?:|www\.|\.com\b|\.br\b)/i.test(nome);
}
function fmtBr(iso) { return iso ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : ''; }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // Mesmas proteções das outras funções públicas: só o site chama, e com teto.
  if (!originAllowed(event)) {
    return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'origin-not-allowed' }) };
  }
  if (!rateLimit('create-referral', clientIp(event), { max: POR_HORA })) {
    return { statusCode: 429, body: JSON.stringify({ ok: false, error: 'too-many-requests' }) };
  }

  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  const sjsService = process.env.EMAILJS_SERVICE_ID;
  const sjsPublic  = process.env.EMAILJS_PUBLIC_KEY;
  const sjsPrivate = process.env.EMAILJS_PRIVATE_KEY;
  const sjsTemplate= process.env.EMAILJS_TEMPLATE_UPDATE || 'template_update';
  const siteUrl    = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

  if (!dbUrl || !dbSecret) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'db-not-configured' }) };
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const clean = s => String(s || '').trim();
  const referrerName  = clean(data.referrerName);
  const referrerEmail = clean(data.referrerEmail).toLowerCase();
  const referrerPhone = clean(data.referrerPhone);
  const referrerUid   = clean(data.referrerUid) || null;
  const friendName  = clean(data.friendName);
  const friendEmail = clean(data.friendEmail).toLowerCase();
  const friendPhone = clean(data.friendPhone);
  const sourceBookingId = clean(data.sourceBookingId) || null;
  // O destino do aviso interno vem do servidor. Antes vinha do corpo da
  // requisição: quem chamasse escolhia um terceiro endereço para receber e-mail.
  const adminEmail = clean(process.env.ADMIN_EMAIL || 'spcarclean0@gmail.com').toLowerCase();

  if (!friendName || !friendEmail || !friendPhone) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'missing-fields' }) };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(friendEmail) || friendEmail.length > MAX_EMAIL) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'invalid-email' }) };
  }
  if (referrerEmail && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(referrerEmail) || referrerEmail.length > MAX_EMAIL)) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'invalid-email' }) };
  }
  if (!nomeValido(friendName) || !nomeValido(referrerName) || friendPhone.length > MAX_FONE || referrerPhone.length > MAX_FONE) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'missing-fields' }) };
  }
  if (referrerEmail && referrerEmail === friendEmail) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'self-referral' }) };
  }

  try {
    // Evita indicar duas vezes o mesmo e-mail.
    const existingResp = await fetch(`${dbUrl}/referrals.json?auth=${dbSecret}`);
    const existing = await existingResp.json();
    if (existing && typeof existing === 'object') {
      const dup = Object.values(existing).some(r => r && (r.friendEmail || '').toLowerCase() === friendEmail);
      if (dup) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'already-referred' }) };
    }

    const now = new Date();
    const expiryDate = new Date(now); expiryDate.setDate(expiryDate.getDate() + VALID_DAYS);
    const expiry = expiryDate.toISOString().slice(0, 10);
    const friendCode = refCode('AMIGO');

    // 1) Cupom nominal (por e-mail) do amigo indicado
    await fetch(`${dbUrl}/coupons/${friendCode}.json?auth=${dbSecret}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: friendCode, discountType: 'percent', discountValue: FRIEND_PCT,
        minValue: 0, used: false, clientEmail: friendEmail, validUntil: expiry,
        createdAt: now.toISOString(),
        note: `Indicação de ${referrerName || 'cliente'} — bônus de boas-vindas`
      })
    });

    // 2) Registro da indicação (o amigo vira "Oportunidade" na base)
    const referralResp = await fetch(`${dbUrl}/referrals.json?auth=${dbSecret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referrerName, referrerEmail, referrerPhone, referrerUid,
        friendName, friendEmail, friendPhone,
        friendCouponCode: friendCode, referrerCouponCode: null,
        status: 'pending', sourceBookingId,
        createdAt: now.toISOString(), convertedAt: null, convertedBookingId: null
      })
    });
    await referralResp.json().catch(() => null);

    // 3) E-mails (best-effort) via EmailJS REST
    const sendEmail = async (params) => {
      if (!sjsService || !sjsPublic) return;
      try {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: sjsService, template_id: sjsTemplate, user_id: sjsPublic,
            ...(sjsPrivate ? { accessToken: sjsPrivate } : {}),
            template_params: params
          })
        });
      } catch (e) { console.warn('create-referral email:', e.message); }
    };

    // Amigo indicado
    await sendEmail({
      to_email: friendEmail, to_name: friendName, booking_id: friendCode,
      titulo: `🎁 ${referrerName || 'Um amigo'} te indicou à SP Car Clean!`,
      mensagem:
        `Olá ${friendName.split(' ')[0]}! 👋\n\n` +
        `${referrerName || 'Um amigo seu'} indicou você para a SP Car Clean e preparamos um presente de boas-vindas:\n\n` +
        `🎁 ${FRIEND_PCT}% de desconto no seu primeiro serviço\n` +
        `👉 Cupom: ${friendCode}\n` +
        `📅 Válido até ${fmtBr(expiry)}\n\n` +
        `Como funciona: agende seu serviço no nosso site e informe o cupom ${friendCode} no campo de desconto. ` +
        `E o melhor: quando você fechar o serviço, ${referrerName || 'quem te indicou'} também ganha um cupom de agradecimento. Todo mundo sai ganhando! 🚗✨\n\n` +
        `Agende agora: ${siteUrl}\n\n— Equipe SP Car Clean`
    });

    // Quem indicou (confirmação)
    if (referrerEmail) {
      await sendEmail({
        to_email: referrerEmail, to_name: referrerName || 'Cliente', booking_id: friendCode,
        titulo: '🤝 Recebemos sua indicação — obrigado!',
        mensagem:
          `Olá ${(referrerName || 'Cliente').split(' ')[0]}! 🙌\n\n` +
          `Recebemos a sua indicação de ${friendName}. Já enviamos um cupom de ${FRIEND_PCT}% de desconto para ele(a).\n\n` +
          `Assim que ${friendName.split(' ')[0]} fechar o primeiro serviço, você receberá automaticamente um cupom de ${REFERRER_PCT}% de desconto por e-mail como agradecimento.\n\n` +
          `Obrigado por indicar a SP Car Clean! 🚗✨`
      });
    }

    // Admin (aviso)
    if (adminEmail) {
      await sendEmail({
        to_email: adminEmail, to_name: 'Equipe SP Car Clean', booking_id: friendCode,
        titulo: `🤝 Nova indicação — ${friendName}`,
        mensagem: `${referrerName || 'Cliente'} (${referrerEmail || 'sem e-mail'} / ${referrerPhone || 'sem telefone'}) indicou:\n\n` +
                  `Amigo: ${friendName}\nE-mail: ${friendEmail}\nTelefone: ${friendPhone}\nCupom enviado: ${friendCode} (${FRIEND_PCT}%)`
      });
    }

    return {
      statusCode: 200,
      // O código do cupom NÃO volta na resposta: ele vai só por e-mail ao
      // amigo. Devolvê-lo deixava qualquer pessoa gerar um cupom para si
      // informando um e-mail qualquer. O site nunca exibiu esse campo.
      body: JSON.stringify({ ok: true, friendPct: FRIEND_PCT, referrerPct: REFERRER_PCT, validUntil: expiry })
    };
  } catch (err) {
    console.error('create-referral error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'internal' }) };
  }
};

// Exportado para teste.
exports._interno = { refCode, nomeValido, POR_HORA };
