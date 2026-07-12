async function sendEmail({ templateId, params }) {
  const serviceId  = process.env.EMAILJS_SERVICE_ID;
  const publicKey  = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;
  if (!serviceId || !publicKey || !templateId) throw new Error('EmailJS não configurado');

  const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id:  serviceId,
      template_id: templateId,
      user_id:     publicKey,
      ...(privateKey ? { accessToken: privateKey } : {}),
      template_params: params
    })
  });
  if (!resp.ok) throw new Error(`EmailJS ${resp.status}: ${await resp.text()}`);
  return resp.text();
}

module.exports = { sendEmail };
