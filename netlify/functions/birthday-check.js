// Netlify Scheduled Function — roda todo dia às 09:00 BRT (12:00 UTC)
// Configurado em netlify.toml: schedule = "0 12 * * *"

exports.handler = async () => {
  const dbUrl      = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret   = process.env.FIREBASE_DATABASE_SECRET;
  const sjsService = process.env.EMAILJS_SERVICE_ID;
  const sjsPublic  = process.env.EMAILJS_PUBLIC_KEY;
  const sjsPrivate = process.env.EMAILJS_PRIVATE_KEY;
  const sjsTemplate= process.env.EMAILJS_BIRTHDAY_TEMPLATE;
  const siteUrl    = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

  if (!dbUrl || !dbSecret) {
    console.error('birthday-check: FIREBASE_DATABASE_URL ou FIREBASE_DATABASE_SECRET ausente');
    return { statusCode: 200, body: 'db not configured' };
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
    const resp     = await fetch(`${dbUrl}/clientProfiles.json?auth=${dbSecret}`);
    const profiles = await resp.json();
    if (!profiles || typeof profiles !== 'object') {
      return { statusCode: 200, body: 'no profiles' };
    }

    let sent = 0;
    const errors = [];

    for (const [uid, profile] of Object.entries(profiles)) {
      if (!profile.birthDate || !profile.email) continue;
      if (profile.birthDate.slice(5) !== todayMMDD) continue;

      const firstName = (profile.name || 'Cliente').replace(/\s.*/, '').toUpperCase().slice(0, 6);
      const code = `ANIV${firstName}${year}`;

      // Salvar cupom no Firebase
      await fetch(`${dbUrl}/coupons/${code}.json?auth=${dbSecret}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          discountType: 'percent',
          discountValue: 10,
          minValue: 0,
          used: false,
          clientUid: uid,
          validUntil: expiry,
          createdAt: now.toISOString(),
          note: `Aniversário de ${profile.name} — gerado automaticamente`
        })
      });

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
                site_url:    siteUrl
              }
            })
          });
          const emailBody = await emailResp.text();
          console.log(`birthday-check: email enviado para ${profile.email} — ${emailBody}`);
          sent++;
        } catch (emailErr) {
          errors.push({ uid, email: profile.email, error: emailErr.message });
        }
      } else {
        console.log(`birthday-check: cupom ${code} criado para ${profile.email} (EmailJS não configurado)`);
        sent++;
      }
    }

    console.log(`birthday-check: ${sent} aniversariante(s) hoje (${todayMMDD})`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, date: todayMMDD, sent, errors }) };

  } catch (err) {
    console.error('birthday-check error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
