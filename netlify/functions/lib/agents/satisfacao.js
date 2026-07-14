'use strict';

// satisfacao — análise diária de satisfação via /feedback
// Cron: daily:08 — alerta notas baixas via Telegram
// Segunda-feira: também gera resumo semanal de padrões

module.exports = {
  id: 'satisfacao',
  trigger: 'both',

  async run(payload, core) {
    const { dbGet, dbPatch } = core.firebase;

    const [feedbackData, agentCfg] = await Promise.all([
      dbGet('/feedback').catch(() => null),
      dbGet('/aiConfig/satisfacao').catch(() => null)
    ]);

    if (!feedbackData) return { ok: true, summary: 'Sem feedback para analisar' };

    const entries = Object.entries(feedbackData).map(([id, v]) => ({ id, ...v }));
    const lastRun = agentCfg?.lastRun || null;

    // Filtrar apenas entradas novas desde o último run
    const newEntries = lastRun
      ? entries.filter(e => e.submittedAt && e.submittedAt > lastRun)
      : entries;

    const now = new Date().toISOString();

    if (!newEntries.length) {
      await dbPatch('/aiConfig/satisfacao', { lastRun: now });
      return { ok: true, summary: 'Nenhuma avaliação nova desde o último ciclo' };
    }

    // Separar por nota
    const low  = newEntries.filter(e => (e.rating || 0) <= 3);
    const high = newEntries.filter(e => (e.rating || 0) >= 4 && (e.comment || '').length >= 30);

    const alerts = [];

    // Alertar notas baixas individualmente via Telegram
    for (const e of low) {
      const stars = '⭐'.repeat(e.rating || 0);
      const msg = `⚠️ *Avaliação negativa — ${stars}*\n` +
        `*Cliente:* ${e.clientName || 'Anônimo'}\n` +
        `*Serviço:* ${e.service || '—'}\n` +
        `*Comentário:* ${(e.comment || '').slice(0, 300) || 'sem comentário'}\n` +
        `*Data:* ${e.date || e.submittedAt?.slice(0, 10) || '—'}`;
      await core.telegram.sendTelegram(msg);
      alerts.push(`⭐${e.rating} — ${e.clientName || 'Anônimo'}`);
    }

    // Segunda-feira: resumo semanal de padrões
    const isMonday = new Date().getDay() === 1;
    let patternSummary = '';

    if (isMonday && entries.length >= 3) {
      const sample = entries
        .filter(e => e.comment && e.comment.length > 10)
        .slice(-30)
        .map(e => `[${e.rating}★] ${e.service || ''}: "${(e.comment || '').slice(0, 120)}"`)
        .join('\n');

      if (sample) {
        const result = await core.claude.complete({
          system: 'Você analisa avaliações de clientes de uma lavanderia automotiva. Identifique padrões, elogios recorrentes e principais pontos de melhoria.',
          messages: [{
            role: 'user',
            content: `Avaliações recentes:\n${sample}\n\nEscreva um parágrafo conciso (máx. 5 frases) identificando padrões positivos e negativos. Inclua 1 recomendação de melhoria.`
          }],
          maxTokens: 400
        });
        patternSummary = result.text.trim();
        await core.telegram.sendTelegram(
          `📊 *Padrões de Satisfação — semana*\n\n${patternSummary}\n\n_(${entries.length} avaliação(ões) analisada(s))_`
        );
      }
    }

    await dbPatch('/aiConfig/satisfacao', { lastRun: now });

    const summary = [
      `${newEntries.length} avaliação(ões) analisada(s)`,
      low.length  ? `${low.length} alerta(s) de nota baixa enviado(s)` : '',
      high.length ? `${high.length} depoimento(s) positivo(s) identificado(s)` : '',
      patternSummary ? 'Resumo semanal gerado' : ''
    ].filter(Boolean).join(' | ');

    return { ok: true, summary };
  }
};
