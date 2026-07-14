'use strict';

// checkin — descreve condições do veículo a partir das fotos de avaria
// Payload: { photoUrls: { [itemKey]: url }, bookingInfo: { car?, service?, carSize? } }
// Retorna: { text } — texto pronto para preencher o campo ciObs

const MAX_PHOTOS = 5;

module.exports = {
  id: 'checkin',
  trigger: 'http',

  async run(payload, core) {
    const { photoUrls = {}, bookingInfo = {} } = payload || {};

    const urls = Object.entries(photoUrls)
      .filter(([, url]) => url && url.startsWith('http'))
      .slice(0, MAX_PHOTOS);

    if (!urls.length) throw new Error('Nenhuma foto de avaria disponível para descrever');

    const svcMap = await core.firebase.dbGet('/services').catch(() => ({}));
    const svcName = bookingInfo.service
      ? (svcMap?.[bookingInfo.service]?.name || bookingInfo.service)
      : null;

    const context = [
      bookingInfo.car    && `Veículo: ${bookingInfo.car}`,
      svcName            && `Serviço agendado: ${svcName}`,
      bookingInfo.carSize && `Porte: ${bookingInfo.carSize === 'pq' ? 'pequeno' : 'grande'}`
    ].filter(Boolean).join(' | ');

    // Montar mensagem multimodal com até MAX_PHOTOS imagens
    const contentBlocks = [];
    urls.forEach(([key, url]) => {
      contentBlocks.push({
        type: 'image',
        source: { type: 'url', url }
      });
      contentBlocks.push({
        type: 'text',
        text: `Área: ${key}`
      });
    });
    contentBlocks.push({
      type: 'text',
      text: `${context ? 'Contexto: ' + context + '\n\n' : ''}Descreva de forma objetiva as condições visíveis nas fotos acima (avarias, riscos, manchas, amassados, sujeira interna). Gere um único parágrafo de observações gerais para o relatório de check-in. Máximo 5 frases, linguagem técnica e impessoal.`
    });

    const result = await core.claude.complete({
      system: 'Você é um técnico de estética automotiva preenchendo o formulário de check-in de um veículo. Seja preciso, objetivo e profissional.',
      messages: [{ role: 'user', content: contentBlocks }],
      maxTokens: 400
    });

    const text = result.text.trim();
    return {
      ok: true,
      text,
      summary: `Check-in descrito (${urls.length} foto(s)): ${text.slice(0, 60)}`
    };
  }
};
