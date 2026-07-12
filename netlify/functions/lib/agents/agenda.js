'use strict';

module.exports = {
  id: 'agenda',
  trigger: 'http',

  async run(payload, core) {
    const { freedDate, cancelledService, cancelledCarSize } = payload || {};
    if (!freedDate) throw new Error('freedDate não informado');

    const [waitlistData, bookingsData, profilesData, servicesData, config] = await Promise.all([
      core.firebase.dbGet('/waitlist').catch(() => ({})),
      core.firebase.dbGet('/bookings').catch(() => ({})),
      core.firebase.dbGet('/clientProfiles').catch(() => ({})),
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const brand    = config?.businessName || 'SP Car Clean';
    const svcMap   = servicesData || {};
    const waitlist = waitlistData ? Object.values(waitlistData) : [];
    const bkList   = bookingsData ? Object.values(bookingsData) : [];
    const profiles = profilesData || {};

    const entries = waitlist
      .filter(w => w.date === freedDate)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    if (entries.length === 0) {
      return { ok: true, summary: `Nenhum candidato na waitlist para ${freedDate}` };
    }

    const activeStatus = new Set(['confirmed', 'approved', 'completed']);
    const bkVal = b => b.paidAmount || b.finalPrice || b.price || 0;

    // Enriquecer cada candidato com histórico
    const candidates = entries.slice(0, 10).map(w => {
      const emailKey = (w.email || '').toLowerCase();
      const clientBks = emailKey
        ? bkList.filter(b => b.email?.toLowerCase() === emailKey && activeStatus.has(b.status))
        : [];
      const totalSpent = clientBks.reduce((s, b) => s + bkVal(b), 0);
      const vip        = totalSpent >= 1000 || clientBks.length >= 3;
      const lastBk     = clientBks.sort((a, b) => (b.startDate || b.date || '').localeCompare(a.startDate || a.date || ''))[0];
      const profile    = emailKey ? Object.values(profiles).find(p => p.email?.toLowerCase() === emailKey) : null;
      const daysInQ    = Math.floor((Date.now() - new Date(w.createdAt || Date.now()).getTime()) / 86400000);

      return {
        name:         w.name,
        phone:        w.phone,
        email:        w.email || '',
        vip,
        totalSpent,
        visits:       clientBks.length,
        lastService:  lastBk ? (svcMap[lastBk.service]?.name || lastBk.service) : null,
        daysInQueue:  daysInQ,
        points:       profile?.points || 0
      };
    });

    const dateFmt = new Date(freedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long'
    });
    const svcCancelled = cancelledService ? (svcMap[cancelledService]?.name || cancelledService) : 'não especificado';

    const ctx = candidates.map((c, i) =>
      `${i + 1}. ${c.name} — ${c.vip ? '⭐ VIP' : 'Regular'} — ${c.visits} visita(s) — R$ ${c.totalSpent.toFixed(0)} gasto — ${c.daysInQueue}d na fila` +
      (c.lastService ? ` — último serviço: ${c.lastService}` : '')
    ).join('\n');

    const result = await core.claude.complete({
      system: `Você é o assistente de gestão da ${brand}. Escreva em português, sem markdown desnecessário.`,
      messages: [{
        role: 'user',
        content: `Uma vaga foi liberada para ${dateFmt} (serviço cancelado: ${svcCancelled}).\n\nCandidatos na lista de espera (ordem de chegada):\n${ctx}\n\nRanqueie os 3 melhores para esta vaga considerando: compatibilidade de serviço, status VIP, tempo na fila e histórico de gastos. Para cada um, escreva uma mensagem de convite de 1-2 frases, mencionando nome e data. Liste claramente o ranking e as mensagens prontas.`
      }],
      maxTokens: 512
    });

    const top3 = candidates.slice(0, 3).map(c => `${c.name}${c.phone ? ' (' + c.phone + ')' : ''}`).join(', ');
    await core.telegram.sendTelegram(
      `📅 *Vaga liberada — ${dateFmt}*\n_Serviço cancelado: ${svcCancelled}_\n\nTop 3 candidatos: ${top3}\n\n${result.text}`
    );

    return {
      ok: true,
      summary: `Ranking de ${Math.min(entries.length, 3)} candidatos enviado para o Telegram (${freedDate})`
    };
  }
};
