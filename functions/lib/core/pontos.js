'use strict';

// Pontos de fidelidade: creditados quando o PAGAMENTO É CONFIRMADO.
//
// Regra da Bárbara (18/11/2026): os pontos caem depois do pagamento confirmado,
// seja ele
//   - pelo site: o webhook da InfinitePay confirma (functions/infinitepay-webhook.js);
//   - direto para a empresa (dinheiro ou Pix): a admin registra no painel que
//     recebeu (op `confirmar-recebimento` do /api/admin-data).
//
// Antes, os pontos caíam quando o CLIENTE apertava "confirmar pagamento" no
// site (/api/me). Era a palavra do cliente, sem pagamento verificado.
//
// Crédito único por agendamento: `pointsAwardedAt` no agendamento. A marca e a
// soma no perfil vão numa transação (store.dbTransacao), com a condição de que
// a marca ainda não exista e de que o saldo do perfil seja o que foi lido.
// Webhook e painel confirmando o mesmo agendamento ao mesmo tempo: só um
// credita.
//
// O valor é o do SERVIÇO (`finalPrice`, definido pela admin na aprovação, ou o
// `price` calculado pelo servidor). Não é o `paidAmount`, que pode incluir a
// taxa do cartão: a taxa não é compra de serviço.

const HISTORICO_MAX = 100;

function pontosDoValor(valor, porReal) {
  const fator = Number.isFinite(porReal) && porReal > 0 ? porReal : 1;
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  return Math.floor(valor * fator);
}

/**
 * Credita os pontos do agendamento `id`, se couber. Nunca lança por regra de
 * negócio: devolve `{ creditado, motivo? , saldo? }`.
 *
 * @param {string} id
 * @param {{ store: object, agora?: Date }} deps
 */
async function creditarPorPagamento(id, { store, agora = new Date() }) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const b = await store.dbGet(`bookings/${id}`);
    if (!b) return { creditado: 0, motivo: 'agendamento não encontrado' };
    if (!b.paymentConfirmedAt) return { creditado: 0, motivo: 'pagamento não confirmado' };
    if (b.pointsAwardedAt) return { creditado: 0, motivo: 'já creditado' };
    if (!b.clientUid) return { creditado: 0, motivo: 'agendamento sem conta de cliente' };

    const cfg = (await store.dbGet('config').catch(() => null)) || {};
    const ganhos = pontosDoValor(Number(b.finalPrice || b.price || 0), Number(cfg.pointsPerReal));
    if (ganhos <= 0) return { creditado: 0, motivo: 'sem valor' };

    const perfil = await store.dbGet(`clientProfiles/${b.clientUid}`);
    if (!perfil) return { creditado: 0, motivo: 'cliente sem perfil' };

    const atual = Number(perfil.points || 0);
    const historico = Array.isArray(perfil.pointsHistory) ? perfil.pointsHistory : [];
    const quando = agora.toISOString();
    const novoHistorico = [...historico, {
      at: quando, delta: ganhos, bookingId: id, motivo: 'pagamento confirmado',
    }].slice(-HISTORICO_MAX);

    try {
      await store.dbTransacao([
        {
          tipo: 'atualizar',
          caminho: `bookings/${id}`,
          campos: { pointsAwardedAt: quando, pointsAwarded: ganhos },
          seAusenteOuIgual: { pointsAwardedAt: null },
        },
        {
          tipo: 'atualizar',
          caminho: `clientProfiles/${b.clientUid}`,
          campos: { points: atual + ganhos, pointsHistory: novoHistorico },
          // O saldo tem de ser o lido: outro crédito no meio faz esta tentativa
          // falhar e recomeçar, em vez de sobrescrever o saldo.
          seAusenteOuIgual: { points: perfil.points === undefined ? null : perfil.points },
        },
      ]);
      return { creditado: ganhos, saldo: atual + ganhos };
    } catch (err) {
      if (!err.condicaoFalhou) throw err;
      // Releitura: ou outro caminho já creditou (sai com "já creditado"), ou o
      // saldo mudou e a segunda tentativa usa o novo.
    }
  }
  return { creditado: 0, motivo: 'conflito ao creditar — tente de novo' };
}

module.exports = { creditarPorPagamento, pontosDoValor };
