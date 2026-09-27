'use strict';

// insumos — previsão semanal de reposição de estoque
// Lê /stock, /stockRecipes e /bookings; calcula consumo projetado dos
// agendamentos dos próximos 14 dias e alerta via Telegram

const HORIZON_DAYS = 14;

module.exports = {
  id: 'insumos',
  trigger: 'both',

  async run(_payload, core) {
    const [stockData, recipesData, bookingsData] = await Promise.all([
      core.firebase.dbGet('/stock').catch(() => null),
      core.firebase.dbGet('/stockRecipes').catch(() => null),
      core.firebase.dbGet('/bookings').catch(() => null)
    ]);

    if (!stockData) return { ok: true, summary: 'Nenhum produto de estoque cadastrado' };

    const stock   = stockData;
    const recipes = recipesData || {};
    const bkList  = bookingsData ? Object.values(bookingsData) : [];

    // Agendamentos futuros aprovados/confirmados dentro do horizonte
    const today    = new Date();
    const horizon  = new Date(today.getTime() + HORIZON_DAYS * 86400000);
    const todayStr = today.toISOString().slice(0, 10);
    const horiStr  = horizon.toISOString().slice(0, 10);

    const upcoming = bkList.filter(b => {
      const date = b.startDate || b.date || '';
      return (
        (b.status === 'approved' || b.status === 'confirmed') &&
        date >= todayStr &&
        date <= horiStr
      );
    });

    // Calcular consumo projetado
    const projected = {}; // { productId: total_consumption }
    for (const b of upcoming) {
      const svcIds = (b.services || (b.service ? [b.service] : [])).filter(Boolean);
      const size   = b.carSize || 'pq';
      for (const svcId of svcIds) {
        const recipe = recipes[svcId];
        if (!recipe) continue;
        for (const [pid, amounts] of Object.entries(recipe)) {
          const consume = (amounts[size] ?? amounts.pq ?? 0);
          projected[pid] = (projected[pid] || 0) + consume;
        }
      }
    }

    // Classificar itens
    const products = Object.entries(stock).map(([id, p]) => ({
      id,
      name:     p.name     || id,
      unit:     p.unit     || 'un',
      qty:      p.qty      || 0,
      minQty:   p.minQty   || 0,
      costPer:  p.costPerUnit || 0,
      consumed: projected[id] || 0,
      remaining: Math.max(0, (p.qty || 0) - (projected[id] || 0))
    }));

    const outOfStock  = products.filter(p => p.qty <= 0 && p.minQty > 0);
    const alreadyLow  = products.filter(p => p.qty > 0 && p.minQty > 0 && p.qty < p.minQty);
    const willBeLow   = products.filter(p => p.qty >= p.minQty && p.minQty > 0 && p.remaining < p.minQty);

    const critical = [...outOfStock, ...alreadyLow, ...willBeLow];

    if (!critical.length && upcoming.length === 0) {
      await core.telegram.sendTelegram(
        `📦 *Reposição de Insumos*\n✅ Estoque OK — nenhum item crítico para os próximos ${HORIZON_DAYS} dias.`
      );
      return { ok: true, summary: 'Estoque OK — sem itens críticos' };
    }

    // Contexto para o Claude
    const ctx = [
      `Agendamentos nos próximos ${HORIZON_DAYS} dias: ${upcoming.length}`,
      outOfStock.length ? `SEM ESTOQUE: ${outOfStock.map(p => `${p.name} (${p.unit})`).join(', ')}` : '',
      alreadyLow.length ? `ABAIXO DO MÍNIMO: ${alreadyLow.map(p => `${p.name} (atual ${p.qty.toFixed(0)} ${p.unit}, mín ${p.minQty} ${p.unit})`).join('; ')}` : '',
      willBeLow.length  ? `FICARÁ ABAIXO APÓS OS AGENDAMENTOS: ${willBeLow.map(p => `${p.name} (atual ${p.qty.toFixed(0)}, consumo previsto ${p.consumed.toFixed(0)}, restará ${p.remaining.toFixed(0)} ${p.unit}, mín ${p.minQty} ${p.unit})`).join('; ')}` : ''
    ].filter(Boolean).join('\n');

    const result = await core.claude.complete({
      system: 'Você é o gestor de insumos de um estúdio de estética automotiva. Seja direto e objetivo.',
      messages: [{
        role: 'user',
        content: `Situação de estoque:\n${ctx}\n\nEscreva uma recomendação de reposição em 3-4 frases: o que comprar com mais urgência, quantidade sugerida (2x o mínimo para folga) e qual impacto terá nos atendimentos se não reposto. Use linguagem prática.`
      }],
      maxTokens: 400
    });

    // Montar mensagem Telegram
    const lines = [
      `📦 *Previsão de Reposição — ${HORIZON_DAYS} dias*`,
      `_${upcoming.length} agendamento(s) no período_`
    ];
    if (outOfStock.length) {
      lines.push('\n🔴 *Sem estoque:*');
      outOfStock.forEach(p => lines.push(`• ${p.name} — ${p.unit === 'h' ? 'mão de obra' : `0 ${p.unit}`}`));
    }
    if (alreadyLow.length) {
      lines.push('\n⚠️ *Abaixo do mínimo agora:*');
      alreadyLow.forEach(p => lines.push(`• ${p.name}: ${p.qty.toFixed(0)} ${p.unit} (mín: ${p.minQty} ${p.unit})`));
    }
    if (willBeLow.length) {
      lines.push('\n📉 *Ficará baixo após os agendamentos:*');
      willBeLow.forEach(p => lines.push(`• ${p.name}: restará ${p.remaining.toFixed(0)} ${p.unit} (mín: ${p.minQty} ${p.unit})`));
    }
    lines.push(`\n💡 ${result.text.trim()}`);

    await core.telegram.sendTelegram(lines.join('\n'));

    const summary = `${critical.length} item(ns) crítico(s): ${critical.map(p => p.name).join(', ')}`;
    return { ok: true, summary };
  }
};
