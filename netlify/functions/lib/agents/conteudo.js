'use strict';

// conteudo — gera legenda de galeria + legenda de Instagram a partir do par antes/depois
// Payload: { beforeBase64, afterBase64, imageType?, service?, car? }
// Retorna: { caption, instagram }

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_B64_CHARS = 4_000_000; // ~3 MB

module.exports = {
  id: 'conteudo',
  trigger: 'http',

  async run(payload, core) {
    const {
      beforeBase64, afterBase64,
      imageType = 'image/jpeg',
      service, car
    } = payload || {};

    if (!beforeBase64 || !afterBase64) throw new Error('beforeBase64 e afterBase64 são obrigatórios');
    if (!ALLOWED_TYPES.has(imageType))  throw new Error('Tipo de imagem não suportado');
    if (beforeBase64.length > MAX_B64_CHARS || afterBase64.length > MAX_B64_CHARS) {
      throw new Error('Imagem muito grande — reduza a qualidade antes de enviar');
    }

    const [servicesData, cfgData] = await Promise.all([
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const svcMap = servicesData || {};
    const brand  = (cfgData || {}).businessName || 'SP Car Clean';
    const svcName = service ? (svcMap[service]?.name || service) : null;

    const ctx = [
      svcName && `Serviço: ${svcName}`,
      car     && `Veículo: ${car}`
    ].filter(Boolean).join(' | ');

    const result = await core.claude.complete({
      system: `Você cria legendas para o estúdio de estética automotiva ${brand}. Seu tom é profissional, entusiasmado e acessível.`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageType, data: beforeBase64 } },
          { type: 'text',  text: 'Foto ANTES' },
          { type: 'image', source: { type: 'base64', media_type: imageType, data: afterBase64  } },
          { type: 'text',  text: `Foto DEPOIS${ctx ? '\n\nContexto: ' + ctx : ''}\n\nGere EXATAMENTE este JSON (sem texto extra):\n{"caption":"<título curto da galeria, máx 60 chars, ex: Polimento Completo — Civic Preto>","instagram":"<legenda Instagram de 2-3 frases descrevendo a transformação + 4-6 hashtags relevantes ao detailing automotivo>"}` }
        ]
      }],
      maxTokens: 512
    });

    let caption   = '';
    let instagram = '';

    try {
      const raw    = result.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(raw);
      caption   = String(parsed.caption   || '').trim();
      instagram = String(parsed.instagram || '').trim();
    } catch {
      // Claude não retornou JSON válido — extrair manualmente o que houver
      caption   = result.text.slice(0, 60).trim();
      instagram = result.text.trim();
    }

    return {
      ok: true,
      caption,
      instagram,
      summary: `Legenda gerada: "${caption}"`
    };
  }
};
