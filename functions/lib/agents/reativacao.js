'use strict';

const MAX_CLIENTS = 20; // limite por chamada para controlar tokens

module.exports = {
  id: 'reativacao',
  trigger: 'http',

  async run(payload, core) {
    const { clients, coupon } = payload || {};
    if (!Array.isArray(clients) || clients.length === 0) {
      throw new Error('Nenhum cliente selecionado');
    }

    const [servicesData, config] = await Promise.all([
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const svcMap = servicesData || {};
    const brand  = config?.businessName || 'SP Car Clean';

    const drafts = [];

    for (const client of clients.slice(0, MAX_CLIENTS)) {
      const lastSvcName = client.lastService
        ? (svcMap[client.lastService]?.name || client.lastService)
        : null;

      const daysSince = client.lastDate
        ? Math.floor((Date.now() - new Date(client.lastDate).getTime()) / 86400000)
        : null;

      const ctx = [
        `Cliente: ${client.name}`,
        client.car   ? `Veículo: ${client.car}` : '',
        lastSvcName  ? `Último serviço: ${lastSvcName}` : '',
        daysSince    ? `Dias sem visita: ${daysSince}` : '',
        client.vip   ? 'Status: VIP' : '',
        client.points ? `Pontos acumulados: ${client.points}` : '',
        coupon       ? `Cupom a oferecer: ${coupon}` : ''
      ].filter(Boolean).join('\n');

      const result = await core.claude.complete({
        system: `Você é o assistente de relacionamento da ${brand}, estúdio de estética automotiva em São Paulo. Escreva em português. Tom cordial e direto. Máximo 5 linhas.`,
        messages: [{
          role: 'user',
          content: `Escreva o corpo de um e-mail de reativação para este cliente. Mencione o veículo e o último serviço. Sugira o próximo serviço mais lógico (ex: polimento se foi lavagem, higienização se faz tempo). ${coupon ? 'Mencione o cupom.' : ''} Sem assunto, sem saudação formal, sem assinatura — apenas o corpo.\n\n${ctx}`
        }],
        maxTokens: 400
      });

      drafts.push({ email: client.email, name: client.name, text: result.text });
    }

    return {
      ok: true,
      summary: `${drafts.length} texto(s) gerado(s) para revisão`,
      drafts
    };
  }
};
