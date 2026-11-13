'use strict';

// Descadastro de e-mail de marketing.
//
// Pedido: "tem que ter uma funcionalidade do cliente se descadastrar, caso não
// queira mais receber e-mails de marketing". Antes desta mudança o projeto não
// tinha nada disso — nenhum opt-out em lugar nenhum — e já enviava e-mail de
// aniversário automático. Mandar marketing sem saída é problema antes de ser
// descortesia: a LGPD dá ao titular o direito de se opor ao tratamento para
// essa finalidade, e o pedido precisa ser fácil de fazer.
//
// O que é marketing e o que NÃO é: lembrete de agendamento, confirmação de
// pagamento e indicação são transacionais — o cliente pediu, e continuam sendo
// enviados mesmo a quem se descadastrou. Reativação e aniversário são
// marketing, e respeitam o descadastro.

const crypto = require('crypto');

const NO_OPTOUT = '/marketingOptOut';
const NO_ENVIOS = '/marketingSent';

function normaliza(email) {
  return String(email || '').trim().toLowerCase();
}

// Chave de caminho no Firebase. E-mail não serve: ponto, `#`, `$`, `[`, `/` e
// `]` são proibidos em chave do Realtime Database, e todo e-mail tem ponto.
// O hash resolve isso e, de quebra, o endereço não fica no caminho — só no
// valor, onde a dona precisa dele para saber quem saiu.
function chaveDe(email) {
  return crypto.createHash('sha256').update(normaliza(email)).digest('hex').slice(0, 32);
}

// Token do link de descadastro.
//
// Sem token, qualquer um descadastra qualquer endereço só adivinhando, e pior:
// o endpoint vira oráculo de "este e-mail existe na base?". O token é derivado
// do segredo do banco por HMAC com um rótulo próprio — chave separada, o
// segredo cru nunca é usado direto nem sai do servidor.
function chaveHmac(segredo) {
  return crypto.createHmac('sha256', String(segredo || '')).update('marketing-optout-v1').digest();
}

function tokenDe(email, segredo) {
  if (!segredo) return '';
  return crypto.createHmac('sha256', chaveHmac(segredo))
    .update(normaliza(email))
    .digest('base64url')
    .slice(0, 22);
}

// Comparação em tempo constante: comparar com `===` vaza, pelo tempo, quantos
// caracteres iniciais acertaram, e isso permite descobrir o token tentando.
function tokenConfere(email, token, segredo) {
  const esperado = tokenDe(email, segredo);
  const recebido = String(token || '');
  if (!esperado || esperado.length !== recebido.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

function linkDescadastro(email, segredo, siteUrl) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  const e = encodeURIComponent(normaliza(email));
  const t = encodeURIComponent(tokenDe(email, segredo));
  return `${base}/api/unsubscribe?e=${e}&t=${t}`;
}

// Rodapé obrigatório de todo e-mail de marketing. Vai no corpo, e não depende
// de ninguém lembrar de editar o template no EmailJS.
function rodapeDescadastro(email, segredo, siteUrl) {
  return `\n\n—\nNão quer mais receber nossos e-mails promocionais? `
    + `Cancele aqui: ${linkDescadastro(email, segredo, siteUrl)}`;
}

// ── estado ────────────────────────────────────────────────────────────

// Lista de quem saiu, de uma leitura só. Checar um a um seria uma ida ao banco
// por cliente numa rotina que roda em lote.
async function carregarDescadastrados(dbGet) {
  let raw = null;
  try { raw = await dbGet(NO_OPTOUT); } catch { raw = null; }
  const set = new Set();
  for (const v of Object.values(raw || {})) {
    if (v && v.email) set.add(normaliza(v.email));
  }
  return set;
}

async function registrarDescadastro({ email, origem, dbSet }) {
  const e = normaliza(email);
  if (!e) throw new Error('e-mail vazio');
  await dbSet(`${NO_OPTOUT}/${chaveDe(e)}`, {
    email: e,
    origem: origem || 'link',
    at: new Date().toISOString(),
  });
  return e;
}

// Quando cada endereço recebeu marketing pela última vez. É o que sustenta o
// intervalo mínimo entre envios: sem isso, a rotina semanal manda para o mesmo
// cliente inativo toda semana, que é como uma reativação vira spam.
async function carregarEnvios(dbGet) {
  let raw = null;
  try { raw = await dbGet(NO_ENVIOS); } catch { raw = null; }
  const mapa = {};
  for (const v of Object.values(raw || {})) {
    if (v && v.email && v.at) {
      const e = normaliza(v.email);
      if (!mapa[e] || v.at > mapa[e]) mapa[e] = v.at;
    }
  }
  return mapa;
}

async function registrarEnvio({ email, assunto, dbSet }) {
  const e = normaliza(email);
  await dbSet(`${NO_ENVIOS}/${chaveDe(e)}`, {
    email: e,
    assunto: assunto || '',
    at: new Date().toISOString(),
  });
}

// Quem pode receber marketing agora: ainda inscrito E fora do intervalo mínimo.
function podeReceber(email, { descadastrados, envios, intervaloDias, agora }) {
  const e = normaliza(email);
  if (!e || !e.includes('@')) return false;
  if (descadastrados && descadastrados.has(e)) return false;
  const ultimo = envios && envios[e];
  if (!ultimo) return true;
  const dias = (new Date(agora || Date.now()) - new Date(ultimo)) / 86400000;
  if (!isFinite(dias)) return true;   // data corrompida não bloqueia para sempre
  return dias >= (intervaloDias || 0);
}

module.exports = {
  NO_OPTOUT, NO_ENVIOS,
  normaliza, chaveDe,
  tokenDe, tokenConfere, linkDescadastro, rodapeDescadastro,
  carregarDescadastrados, registrarDescadastro,
  carregarEnvios, registrarEnvio, podeReceber,
};
