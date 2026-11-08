'use strict';

// =====================================================================
// Feriados e disponibilidade — SP Car Clean (Guarulhos/SP).
//
// A oficina não atende fim de semana nem feriado. Antes, isso era expresso
// como 12.150 datas gravadas no banco (todo dia de 27/02/2027 a 01/02/2060),
// o que é a mesma informação escrita de forma que não dá para manter.
//
// Aqui a disponibilidade é uma REGRA:
//   fechado = sábado | domingo | feriado | exceção marcada como fechada
//   aberto  = qualquer outro dia, ou exceção marcada como aberta
//
// A lista de exceções (em DynamoDB, editável no painel) cobre os dois lados:
// uma folga ou férias que caia em dia de semana, e um sábado que você decida
// abrir. Isso devolve o controle sem voltar a escrever ano por ano.
//
// Usado pela importação (scripts/) e pela API em runtime — por isso vive em
// lib/, sem dependência de AWS nem de rede.
// =====================================================================

// --- Feriados nacionais de data fixa (Lei 662/1949, Lei 10.607/2002 e
//     Lei 14.759/2023, que tornou o 20 de novembro feriado nacional).
const NACIONAIS_FIXOS = {
  '01-01': 'Confraternização Universal',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalho',
  '09-07': 'Independência',
  '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Consciência Negra',
  '12-25': 'Natal',
};

// --- Estadual de São Paulo.
const ESTADUAIS_SP = {
  '07-09': 'Revolução Constitucionalista (SP)',
};

// --- Municipal de Guarulhos: 8 de dezembro, aniversário da cidade e dia de
//     Nossa Senhora da Conceição. A oficina fica em Guarulhos (Parque Santo
//     Antônio), não na capital — os feriados municipais são outros.
const MUNICIPAIS_GUARULHOS = {
  '12-08': 'Aniversário de Guarulhos / N. Sra. da Conceição',
};

// Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário
// gregoriano). Vale para qualquer ano entre 1583 e 4099.
function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function somaDias(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

/**
 * Todos os feriados de um ano, como { 'YYYY-MM-DD': 'nome' }.
 *
 * Carnaval e Corpus Christi são formalmente ponto facultativo, não feriado
 * legal — mas a oficina não atende neles, então entram como fechados. Para
 * abrir um deles, use a lista de exceções.
 */
function feriadosDoAno(ano) {
  const out = {};
  for (const [md, nome] of Object.entries({
    ...NACIONAIS_FIXOS,
    ...ESTADUAIS_SP,
    ...MUNICIPAIS_GUARULHOS,
  })) {
    out[`${ano}-${md}`] = nome;
  }
  const pascoa = domingoDePascoa(ano);
  out[iso(somaDias(pascoa, -48))] = 'Carnaval (segunda)';
  out[iso(somaDias(pascoa, -47))] = 'Carnaval (terça)';
  out[iso(somaDias(pascoa, -2))] = 'Sexta-feira Santa';
  out[iso(somaDias(pascoa, 60))] = 'Corpus Christi';
  return out;
}

/** Nome do feriado numa data 'YYYY-MM-DD', ou null. */
function feriadoEm(dataIso) {
  const ano = Number(dataIso.slice(0, 4));
  if (!Number.isInteger(ano)) return null;
  return feriadosDoAno(ano)[dataIso] || null;
}

/** true para sábado e domingo. Usa UTC: a data é um rótulo, não um instante. */
function fimDeSemana(dataIso) {
  const w = new Date(`${dataIso}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
}

/**
 * A oficina atende nesta data?
 *
 * @param {string} dataIso 'YYYY-MM-DD'
 * @param {Object<string,{open:boolean,motivo?:string}>} excecoes
 *        Exceções explícitas; `open: true` abre um dia que a regra fecharia
 *        (um sábado, por exemplo) e `open: false` fecha um dia útil (folga,
 *        férias). A exceção sempre vence a regra.
 * @returns {{aberto: boolean, motivo: string|null}}
 */
function disponibilidade(dataIso, excecoes = {}) {
  const exc = excecoes[dataIso];
  if (exc && typeof exc.open === 'boolean') {
    return {
      aberto: exc.open,
      motivo: exc.open ? null : exc.motivo || 'Fechado (exceção)',
    };
  }
  if (fimDeSemana(dataIso)) return { aberto: false, motivo: 'Fim de semana' };
  const f = feriadoEm(dataIso);
  if (f) return { aberto: false, motivo: f };
  return { aberto: true, motivo: null };
}

/** Datas fechadas num intervalo, para montar o calendário de uma vez. */
function datasFechadas(deIso, ateIso, excecoes = {}) {
  const out = {};
  let d = new Date(`${deIso}T12:00:00Z`);
  const fim = new Date(`${ateIso}T12:00:00Z`);
  while (d <= fim) {
    const k = iso(d);
    const r = disponibilidade(k, excecoes);
    if (!r.aberto) out[k] = r.motivo;
    d = somaDias(d, 1);
  }
  return out;
}

module.exports = {
  domingoDePascoa,
  feriadosDoAno,
  feriadoEm,
  fimDeSemana,
  disponibilidade,
  datasFechadas,
  NACIONAIS_FIXOS,
  ESTADUAIS_SP,
  MUNICIPAIS_GUARULHOS,
};
