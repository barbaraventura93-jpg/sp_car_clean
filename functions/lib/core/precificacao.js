'use strict';

// Preço do agendamento, calculado no SERVIDOR.
//
// POR QUE EXISTE (achados S-05, S-07 e S-08 de docs/revisao-2026-11-09.md;
// item 7 do backlog): até 18/11/2026 o navegador somava os serviços, abatia
// cupom e gift card e gravava o resultado em `price`. O servidor aceitava o
// número como veio. Bastava editar a requisição para agendar um polimento
// de R$ 1.300 por R$ 1, e os pontos de fidelidade saíam desse mesmo número.
//
// Agora o navegador manda só O QUE o cliente escolheu (serviços, tamanho,
// códigos de cupom e de gift card) e este módulo decide QUANTO custa, com o
// catálogo e os registros lidos do banco. Os números que vierem no corpo são
// ignorados.
//
// Módulo puro, sem banco: recebe tudo o que precisa e devolve o cálculo. É o
// que permite testar cada regra sem rede (scripts/test-precificacao.js).
//
// As regras são as MESMAS que o app.js aplicava na tela (validateCoupon,
// applyGiftCardInBooking, bkPrice). Mudou quem calcula, não o resultado:
// o cliente honesto vê o mesmo valor de antes.

const TAMANHOS = new Set(['pq', 'gr']);
const MAX_SERVICOS = 15;

const centavos = (v) => Math.round(v * 100) / 100;
const numero = (v) => typeof v === 'number' && Number.isFinite(v);

/** Preço de venda de um serviço no tamanho pedido. Mesma leitura do app.js. */
function precoDoServico(s, tamanho) {
  const venda = s?.pricing?.[tamanho]?.sale;
  const v = venda ?? s?.[tamanho] ?? null;
  return numero(v) && v >= 0 ? v : null;
}

/**
 * Soma dos serviços pelo catálogo do banco.
 *
 * Serviço que não está no catálogo, ou está desativado, RECUSA o pedido. Na
 * tela, serviço removido vira preço 0 para não quebrar a página; aqui, aceitar
 * isso seria vender de graça o que não existe mais.
 */
function precoBase(servicos, tamanho, catalogo) {
  if (!TAMANHOS.has(tamanho)) return { erro: 'tamanho do veículo inválido' };
  if (!Array.isArray(servicos) || !servicos.length) return { erro: 'escolha ao menos um serviço' };
  if (servicos.length > MAX_SERVICOS) return { erro: 'serviços demais no pedido' };
  if (new Set(servicos).size !== servicos.length) return { erro: 'serviço repetido no pedido' };
  if (!catalogo || typeof catalogo !== 'object') return { erro: 'catálogo indisponível' };

  let total = 0;
  for (const id of servicos) {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(catalogo, id)) {
      return { erro: `serviço indisponível: ${String(id).slice(0, 40)}` };
    }
    const s = catalogo[id];
    if (!s || s.active === false) return { erro: `serviço indisponível: ${id}` };
    const p = precoDoServico(s, tamanho);
    if (p === null) return { erro: `serviço sem preço: ${id}` };
    total += p;
  }
  return { base: centavos(total) };
}

/**
 * O cupom vale para este pedido? Devolve `{ desconto }` ou `{ erro }`.
 *
 * `quem` é a identidade VERIFICADA pelo token (ou null para visitante). O
 * cupom preso a um cliente (`clientUid`) só vale para ele, e o servidor não
 * aceita o uid que viesse no corpo.
 */
function validarCupom(cupom, { total, email, quem, agora = new Date() }) {
  if (!cupom || typeof cupom !== 'object') return { erro: 'Cupom não encontrado.' };
  if (cupom.used) return { erro: 'Cupom já utilizado.' };
  if (cupom.validUntil && new Date(cupom.validUntil) < agora) return { erro: 'Cupom expirado.' };
  if (cupom.clientUid && cupom.clientUid !== quem?.uid) return { erro: 'Cupom não válido para este cliente.' };
  if (cupom.clientEmail) {
    const de = String(email || '').trim().toLowerCase();
    if (de !== String(cupom.clientEmail).trim().toLowerCase()) {
      return { erro: 'Cupom válido apenas para o e-mail indicado.' };
    }
  }
  if (numero(cupom.minValue) && total < cupom.minValue) {
    return { erro: `Pedido mínimo de R$ ${cupom.minValue} para este cupom.` };
  }
  const valor = Number(cupom.discountValue);
  if (!Number.isFinite(valor) || valor <= 0) return { erro: 'Cupom inválido.' };
  const desconto = cupom.discountType === 'percent'
    ? Math.round(total * Math.min(valor, 100) / 100)
    : valor;
  // Desconto maior que o pedido não vira crédito.
  return { desconto: centavos(Math.min(desconto, total)) };
}

/** Quanto do gift card entra neste pedido. Devolve `{ usar }` ou `{ erro }`. */
function usoDoGiftCard(gc, restante) {
  if (!gc || typeof gc !== 'object') return { erro: 'Gift card não encontrado.' };
  if (gc.status === 'pending') return { erro: 'Gift card ainda não ativado — pagamento pendente.' };
  if (gc.status === 'depleted') return { erro: 'Gift card sem saldo.' };
  if (gc.status !== 'active' || !numero(gc.balance) || gc.balance <= 0) {
    return { erro: 'Gift card inválido ou sem saldo.' };
  }
  return { usar: centavos(Math.min(gc.balance, Math.max(0, restante))) };
}

/**
 * Cálculo completo do pedido.
 *
 * @param {object} p
 * @param {string[]} p.servicos   ids escolhidos
 * @param {string}   p.tamanho    'pq' | 'gr'
 * @param {object}   p.catalogo   nó `services` lido do banco
 * @param {object}  [p.cupom]     registro `coupons/<código>` (null se não pediu)
 * @param {object}  [p.giftcard]  registro `giftcards/<código>` (null se não pediu)
 * @param {boolean} [p.pediuCupom] o cliente digitou um cupom
 * @param {boolean} [p.pediuGift]  o cliente digitou um gift card
 * @returns {{ erro: string } | { base, couponDiscount, giftCardUsed, price, saldoGift }}
 */
function calcular(p) {
  const b = precoBase(p.servicos, p.tamanho, p.catalogo);
  if (b.erro) return { erro: b.erro };

  let couponDiscount = 0;
  if (p.pediuCupom) {
    const c = validarCupom(p.cupom, { total: b.base, email: p.email, quem: p.quem, agora: p.agora });
    if (c.erro) return { erro: c.erro };
    couponDiscount = c.desconto;
  }

  let giftCardUsed = 0;
  let saldoGift = null;
  if (p.pediuGift) {
    const g = usoDoGiftCard(p.giftcard, b.base - couponDiscount);
    if (g.erro) return { erro: g.erro };
    giftCardUsed = g.usar;
    saldoGift = centavos(p.giftcard.balance - giftCardUsed);
  }

  return {
    base: b.base,
    couponDiscount,
    giftCardUsed,
    price: centavos(Math.max(0, b.base - couponDiscount - giftCardUsed)),
    saldoGift,
  };
}

module.exports = { TAMANHOS, precoDoServico, precoBase, validarCupom, usoDoGiftCard, calcular };
