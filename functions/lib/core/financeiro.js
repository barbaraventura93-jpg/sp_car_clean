'use strict';

// Receita, custo e lucro de um período, a partir dos agendamentos.
//
// O custo sai do que cada serviço consome de insumos (`pricing.<porte>.cost`),
// que desde a mudança do estoque é calculado — soma de quantidade × custo por
// unidade — e não mais digitado à mão.
//
// Por que isto é um módulo e não código solto no agente: o lucro semanal é um
// número que a dona vai usar para decidir preço. Ele precisa de teste, e teste
// não alcança o que mora dentro de uma função de agente.

const STATUS_ATIVO = new Set(['confirmed', 'approved', 'completed']);

// O que o cliente pagou. A ordem importa: o valor efetivamente pago vence o
// preço de tabela, porque desconto e cupom entram aí.
function receitaDoAgendamento(b) {
  return Number(b?.paidAmount || b?.finalPrice || b?.price || 0) || 0;
}

function servicosDoAgendamento(b) {
  return (b?.services || [b?.service]).filter(Boolean);
}

// Custo de insumos de um agendamento, somando os serviços pelo porte do carro.
//
// `semCusto` é tão importante quanto o número: serviço sem receita cadastrada
// tem custo zero, e custo zero vira lucro inflado. Um relatório que afirma
// "margem de 92%" quando metade dos serviços não tem insumo cadastrado mente
// com números — por isso o chamador recebe a lista e avisa.
function custoDoAgendamento(b, svcMap) {
  const porte = b?.carSize === 'gr' ? 'gr' : 'pq';
  let custo = 0;
  const semCusto = [];
  for (const id of servicosDoAgendamento(b)) {
    const sv = (svcMap || {})[id];
    const c = Number(sv?.pricing?.[porte]?.cost || 0) || 0;
    if (c > 0) custo += c;
    else semCusto.push(id);
  }
  return { custo: Math.round(custo * 100) / 100, semCusto };
}

// Resumo de um conjunto de agendamentos já filtrado pelo período.
function resumoFinanceiro(bookings, svcMap) {
  let receita = 0, custo = 0, servicos = 0;
  const semCusto = new Set();
  for (const b of bookings || []) {
    receita += receitaDoAgendamento(b);
    const c = custoDoAgendamento(b, svcMap);
    custo += c.custo;
    c.semCusto.forEach(id => semCusto.add(id));
    servicos += servicosDoAgendamento(b).length;
  }
  receita = Math.round(receita * 100) / 100;
  custo   = Math.round(custo   * 100) / 100;
  const lucro = Math.round((receita - custo) * 100) / 100;
  return {
    receita, custo, lucro,
    // Margem sobre receita. Sem receita não há margem — zero seria afirmar
    // "margem de 0%", que é diferente de "não houve venda".
    margem: receita > 0 ? Math.round((lucro / receita) * 100) : null,
    agendamentos: (bookings || []).length,
    servicos,
    semCusto: [...semCusto],
  };
}

// Variação percentual entre dois períodos. Null quando não há base de
// comparação: "+100%" partindo de zero não informa nada.
function variacao(atual, anterior) {
  if (!(anterior > 0)) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

module.exports = {
  STATUS_ATIVO,
  receitaDoAgendamento,
  servicosDoAgendamento,
  custoDoAgendamento,
  resumoFinanceiro,
  variacao,
};
