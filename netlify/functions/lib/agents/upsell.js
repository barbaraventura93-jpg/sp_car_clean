'use strict';

module.exports = {
  id: 'upsell',
  trigger: 'http',

  async run(payload, core) {
    const { email, serviceId, lastService, lastDate, daysSince } = payload || {};
    if (!serviceId) throw new Error('serviceId obrigatório');

    const [servicesData, config] = await Promise.all([
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const svcMap     = servicesData || {};
    const brand      = config?.businessName || 'SP Car Clean';
    const selectedSvc = svcMap[serviceId];

    // Se o serviço não existe no catálogo, não há como sugerir complemento
    if (!selectedSvc) return { ok: true, suggestion: null, summary: 'Serviço não encontrado no catálogo' };

    const lastSvcName = lastService ? (svcMap[lastService]?.name || lastService) : null;

    const ctx = [
      `Serviço selecionado: ${selectedSvc.name}`,
      lastSvcName  ? `Último serviço realizado: ${lastSvcName}` : '',
      daysSince    ? `Dias desde a última visita: ${daysSince}` : '',
      !daysSince && lastDate ? `Data da última visita: ${lastDate}` : ''
    ].filter(Boolean).join('\n');

    const result = await core.claude.complete({
      system: `Você é o assistente de vendas da ${brand}. Seja conciso. Responda SOMENTE em JSON válido, sem texto extra.`,
      messages: [{
        role: 'user',
        content: `Contexto do cliente:\n${ctx}\n\nSe houver um complemento genuinamente útil para combinar com o serviço selecionado (ex: higienização + polimento, lavagem + proteção de vidros), sugira 1. Caso contrário, não sugira nada. Responda em JSON: {"service":"nome do serviço","reason":"justificativa de 1 frase"} se houver sugestão, ou {"service":null} se não houver.`
      }],
      maxTokens: 120
    });

    let suggestion = null;
    try {
      const raw    = result.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(raw);
      if (parsed.service && parsed.service !== 'null') {
        suggestion = { service: String(parsed.service), reason: parsed.reason || '' };
      }
    } catch {
      // Claude não retornou JSON válido — sem sugestão
    }

    return {
      ok: true,
      summary: suggestion ? `Sugestão: ${suggestion.service}` : 'Sem sugestão',
      suggestion
    };
  }
};
