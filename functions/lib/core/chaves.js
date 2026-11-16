'use strict';

// Tradução entre o caminho do Firebase (`bookings/SPC-1`) e a chave do
// DynamoDB (`pk=BOOKING`, `sk=SPC-1`). É o mapeamento de docs/migracao-aws.md.
//
// POR QUE ISTO É UM MÓDULO, e não código dentro do importador: o importador
// grava e as Lambdas leem. Se cada um tiver a sua cópia do mapeamento, basta
// uma divergir para o dado existir na tabela e o app não achar — erro que não
// aparece em teste de unidade de nenhum dos dois lados, só em produção, como
// "sumiu". Uma fonte só, usada pelos dois.
//
// O caminho do Firebase tem até 3 níveis no app: `no`, `no/<chave>` e
// `no/<pai>/<filho>` (só `bookingIndex`).

const crypto = require('crypto');

const anoDe = (data) => String(data).slice(0, 4);
const hash12 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

// Para cada nó: a partição, o prefixo da chave de ordenação, e como voltar do
// `sk` para a chave que o Firebase usava. `pk` como função = partição depende
// da chave do filho (é o caso de `blocked` e `dayLoad`, por ano).
const NOS = {
  services:     { pk: 'CATALOG', prefixo: 'SERVICE#' },
  combos:       { pk: 'CATALOG', prefixo: 'COMBO#' },
  portfolio:    { pk: 'CATALOG', prefixo: 'PORTFOLIO#' },
  gallery:      { pk: 'CATALOG', prefixo: 'GALLERY#' },
  // `config` são campos planos: o nó inteiro é UM item, sem filhos.
  config:       { pk: 'CATALOG', item: 'CONFIG', folha: true },
  blocked:      { pk: (k) => `AVAIL#${anoDe(k)}`, prefixo: 'BLOCKED#', porAno: true },
  dayLoad:      { pk: (k) => `AVAIL#${anoDe(k)}`, prefixo: 'LOAD#', porAno: true },
  bookings:     { pk: 'BOOKING', prefixo: '' },
  bookingIndex: { pk: (uid) => `CLIENT#${uid}`, prefixo: 'BOOKING#', doisNiveis: true },
  // O perfil fica na partição do próprio cliente (CLIENT#<uid>), e o painel lê
  // o nó INTEIRO. Isso não é uma consulta: é varredura com filtro — ver
  // `raizVarredura` e o comentário em store.js sobre o custo.
  clientProfiles: { pk: (uid) => `CLIENT#${uid}`, item: 'PROFILE', raizVarredura: true,
                    chaveDoItem: (it) => String(it?.pk?.S || '').replace(/^CLIENT#/, '') },
  coupons:      { pk: 'COUPON', prefixo: '' },
  giftcards:    { pk: 'GIFTCARD', prefixo: '' },
  stock:        { pk: 'STOCK', prefixo: 'ITEM#' },
  stockRecipes: { pk: 'STOCK', prefixo: 'RECIPE#' },
  feedback:     { pk: 'FEEDBACK', prefixo: '' },
  waitlist:     { pk: 'WAITLIST', prefixo: '' },
  referrals:    { pk: 'REFERRAL', prefixo: '' },
  aiConfig:     { pk: 'AI', prefixo: 'CONFIG#' },
  aiUsage:      { pk: 'AI', prefixo: 'USAGE#' },
  // `LOG#<id>` — e não `LOG#<data>#<id>`, que foi a primeira tentativa. Pôr a
  // data na chave a tornava NÃO derivável do id: apagar um log pelo id montava
  // `LOG##<id>` e não achava nada, falhando em silêncio. O id de push do
  // Firebase já ordena por tempo, então a ordenação continua certa de graça.
  aiLogs:       { pk: 'AI', prefixo: 'LOG#', ttl: true },
  aiRateLimit:  { pk: 'AI', prefixo: 'RATE#', ttl: true },
  // O token do FCM tem `:` e 150+ caracteres: a chave leva o hash, o token
  // inteiro fica no atributo `token` — senão não há como apagar a inscrição.
  adminPushTokens: { pk: 'ADMIN', prefixo: 'PUSHTOKEN#', skDe: (k) => `PUSHTOKEN#${hash12(k)}`, chaveDe: null, extraDe: (k) => ({ token: k }) },
  clientLinks:  { pk: 'ADMIN', prefixo: 'CLIENTLINK#' },
  clientNotes:  { pk: 'ADMIN', prefixo: 'CLIENTNOTE#' },
  clientOverrides: { pk: 'ADMIN', prefixo: 'CLIENTOVERRIDE#' },
  clientLinkDismissals: { pk: 'ADMIN', prefixo: 'CLIENTDISMISS#' },
  // Descadastro de marketing (lib/core/optout.js). A chave é o hash do
  // e-mail, nunca o e-mail: ponto é proibido em chave de caminho, e o
  // endereço fica no valor, não no caminho.
  marketingOptOut: { pk: 'MARKETING', prefixo: 'OPTOUT#' },
  marketingSent:   { pk: 'MARKETING', prefixo: 'SENT#' },
};

// Item que guarda quais anos têm registro de disponibilidade. Sem ele, ler
// `blocked` inteiro exigiria adivinhar as partições: os dados vão de 2026 a
// 2060 (o horizonte de agendamento escrito como 12 mil datas).
const META_ANOS = { pk: 'AVAIL#META', sk: 'YEARS' };

const TTL_DIAS = 90;
const expiraEm = () => Math.floor(Date.now() / 1000) + TTL_DIAS * 86400;

function conhecido(no) {
  return Object.prototype.hasOwnProperty.call(NOS, no);
}

function segmentos(caminho) {
  return String(caminho).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

/**
 * Caminho → chave. Devolve:
 *   { tipo: 'item', pk, sk }         leitura/gravação de um registro
 *   { tipo: 'colecao', pk, prefixo } o nó inteiro (uma partição)
 *   { tipo: 'anos', prefixo }        o nó inteiro espalhado por ano
 * Lança para nó desconhecido — nunca devolve algo "mais ou menos".
 */
function chaveDe(caminho, valor) {
  const segs = segmentos(caminho);
  if (!segs.length) throw new Error('caminho vazio');
  const [no, a, b] = segs;
  if (!conhecido(no)) throw new Error(`nó desconhecido: ${no}`);
  const d = NOS[no];

  if (d.folha) {
    if (segs.length === 1) return { tipo: 'item', pk: d.pk, sk: d.item, no, campo: null };
    // `config/maxPerDay` é um CAMPO dentro do item único do config.
    if (segs.length === 2) return { tipo: 'item', pk: d.pk, sk: d.item, no, campo: a };
    throw new Error(`caminho fundo demais para ${no}: ${caminho}`);
  }

  if (d.doisNiveis) {
    if (segs.length === 1) throw new Error(`${no} só pode ser lido por pai (${no}/<uid>)`);
    if (segs.length === 2) return { tipo: 'colecao', pk: d.pk(a), prefixo: d.prefixo, no };
    return { tipo: 'item', pk: d.pk(a), sk: d.prefixo + b, no, campo: null };
  }

  if (segs.length === 1) {
    if (d.porAno) return { tipo: 'anos', prefixo: d.prefixo, no };
    if (d.raizVarredura) return { tipo: 'varredura', sk: d.item, no };
    if (d.item) throw new Error(`${no} só pode ser lido por item (${no}/<id>)`);
    return { tipo: 'colecao', pk: d.pk, prefixo: d.prefixo, no };
  }

  const pk = typeof d.pk === 'function' ? d.pk(a) : d.pk;
  const sk = d.item ? d.item : (d.skDe ? d.skDe(a, valor) : d.prefixo + a);
  // Terceiro nível em nó de um nível = campo dentro do registro.
  return { tipo: 'item', pk, sk, no, campo: segs.length > 2 ? segs.slice(2).join('.') : null };
}

/** `sk` → a chave que o Firebase usava, para remontar o nó como objeto. */
function chaveDoSk(no, sk) {
  const d = NOS[no];
  if (!d) return sk;
  if (d.chaveDe === null) return null;        // não é reversível (token com hash)
  if (d.chaveDe) return d.chaveDe(sk);
  if (d.item) return null;
  return d.prefixo ? sk.slice(d.prefixo.length) : sk;
}

/** Campos extra do item: índices, expiração e o que a chave não guarda. */
function extrasDe(no, chave, valor) {
  const d = NOS[no];
  if (!d) return {};
  const extras = {};
  if (d.ttl) extras.expiresAt = expiraEm();
  if (d.extraDe) Object.assign(extras, d.extraDe(chave, valor));
  if (no === 'bookings') Object.assign(extras, indicesDoAgendamento(chave, valor));
  if (no === 'clientProfiles') Object.assign(extras, indicesDoPerfil(chave, valor));
  return extras;
}

const emailCanonico = (e) => String(e || '').trim().toLowerCase();
const mesDe = (data) => String(data).slice(0, 7);

// GSI1 responde "agendamentos do mês"; GSI2 liga o histórico ao e-mail, que é
// o que sobrevive ao recadastro do cliente (o uid do Firebase não).
function indicesDoAgendamento(codigo, b) {
  const data = String(b?.startDate || b?.date || '').slice(0, 10);
  const extra = {};
  if (data) {
    extra.gsi1pk = `BOOKING#${mesDe(data)}`;
    extra.gsi1sk = `${data}#${codigo}`;
  }
  const email = emailCanonico(b?.email);
  if (email) {
    extra.gsi2pk = `EMAIL#${email}`;
    extra.gsi2sk = `BOOKING#${data || '0000-00-00'}#${codigo}`;
  }
  return extra;
}

function indicesDoPerfil(uid, p) {
  const email = emailCanonico(p?.email);
  return email ? { gsi2pk: `EMAIL#${email}`, gsi2sk: 'PROFILE' } : {};
}

module.exports = {
  NOS, META_ANOS, TTL_DIAS,
  conhecido, segmentos, chaveDe, chaveDoSk, extrasDe,
  indicesDoAgendamento, indicesDoPerfil, emailCanonico, anoDe, hash12, expiraEm,
};
