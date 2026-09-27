'use strict';

// concierge — chat widget público: responde dúvidas e recomenda serviços
// Payload: { messages: [{role:'user'|'assistant', content:string}], userMessage: string }
// Retorna: { text, suggestedServiceId }

module.exports = {
  id: 'concierge',
  trigger: 'http',

  async run(payload, core) {
    const { messages = [], userMessage } = payload || {};
    if (!userMessage?.trim()) throw new Error('userMessage obrigatório');

    const [servicesData, cfgData] = await Promise.all([
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const svcMap = servicesData || {};
    const cfg    = cfgData    || {};
    const brand  = cfg.businessName || 'SP Car Clean';
    const phone  = cfg.whatsapp     || '11926697474';
    const drop   = cfg.dropoffTime  || '08:00';
    const pickup = cfg.pickupTime   || '18:00';

    // Montar catálogo + FAQs para o prompt
    const catalog = Object.entries(svcMap)
      .filter(([, s]) => s.active !== false)
      .map(([id, s]) => {
        const pq = s.pq ? `R$ ${s.pq}` : null;
        const gr = s.gr ? `R$ ${s.gr}` : null;
        const prices = [pq && `carros pequenos: ${pq}`, gr && `carros grandes: ${gr}`].filter(Boolean).join(' | ');
        const faqLines = (s.faqs || []).map(f => `  P: ${f.q}\n  R: ${f.a}`).join('\n');
        return `• [${id}] ${s.icon || ''} ${s.name} — ${prices}\n${s.desc || ''}${faqLines ? '\n' + faqLines : ''}`;
      }).join('\n\n');

    const system = `Você é o assistente virtual da ${brand}, estúdio de estética automotiva em São Paulo.

CATÁLOGO DE SERVIÇOS:
${catalog || 'Catálogo temporariamente indisponível.'}

POLÍTICAS:
- Horário de entrega do veículo: ${drop}
- Previsão de retirada: ${pickup}
- Pagamento: à vista (Pix, cartão, dinheiro)
- Para cancelamentos ou questões específicas: WhatsApp (${phone})

REGRAS:
1. Cite apenas preços do catálogo. Nunca invente valores.
2. Não prometa descontos não informados.
3. Seja objetivo e amigável. Máximo 4 frases por resposta.
4. Para assuntos fora de estética automotiva, sugira contato via WhatsApp.
5. Ao recomendar um serviço específico, inclua no final da mensagem o marcador: [AGENDAR:serviceId] substituindo serviceId pelo ID correto do catálogo.
6. Responda em português informal mas cordial.`;

    // Histórico (máx. 10 mensagens anteriores para controlar tokens)
    const history = messages.slice(-10);
    const allMessages = [
      ...history,
      { role: 'user', content: userMessage.trim() }
    ];

    const result = await core.claude.complete({
      system,
      messages: allMessages,
      maxTokens: 600
    });

    const text = result.text.trim();

    // Extrair serviceId sugerido do marcador [AGENDAR:xxx]
    const match = text.match(/\[AGENDAR:([a-z0-9_-]+)\]/i);
    const suggestedServiceId = match ? match[1] : null;

    // Limpar o marcador do texto que vai ao usuário
    const cleanText = text.replace(/\[AGENDAR:[a-z0-9_-]+\]/gi, '').trim();

    return {
      ok: true,
      text: cleanText,
      suggestedServiceId,
      summary: `Concierge respondeu: ${cleanText.slice(0, 80)}`
    };
  }
};
