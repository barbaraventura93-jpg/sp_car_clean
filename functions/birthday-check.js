// Cron diário às 09:00 BRT (12:00 UTC) — EventBridge Scheduler, infra/api.tf.
//
// E-mail de aniversário é MARKETING, não transacional: o cliente não pediu por
// ele. Então respeita o descadastro (lib/core/optout.js) — quem saiu da lista
// não recebe, e quem recebe leva o link de saída no `unsubscribe_url`.
//
// ⚠️ O `unsubscribe_url` só aparece no e-mail se o template do EmailJS
// (EMAILJS_BIRTHDAY_TEMPLATE) imprimir essa variável. Este template é fixo, com
// campos de cupom — ao contrário do `template_update`, que tem corpo livre.
// Enquanto o template não for editado, o cupom continua sendo criado e o envio
// continua respeitando o descadastro, mas o link não fica visível no corpo.

const optout   = require('./lib/core/optout');
const firebase = require('./lib/core/store');

exports.handler = async () => {
  // O banco é o DynamoDB desde 16/11/2026. O FIREBASE_DATABASE_SECRET segue
  // sendo lido por UM motivo: é a chave que assina o link de descadastro
  // (lib/core/optout.js). O nome ficou errado — é um segredo do projeto, não
  // mais do Firebase —, mas renomear exigiria criar outro parâmetro no SSM e
  // invalidaria links já enviados. Fica anotado como dívida.
  const assinante  = process.env.FIREBASE_DATABASE_SECRET;
  const sjsService = process.env.EMAILJS_SERVICE_ID;
  const sjsPublic  = process.env.EMAILJS_PUBLIC_KEY;
  const sjsPrivate = process.env.EMAILJS_PRIVATE_KEY;
  const sjsTemplate= process.env.EMAILJS_BIRTHDAY_TEMPLATE;
  const siteUrl    = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

  if (!assinante) {
    // Sem a chave não há link de descadastro válido, e aniversário é marketing.
    console.error('birthday-check: segredo de assinatura ausente — nada enviado');
    return { statusCode: 200, body: 'signing secret missing' };
  }

  const now      = new Date();
  const year     = now.getFullYear();
  const todayMMDD = now.toISOString().slice(5, 10); // "MM-DD"

  // Cupom válido até o dia 28 do próximo mês calendário
  const expiryMonth = ((now.getMonth() + 1) % 12) + 1;
  const expiryYear  = now.getMonth() === 11 ? year + 1 : year;
  const expiry      = `${expiryYear}-${String(expiryMonth).padStart(2,'0')}-28`;
  const expiryFmt   = `${expiry.slice(8)}/${expiry.slice(5,7)}/${expiry.slice(0,4)}`;

  try {
    const profiles = await firebase.dbGet('/clientProfiles');
    if (!profiles || typeof profiles !== 'object') {
      return { statusCode: 200, body: 'no profiles' };
    }

    // Uma leitura só para a lista inteira: checar um a um seria uma ida ao
    // banco por aniversariante.
    const descadastrados = await optout.carregarDescadastrados(firebase.dbGet);

    let sent = 0;
    let optedOut = 0;
    const errors = [];

    for (const [uid, profile] of Object.entries(profiles)) {
      if (!profile.birthDate || !profile.email) continue;
      if (profile.birthDate.slice(5) !== todayMMDD) continue;

      // Descadastrado não recebe e não ganha cupom: cupom gerado e não avisado
      // só polui o banco.
      if (descadastrados.has(optout.normaliza(profile.email))) {
        optedOut++;
        console.log(`birthday-check: ${profile.email} descadastrado — nada enviado`);
        continue;
      }

      const firstName = (profile.name || 'Cliente').replace(/\s.*/, '').toUpperCase().slice(0, 6);
      const code = `ANIV${firstName}${year}`;

      // Salvar o cupom
      await firebase.dbSet(`/coupons/${code}`, ({
          code,
          discountType: 'percent',
          discountValue: 10,
          minValue: 0,
          used: false,
          clientUid: uid,
          validUntil: expiry,
          createdAt: now.toISOString(),
          note: `Aniversário de ${profile.name} — gerado automaticamente`
        }));

      // Enviar e-mail via EmailJS
      if (sjsService && sjsPublic && sjsTemplate) {
        try {
          const emailResp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id:  sjsService,
              template_id: sjsTemplate,
              user_id:     sjsPublic,
              ...(sjsPrivate ? { accessToken: sjsPrivate } : {}),
              template_params: {
                to_name:     profile.name || 'Cliente',
                to_email:    profile.email,
                coupon_code: code,
                valid_until: expiryFmt,
                site_url:    siteUrl,
                // Ver o aviso no topo do arquivo: depende do template imprimir.
                unsubscribe_url: optout.linkDescadastro(profile.email, assinante, siteUrl)
              }
            })
          });
          const emailBody = await emailResp.text();
          console.log(`birthday-check: email enviado para ${profile.email} — ${emailBody}`);
          // Registra o envio de marketing: é o que sustenta o intervalo mínimo
          // da reativação, para o cliente não receber dois marketings na semana.
          await optout.registrarEnvio({ email: profile.email, assunto: 'aniversario', dbSet: firebase.dbSet })
            .catch((e) => console.error('birthday-check: registro de envio falhou:', e.message));
          sent++;
        } catch (emailErr) {
          errors.push({ uid, email: profile.email, error: emailErr.message });
        }
      } else {
        console.log(`birthday-check: cupom ${code} criado para ${profile.email} (EmailJS não configurado)`);
        sent++;
      }
    }

    console.log(`birthday-check: ${sent} aniversariante(s) hoje (${todayMMDD})`
      + (optedOut ? ` · ${optedOut} descadastrado(s) pulado(s)` : ''));
    return { statusCode: 200, body: JSON.stringify({ ok: true, date: todayMMDD, sent, optedOut, errors }) };

  } catch (err) {
    console.error('birthday-check error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
