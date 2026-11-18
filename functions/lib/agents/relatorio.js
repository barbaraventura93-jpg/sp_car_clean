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

    const fin = require('../core/financeiro');
    const activeStatus = fin.STATUS_ATIVO;
    const bkVal = fin.receitaDoAgendamento;

    const inRange = (b, from, to) => {
      const d = b.startDate || b.date;
      return d && d >= fmt(from) && d <= fmt(to) && activeStatus.has(b.status);
    };

    const lastBks = bkList.filter(b => inRange(b, lastMonday, lastSunday));
    const prevBks = bkList.filter(b => inRange(b, prevMonday, prevSunday));

    // Receita, custo e lucro. O custo vem dos insumos que cada serviço consome
    // (`pricing.<porte>.cost`), que o cadastro de serviço calcula.
    const resumo = fin.resumoFinanceiro(lastBks, svcMap);
    const antes  = fin.resumoFinanceiro(prevBks, svcMap);
    const lastRev  = resumo.receita;
    const prevRev  = antes.receita;
    const revDelta = fin.variacao(lastRev, prevRev);
    const lucroDelta = fin.variacao(resumo.lucro, antes.lucro);

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

    const pct = v => v === null ? '' : ` (${v >= 0 ? '+' : ''}${v}% vs anterior)`;
    const money = v => `R$ ${v.toFixed(2).replace('.', ',')}`;

    // Serviços realizados na semana que não têm insumos cadastrados: o custo
    // deles entra como zero, o que infla o lucro. Dizer isso é parte do número.
    const semCusto = resumo.semCusto
      .map(id => svcMap[id]?.name || id)
      .slice(0, 4);

    const context = [
      `Semana: ${fmtRange(lastMonday, lastSunday)}`,
      `Agendamentos: ${lastBks.length} (semana anterior: ${prevBks.length})`,
      `Receita: ${money(resumo.receita)} (anterior ${money(antes.receita)})`,
      `Custo de insumos: ${money(resumo.custo)} (anterior ${money(antes.custo)})`,
      `Lucro: ${money(resumo.lucro)} (anterior ${money(antes.lucro)})`,
      resumo.margem !== null ? `Margem: ${resumo.margem}%${antes.margem !== null ? ` (anterior ${antes.margem}%)` : ''}` : '',
      semCusto.length ? `ATENÇÃO: estes serviços não têm insumos cadastrados, então o custo deles entrou como zero e o lucro acima está superestimado: ${semCusto.join(', ')}` : '',
      `Serviço mais realizado: ${topSvcName}`,
      `Taxa de ocupação: ${occupancy}% (${lastBks.length} de ${maxSlots} vagas)`,
      `Clientes sem retorno há 90+ dias — top 5: ${inactive90.length ? inactive90.join(' | ') : 'nenhum no momento'}`,
    ].filter(Boolean).join('\n');

    const result = await core.claude.complete({
      system: `Você é o assistente de gestão da ${brand}. Escreva em português. Seja direto e objetivo.`,
      messages: [{
        role: 'user',
        content: `Escreva a LEITURA de uma semana de operação, em no máximo 8 linhas: o que os números dizem, o que mudou em relação à semana anterior e exatamente 1 recomendação acionável ao final.\n\nNÃO repita os números: eles já aparecem numa tabela acima do seu texto. Comente o que eles significam. Se houver aviso de serviço sem insumo cadastrado, trate isso como a principal pendência. Sem saudações, sem floreios.\n\n${context}`
      }],
      maxTokens: 600
    });

    // Os números vão na mensagem DIRETO, não pela IA. Modelo de linguagem
    // reescrevendo valor financeiro é jeito de publicar número errado com
    // aparência de certo; o texto dele comenta, não informa.
    const tabela = [
      `💰 Receita   *${money(resumo.receita)}*${pct(revDelta)}`,
      `📦 Custo     ${money(resumo.custo)}`,
      `✅ Lucro     *${money(resumo.lucro)}*${pct(lucroDelta)}`,
      resumo.margem !== null ? `📈 Margem    ${resumo.margem}%` : '',
      '',
      `🗓️ ${lastBks.length} agendamento(s) · ocupação ${occupancy}%`,
      `⭐ Mais vendido: ${topSvcName}`,
    ].filter(Boolean).join('\n');

    const aviso = semCusto.length
      ? `\n\n⚠️ _Custo subestimado: ${semCusto.join(', ')} ${semCusto.length === 1 ? 'não tem insumos cadastrados' : 'não têm insumos cadastrados'}._`
      : '';

    const msg = `📊 *Relatório Semanal — ${brand}*\n_${fmtRange(lastMonday, lastSunday)}_\n\n${tabela}${aviso}\n\n${result.text}`;
    await core.telegram.sendTelegram(msg);

    return {
      ok: true,
      summary: `Relatório enviado (${lastBks.length} agend. · receita ${money(resumo.receita)} · lucro ${money(resumo.lucro)})`
    };
  }
};
