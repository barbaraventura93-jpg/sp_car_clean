'use strict';

// O que o visitante NÃO LOGADO pode ler e gravar.
//
// Porte fiel das regras do Realtime Database (`database.rules.json`), que
// deixaram de ser aplicadas quando o banco virou DynamoDB: no DynamoDB não
// existe "regra do banco" — quem autoriza é esta função, no servidor.
//
// POR QUE ISTO É UM MÓDULO PURO, COM TESTE PRÓPRIO: é a única coisa entre um
// visitante e a base do negócio. Sem as validações abaixo, dá para criar
// agendamento já marcado como pago, forjar gift card com saldo, e sobrescrever
// o preço de um agendamento alheio — e isso não é hipótese, é o histórico
// deste projeto (o gift card já foi forjável uma vez).
//
// A regra geral: o visitante LÊ o que é catálogo e CRIA o próprio pedido. Ele
// nunca altera dinheiro, nunca lê a base inteira de ninguém, e nunca apaga.

// ── leitura ───────────────────────────────────────────────────────────

// `.read: true` no nó inteiro — é o catálogo e a disponibilidade que o site
// precisa para montar a página e o calendário.
const LER_NO = new Set([
  'services', 'combos', 'config', 'portfolio', 'gallery', 'blocked', 'dayLoad',
]);

// `.read: true` só no ITEM: quem tem o código lê aquele registro, e ninguém
// lista o nó. É o que impede varrer cupons e gift cards.
const LER_ITEM = new Set(['coupons', 'giftcards', 'feedback']);

// `feedback` inteiro, só com o filtro de aprovadas — é o que impede avaliação
// pendente de aparecer no site.
function consultaDeAprovadas(consulta) {
  return !!consulta
    && consulta.ordem === 'status'
    && consulta.igual === 'approved';
}

function podeLer(segmentos, consulta) {
  const [no, id] = segmentos;
  if (segmentos.length === 1) {
    if (LER_NO.has(no)) return true;
    if (no === 'feedback') return consultaDeAprovadas(consulta);
    return false;
  }
  if (segmentos.length === 2) {
    if (LER_NO.has(no)) return true;      // filho de nó público é público
    return LER_ITEM.has(no) && !!id;
  }
  // `config/location/rua` e afins: o nó é público, a profundidade não muda isso.
  return LER_NO.has(no);
}

// ── escrita ───────────────────────────────────────────────────────────

// Campos de dinheiro e de crédito. O visitante não pode escrever nenhum deles
// ao criar, nem mudar nenhum deles depois. É a trava central.
const CAMPOS_DE_DINHEIRO = [
  'finalPrice', 'priceWithFee', 'paidAmount', 'paymentTransactionId',
  'paymentConfirmedAt', 'pointsAwardedAt',
];

// Campos de identidade do agendamento: mudar qualquer um seria assumir o
// agendamento de outra pessoa.
const CAMPOS_IMUTAVEIS = ['id', 'createdAt', 'email', 'name', 'phone', 'price'];

const texto = (v, max) => typeof v === 'string' && v.length <= max;
const numero = (v) => typeof v === 'number' && Number.isFinite(v);

function criarAgendamento(novo, id) {
  if (!novo || typeof novo !== 'object') return false;
  if (novo.status !== 'pending') return false;        // nasce pendente, sempre
  if (novo.id !== id) return false;                   // o id do corpo é o da chave
  return CAMPOS_DE_DINHEIRO.every((c) => !(c in novo));
}

function alterarAgendamento(novo, atual) {
  if (!novo || typeof novo !== 'object' || !atual || typeof atual !== 'object') return false;
  for (const c of [...CAMPOS_IMUTAVEIS, ...CAMPOS_DE_DINHEIRO]) {
    // `undefined` dos dois lados conta como igual; valor diferente, não.
    if (JSON.stringify(novo[c] ?? null) !== JSON.stringify(atual[c] ?? null)) return false;
  }
  // A única mudança de estado permitida ao visitante é cancelar.
  return novo.status === atual.status || novo.status === 'cancelled';
}

function criarEspera(novo, id) {
  if (!novo || typeof novo !== 'object') return false;
  return novo.id === id
    && texto(novo.name, 200)
    && texto(novo.phone, 40)
    && texto(novo.date, 20);
}

function criarAvaliacao(novo) {
  if (!novo || typeof novo !== 'object') return false;
  if (novo.status !== 'pending_review' && novo.status !== 'internal') return false;
  if (!numero(novo.rating) || novo.rating < 1 || novo.rating > 5) return false;
  if ('comment' in novo && novo.comment !== undefined && !texto(novo.comment, 2000)) return false;
  return true;
}

function criarGiftCard(novo) {
  if (!novo || typeof novo !== 'object') return false;
  return novo.status === 'pending'
    && novo.balance === 0
    && numero(novo.amount) && novo.amount > 0;
}

// Gastar gift card: só diminui saldo, e só enquanto está ativo.
function usarGiftCard(novo, atual) {
  if (!novo || typeof novo !== 'object' || !atual || typeof atual !== 'object') return false;
  if (atual.status !== 'active') return false;
  if (novo.amount !== atual.amount || novo.code !== atual.code) return false;
  if (!numero(novo.balance) || novo.balance < 0 || novo.balance > atual.balance) return false;
  return novo.status === 'active' || novo.status === 'depleted';
}

/**
 * O visitante pode gravar `novo` em `segmentos`?
 *
 * @param {string[]} segmentos caminho já validado, ex.: ['bookings','SPC-1']
 * @param {*} novo valor que resultará da escrita (no PATCH, o MESCLADO —
 *   validar só o pedaço deixaria passar "mudar status" sem olhar o resto)
 * @param {*} atual valor que está no banco hoje (null se não existe)
 */
function podeGravar(segmentos, novo, atual) {
  if (segmentos.length !== 2) return false;   // só item, nunca o nó inteiro
  const [no, id] = segmentos;
  const existe = atual !== null && atual !== undefined;

  if (no === 'bookings') return existe ? alterarAgendamento(novo, atual) : criarAgendamento(novo, id);
  if (no === 'waitlist') return !existe && criarEspera(novo, id);
  if (no === 'feedback') return !existe && criarAvaliacao(novo);
  if (no === 'giftcards') return existe ? usarGiftCard(novo, atual) : criarGiftCard(novo);
  return false;
}

/** O visitante nunca apaga nada. */
function podeApagar() {
  return false;
}

module.exports = {
  LER_NO, LER_ITEM, CAMPOS_DE_DINHEIRO, CAMPOS_IMUTAVEIS,
  podeLer, podeGravar, podeApagar, consultaDeAprovadas,
};
