'use strict';

// Criação do agendamento pelo site público, com o preço decidido no servidor.
//
// O navegador manda o pedido; aqui:
//   1. o preço sai do catálogo do banco (lib/core/precificacao.js), e os
//      números que vierem no corpo (`price`, `couponDiscount`, `giftCardUsed`)
//      são descartados;
//   2. o cupom e o gift card são conferidos contra os registros do banco;
//   3. o agendamento, a baixa do cupom e o desconto do gift card são gravados
//      numa TRANSAÇÃO: ou entram os três, ou nenhum.
//
// Antes disso, a baixa do cupom dependia de uma escrita que as regras negavam
// ao visitante — então cupom de uso único nunca era baixado e podia ser usado
// de novo. E o gift card era descontado pelo navegador, num passo separado,
// no valor que o próprio navegador escolhia.
//
// O `store` é parâmetro para o teste trocar o banco por um em memória.

const precificacao = require('./precificacao');

const CODIGO = /^[A-Z0-9_-]{2,40}$/;
const normalizarCodigo = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

// O que o servidor recalcula e, portanto, não aceita do corpo.
const CALCULADOS = ['price', 'basePrice', 'couponDiscount', 'giftCardUsed', 'couponCode', 'giftCardCode', 'pricedBy'];

/**
 * @param {string} id  código do agendamento (já validado pelo caminho)
 * @param {object} pedido  corpo enviado pelo navegador (já aprovado por
 *   regras-publicas: nasce pendente, id confere, sem campo de pagamento)
 * @param {object|null} quem  identidade verificada pelo token, ou null
 * @returns {Promise<{ status: number, erro?: string, agendamento?: object }>}
 */
async function criarAgendamentoPublico(id, pedido, quem, { store, agora = new Date() } = {}) {
  const codCupom = normalizarCodigo(pedido.couponCode);
  const codGift = normalizarCodigo(pedido.giftCardCode);
  if (codCupom && !CODIGO.test(codCupom)) return { status: 422, erro: 'Cupom não encontrado.' };
  if (codGift && !CODIGO.test(codGift)) return { status: 422, erro: 'Gift card não encontrado.' };

  const [catalogo, cupom, giftcard] = await Promise.all([
    store.dbGet('services'),
    codCupom ? store.dbGet(`coupons/${codCupom}`) : null,
    codGift ? store.dbGet(`giftcards/${codGift}`) : null,
  ]);

  const servicos = Array.isArray(pedido.services) ? pedido.services
    : (pedido.service ? [pedido.service] : []);

  const calc = precificacao.calcular({
    servicos,
    tamanho: pedido.carSize,
    catalogo,
    pediuCupom: !!codCupom,
    cupom,
    pediuGift: !!codGift,
    giftcard,
    email: pedido.email,
    quem,
    agora,
  });
  if (calc.erro) return { status: 422, erro: calc.erro };

  const agendamento = { ...pedido };
  for (const c of CALCULADOS) delete agendamento[c];
  Object.assign(agendamento, {
    services: servicos,
    service: servicos[0],
    basePrice: calc.base,
    price: calc.price,
    pricedBy: 'server',
    ...(codCupom ? { couponCode: codCupom, couponDiscount: calc.couponDiscount } : {}),
    ...(codGift && calc.giftCardUsed > 0 ? { giftCardCode: codGift, giftCardUsed: calc.giftCardUsed } : {}),
  });

  const quando = agora.toISOString();
  const escritas = [{ tipo: 'criar', caminho: `bookings/${id}`, valor: agendamento }];
  if (codCupom) {
    escritas.push({
      tipo: 'atualizar',
      caminho: `coupons/${codCupom}`,
      campos: { used: true, usedAt: quando, usedBy: id },
      seAusenteOuIgual: { used: false },
    });
  }
  if (codGift && calc.giftCardUsed > 0) {
    escritas.push({
      tipo: 'atualizar',
      caminho: `giftcards/${codGift}`,
      campos: {
        balance: calc.saldoGift,
        status: calc.saldoGift <= 0 ? 'depleted' : 'active',
        lastUsedAt: quando,
        lastUsedBy: id,
      },
      // O saldo tem de ser o que foi lido: se outro pedido gastou no meio,
      // esta transação falha em vez de descontar sobre um saldo velho.
      seIgual: { balance: giftcard.balance, status: 'active' },
    });
  }

  try {
    await store.dbTransacao(escritas);
  } catch (err) {
    if (!err.condicaoFalhou) throw err;
    if (err.indice === 0) return { status: 409, erro: 'Este código de agendamento já existe. Tente de novo.' };
    return { status: 409, erro: 'O cupom ou o gift card acabou de ser usado em outro pedido. Confira e tente de novo.' };
  }
  return { status: 200, agendamento };
}

module.exports = { criarAgendamentoPublico, CALCULADOS };
