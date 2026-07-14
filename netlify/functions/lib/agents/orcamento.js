'use strict';

// orcamento — orçamento visual por foto (visão do Claude)
// Payload: { imageBase64: string, imageType: 'image/jpeg'|'image/png'|'image/webp', userMessage?: string }
// Retorna: { text, suggestedServiceId }

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_B64_CHARS = 4_000_000; // ~3 MB em base64

module.exports = {
  id: 'orcamento',
  trigger: 'http',

  async run(payload, core) {
    const { imageBase64, imageType = 'image/jpeg', userMessage } = payload || {};
    if (!imageBase64) throw new Error('imageBase64 obrigatório');
    if (!ALLOWED_TYPES.has(imageType)) throw new Error('Tipo de imagem não suportado');
    if (imageBase64.length > MAX_B64_CHARS) throw new Error('Imagem muito grande — reduza a qualidade antes de enviar');

    const [servicesData, cfgData] = await Promise.all([
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const svcMap = servicesData || {};
    const brand  = (cfgData || {}).businessName || 'SP Car Clean';

    const catalog = Object.entries(svcMap)
      .filter(([, s]) => s.active !== false)
      .map(([id, s]) => {
        const pq = s.pq ? `R$ ${s.pq}` : null;
        const gr = s.gr ? `R$ ${s.gr}` : null;
        const prices = [pq && `pequeno: ${pq}`, gr && `grande: ${gr}`].filter(Boolean).join(' | ');
        return `[${id}] ${s.name} — ${prices}`;
      }).join('\n');

    const question = userMessage?.trim() || 'Que serviço você recomenda para este veículo?';

    const result = await core.claude.complete({
      system: `Você é especialista em estética automotiva da ${brand}. Analise a foto do veículo enviada pelo cliente e recomende o serviço mais adequado do catálogo abaixo.\n\nCATÁLOGO:\n${catalog}\n\nRESPOSTA:\n- Seja direto. Máximo 3 frases.\n- Indique o serviço recomendado e o preço aproximado conforme tamanho do veículo na foto.\n- Sempre inclua: "Sujeito a confirmação presencial."\n- Se recomendar serviço específico, inclua [AGENDAR:serviceId] ao final.`,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: imageType, data: imageBase64 }
          },
          { type: 'text', text: question }
        ]
      }],
      maxTokens: 512
    });

    const text = result.text.trim();
    const match = text.match(/\[AGENDAR:([a-z0-9_-]+)\]/i);
    const suggestedServiceId = match ? match[1] : null;
    const cleanText = text.replace(/\[AGENDAR:[a-z0-9_-]+\]/gi, '').trim();

    return {
      ok: true,
      text: cleanText,
      suggestedServiceId,
      summary: `Orçamento por foto: ${cleanText.slice(0, 80)}`
    };
  }
};
