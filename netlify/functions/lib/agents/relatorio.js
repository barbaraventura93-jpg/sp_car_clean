'use strict';

module.exports = {
  id: 'relatorio',
  trigger: 'both',

  async run(_payload, core) {
    const now = new Date();
    const dow = now.getDay(); // 0=dom ... 6=sab

    // Segunda-feira desta semana
    const daysSinceMon = dow === 0 ? 6 : dow - 1;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - daysSinceMon);
    thisMonday.setHours(0, 0, 0, 0);

    // Semana passada (seg a dom)
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);

    // Semana retrasada (para comparativo)
    const prevMonday = new Date(lastMonday); prevMonday.setDate(lastMonday.getDate() - 7);
    const prevSunday = new Date(lastMonday); prevSunday.setDate(lastMonday.getDate() - 1);

    const fmt = d => d.toISOString().slice(0, 10);
    const fmtRange = (a, b) => `${fmt(a)} a ${fmt(b)}`;

    const [bookingsData, servicesData, config] = await Promise.all([
      core.firebase.dbGet('/bookings'),
      core.firebase.dbGet('/services'),
      core.firebase.dbGet('/config').catch(() => ({}))
    ]);

    const bkList    = bookingsData ? Object.values(bookingsData) : [];
    const svcMap    = servicesData || {};
    const brand     = config?.businessName || 'SP Car Clean';
    const maxPerDay = config?.maxPerDay    || 2;

    const activeStatus = new Set(['confirmed', 'approved', 'completed']);
    const bkVal = b => b.paidAmount || b.finalPrice || b.price || 0;

    const inRange = (b, from, to) => {
      const d = b.startDate || b.date;
      return d && d >= fmt(from) && d <= fmt(to) && activeStatus.has(b.status);
    };

    const lastBks = bkList.filter(b => inRange(b, lastMonday, lastSunday));
    const prevBks = bkList.filter(b => inRange(b, prevMonday, prevSunday));

    // Receita
    const lastRev = lastBks.reduce((s, b) => s + bkVal(b), 0);
    const prevRev = prevBks.reduce((s, b) => s + bkVal(b), 0);
    const revDelta = prevRev > 0 ? Math.round((lastRev - prevRev) / prevRev * 100) : null;

    // Serviço mais vendido
    const svcCount = {};
    for (const b of lastBks) {
      const id = b.service || b.services?.[0];
      if (id) svcCount[id] = (svcCount[id] || 0) + 1;
    }
    const topSvcId   = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topSvcName = topSvcId ? (svcMap[topSvcId]?.name || topSvcId) : '—';

    // Taxa de ocupação (seg a sex = 5 dias úteis)
    const workDays   = 5;
    const maxSlots   = workDays * maxPerDay;
    const occupancy  = Math.round((lastBks.length / maxSlots) * 100);

    // Clientes sem retorno há 90+ dias
    const clientLast = {};
    const cutoff90 = new Date(); cutoff90.setDate(cutoff90.getDate() - 90);
    const cut90Str = fmt(cutoff90);

    for (const b of bkList) {
      if (!b.email || !activeStatus.has(b.status)) continue;
      const d = b.startDate || b.date;
      if (!d) continue;
      if (!clientLast[b.email] || d > clientLast[b.email].date) {
        clientLast[b.email] = { date: d, name: b.name || b.email };
      }
    }
    const inactive90 = Object.entries(clientLast)
      .filter(([, v]) => v.date < cut90Str)
      .sort((a, b) => a[1].date.localeCompare(b[1].date))
      .slice(0, 5)
      .map(([, v]) => {
        const days = Math.floor((Date.now() - new Date(v.date).getTime()) / 86400000);
        return `${v.name} (${days} dias sem visita)`;
      });

    const context = [
      `Semana: ${fmtRange(lastMonday, lastSunday)}`,
      `Agendamentos: ${lastBks.length} (semana anterior: ${prevBks.length})`,
      `Receita bruta: R$ ${lastRev.toFixed(2)} (semana anterior: R$ ${prevRev.toFixed(2)}${revDelta !== null ? ', variação: ' + (revDelta >= 0 ? '+' : '') + revDelta + '%' : ''})`,
      `Serviço mais realizado: ${topSvcName}`,
      `Taxa de ocupação: ${occupancy}% (${lastBks.length} de ${maxSlots} vagas)`,
      `Clientes sem retorno há 90+ dias — top 5: ${inactive90.length ? inactive90.join(' | ') : 'nenhum no momento'}`,
    ].join('\n');

    const result = await core.claude.complete({
      system: `Você é o assistente de gestão da ${brand}. Escreva em português. Seja direto e objetivo.`,
      messages: [{
        role: 'user',
        content: `Com base nos dados abaixo, escreva um resumo executivo semanal em no máximo 12 linhas. Inclua os números fornecidos, variação vs semana anterior quando disponível, e exatamente 1 recomendação acionável ao final. Sem saudações, sem floreios.\n\n${context}`
      }],
      maxTokens: 800
    });

    const msg = `📊 *Relatório Semanal — ${brand}*\n_${fmtRange(lastMonday, lastSunday)}_\n\n${result.text}`;
    await core.telegram.sendTelegram(msg);

    return {
      ok: true,
      summary: `Relatório enviado (${lastBks.length} agend. · R$ ${lastRev.toFixed(2)})`
    };
  }
};
