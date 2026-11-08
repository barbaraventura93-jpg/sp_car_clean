'use strict';

// =====================================================================
// me — os dados do PRÓPRIO cliente, no servidor.
//
// Por que existe: as regras do banco liberam o dado do cliente por
// `auth.uid == $uid`, o uid do Firebase Auth. Com o login no Cognito o
// navegador é anônimo para o Firebase, então `clientProfiles/$uid` e
// `bookingIndex/$uid` passaram a responder 401 — a tela "Minha Conta" abre
// vazia. É o mesmo problema que fechou o painel, do lado do cliente.
//
// Afrouxar a regra não resolve: como o navegador é anônimo, liberar para o
// cliente libera para todo mundo. Foi exatamente assim que `bookings/$id`
// virou `.read: true` e hoje entrega nome, telefone, carro e placa de
// qualquer agendamento a quem souber o código.
//
// REGRA CENTRAL: o uid vem SEMPRE do token, nunca do corpo da requisição.
// Não existe parâmetro que diga "sou o cliente X" — se existisse, qualquer
// cliente leria a conta de qualquer outro.
//
// O que mudou de lugar, e por quê:
//
//   • Pontos passam a ser calculados AQUI. Antes, `customerConfirm()` no
//     navegador chamava `_awardPoints()`, que escrevia
//     `clientProfiles/<uid>.points` direto. Como ponto vira desconto, isso é
//     dinheiro que o cliente editava no próprio aparelho. Agora o servidor lê
//     o preço do agendamento e a regra de pontos do `config`, e credita uma
//     única vez (marcado por `pointsAwardedAt` no agendamento).
//
//   • `salvar-perfil` tem lista de campos permitidos. Sem ela, "salvar meu
//     endereço" aceitaria `points` no mesmo corpo.
//
//   • `indexar-agendamento` confere a posse do agendamento antes de indexar.
//     Sem isso, o cliente indexaria o código de outra pessoa na própria conta
//     e passaria a lê-lo pela leitura legítima de "meus agendamentos".
//
// POST /api/me
//   { "op": "perfil" }
//   { "op": "agendamentos" }
//   { "op": "salvar-perfil",        "dados": { ...campos permitidos... } }
//   { "op": "indexar-agendamento",  "dados": { "id": "SPC-X" } }
//   { "op": "confirmar-pagamento",  "dados": { "id": "SPC-X" } }
// =====================================================================

const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');
const { identificar, bearerToken } = require('./lib/admin-auth');

const OPS = new Set(['perfil', 'agendamentos', 'salvar-perfil', 'indexar-agendamento', 'confirmar-pagamento']);
const CORPO_MAX_BYTES = 64 * 1024;

// Campos que o cliente pode gravar no próprio perfil. Medidos no app.js:
// saveClientOnboarding (nome, telefone, endereço, nascimento, veículos) e os
// carimbos de último acesso/agendamento. `points` e `pointsHistory` ficam de
// fora de propósito — quem credita é o servidor.
const CAMPOS_PERFIL = {
  name: 'texto',
  phone: 'texto',
  bairro: 'texto',
  birthDate: 'texto',
  address: 'objeto',
  vehicles: 'lista',
  primaryVehicle: 'objeto-ou-nulo',
  onboardingCompletedAt: 'texto',
  lastLoginAt: 'texto',
  lastBookingAt: 'texto',
  createdAt: 'texto',        // o cadastro grava na criação do perfil
  linkedEmails: 'lista',     // e-mails que o cliente usou em agendamentos
};

const LIMITE_TEXTO = 200;

function reply(statusCode, cors, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Valida o corpo de `salvar-perfil` contra CAMPOS_PERFIL. */
function validarPerfil(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return { erro: 'dados inválidos' };
  const limpo = {};
  for (const [chave, valor] of Object.entries(dados)) {
    const tipo = CAMPOS_PERFIL[chave];
    if (!tipo) return { erro: `campo não permitido: ${chave}` };
    if (tipo === 'texto') {
      if (typeof valor !== 'string' || valor.length > LIMITE_TEXTO) return { erro: `campo inválido: ${chave}` };
      limpo[chave] = valor;
    } else if (tipo === 'objeto') {
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return { erro: `campo inválido: ${chave}` };
      limpo[chave] = valor;
    } else if (tipo === 'objeto-ou-nulo') {
      if (valor !== null && (typeof valor !== 'object' || Array.isArray(valor))) return { erro: `campo inválido: ${chave}` };
      limpo[chave] = valor;
    } else if (tipo === 'lista') {
      if (!Array.isArray(valor) || valor.length > 20) return { erro: `campo inválido: ${chave}` };
      limpo[chave] = valor;
    }
  }
  if (!Object.keys(limpo).length) return { erro: 'nada para salvar' };
  return { limpo };
}

function idValido(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(id);
}

/** O agendamento pertence a quem está pedindo? */
function ehDono(agendamento, quem) {
  if (!agendamento) return false;
  if (agendamento.clientUid && agendamento.clientUid === quem.uid) return true;
  const emailDoAgendamento = String(agendamento.email || '').toLowerCase();
  return !!emailDoAgendamento && emailDoAgendamento === String(quem.email || '').toLowerCase();
}

async function firebase(metodo, caminho, corpo) {
  const base = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const secret = process.env.FIREBASE_DATABASE_SECRET;
  if (!base || !secret) throw new Error('Firebase não configurado');
  const resp = await fetch(`${base}/${caminho}.json?auth=${encodeURIComponent(secret)}`, {
    method: metodo,
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`Firebase HTTP ${resp.status}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

/** Agendamentos do cliente: índice → cada agendamento. */
async function meusAgendamentos(uid) {
  const indice = await firebase('GET', `bookingIndex/${encodeURIComponent(uid)}`);
  const ids = indice && typeof indice === 'object' ? Object.keys(indice).filter(idValido) : [];
  if (!ids.length) return [];
  const lista = await Promise.all(ids.map((id) => firebase('GET', `bookings/${encodeURIComponent(id)}`).catch(() => null)));
  return lista.filter(Boolean);
}

/**
 * Credita os pontos do agendamento, uma única vez.
 *
 * `pointsAwardedAt` no agendamento é o que torna isto idempotente: sem essa
 * marca, repetir a confirmação creditaria de novo — e repetir uma requisição é
 * a coisa mais fácil que existe.
 */
async function creditarPontos(agendamento, uid) {
  if (agendamento.pointsAwardedAt) return { creditado: 0, motivo: 'já creditado' };
  const cfg = (await firebase('GET', 'config').catch(() => null)) || {};
  const porReal = Number(cfg.pointsPerReal);
  const fator = Number.isFinite(porReal) && porReal > 0 ? porReal : 1;
  const preco = Number(agendamento.finalPrice || agendamento.price || 0);
  if (!Number.isFinite(preco) || preco <= 0) return { creditado: 0, motivo: 'sem valor' };

  const ganhos = Math.floor(preco * fator);
  if (ganhos <= 0) return { creditado: 0, motivo: 'sem valor' };

  const perfil = (await firebase('GET', `clientProfiles/${encodeURIComponent(uid)}`)) || {};
  const atual = Number(perfil.points || 0);
  const historico = Array.isArray(perfil.pointsHistory) ? perfil.pointsHistory : [];
  historico.push({ at: new Date().toISOString(), delta: ganhos, bookingId: agendamento.id, motivo: 'serviço confirmado' });

  await firebase('PATCH', `clientProfiles/${encodeURIComponent(uid)}`, {
    points: atual + ganhos,
    pointsHistory: historico.slice(-100),
  });
  return { creditado: ganhos, saldo: atual + ganhos };
}

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, cors, { ok: false, error: 'método não permitido' });
  if (!originAllowed(event)) return reply(403, cors, { ok: false, error: 'origem não permitida' });
  if (!rateLimit('me', clientIp(event), { max: 300 })) {
    return reply(429, cors, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }

  const token = bearerToken(event);
  if (!token) return reply(401, cors, { ok: false, error: 'não autorizado' });

  // Qualquer usuário autenticado, não só o admin: este endpoint é do cliente.
  let quem = null;
  try {
    quem = await identificar(token);
  } catch (err) {
    console.error('me: falha ao identificar:', err.message);
  }
  if (!quem || !quem.uid) return reply(401, cors, { ok: false, error: 'sessão inválida' });

  const bruto = event.body || '';
  if (bruto.length > CORPO_MAX_BYTES) return reply(413, cors, { ok: false, error: 'corpo grande demais' });

  let body;
  try {
    body = JSON.parse(bruto);
  } catch {
    return reply(400, cors, { ok: false, error: 'JSON inválido' });
  }

  const { op, dados } = body || {};
  if (!OPS.has(op)) return reply(400, cors, { ok: false, error: 'op inválida' });

  const uid = quem.uid;

  try {
    if (op === 'perfil') {
      const perfil = await firebase('GET', `clientProfiles/${encodeURIComponent(uid)}`);
      return reply(200, cors, { ok: true, dados: perfil });
    }

    if (op === 'agendamentos') {
      return reply(200, cors, { ok: true, dados: await meusAgendamentos(uid) });
    }

    if (op === 'salvar-perfil') {
      const v = validarPerfil(dados);
      if (v.erro) return reply(400, cors, { ok: false, error: v.erro });
      // uid e email vêm do token, não do corpo: é o que amarra o perfil à sessão.
      await firebase('PATCH', `clientProfiles/${encodeURIComponent(uid)}`, {
        ...v.limpo, uid, email: String(quem.email || '').toLowerCase(),
      });
      return reply(200, cors, { ok: true });
    }

    if (op === 'indexar-agendamento') {
      const id = dados && dados.id;
      if (!idValido(id)) return reply(400, cors, { ok: false, error: 'id inválido' });
      const agendamento = await firebase('GET', `bookings/${encodeURIComponent(id)}`);
      if (!agendamento) return reply(404, cors, { ok: false, error: 'agendamento não encontrado' });
      if (!ehDono(agendamento, quem)) {
        console.warn(`me: ${uid} tentou indexar agendamento de outro (${id})`);
        return reply(403, cors, { ok: false, error: 'este agendamento não é seu' });
      }
      await firebase('PUT', `bookingIndex/${encodeURIComponent(uid)}/${encodeURIComponent(id)}`, true);
      return reply(200, cors, { ok: true });
    }

    if (op === 'confirmar-pagamento') {
      const id = dados && dados.id;
      if (!idValido(id)) return reply(400, cors, { ok: false, error: 'id inválido' });
      const agendamento = await firebase('GET', `bookings/${encodeURIComponent(id)}`);
      if (!agendamento) return reply(404, cors, { ok: false, error: 'agendamento não encontrado' });
      if (!ehDono(agendamento, quem)) {
        console.warn(`me: ${uid} tentou confirmar agendamento de outro (${id})`);
        return reply(403, cors, { ok: false, error: 'este agendamento não é seu' });
      }
      // Só o que o cliente de fato confirma: um serviço já aprovado pelo admin.
      // Deixar qualquer status passar permitiria pular a aprovação.
      if (agendamento.status !== 'approved' && agendamento.status !== 'confirmed') {
        return reply(409, cors, { ok: false, error: `agendamento em status '${agendamento.status}' não pode ser confirmado` });
      }

      const pontos = await creditarPontos(agendamento, uid);
      const agora = new Date().toISOString();
      const mudanca = { status: 'confirmed', confirmedAt: agendamento.confirmedAt || agora };
      if (pontos.creditado > 0) mudanca.pointsAwardedAt = agora;
      await firebase('PATCH', `bookings/${encodeURIComponent(id)}`, mudanca);

      console.log(`me: ${uid} confirmou ${id}; pontos creditados: ${pontos.creditado}`);
      return reply(200, cors, { ok: true, dados: { pontos } });
    }

    return reply(400, cors, { ok: false, error: 'op inválida' });
  } catch (err) {
    console.error(`me: ${uid} ${op} falhou: ${err.message}`);
    return reply(502, cors, { ok: false, error: 'falha ao acessar os dados' });
  }
};

// Exportado para teste: a validação e a posse são o que separa "meus dados" de
// "dados de qualquer um", e precisam ser verificáveis sem rede.
exports._interno = { CAMPOS_PERFIL, validarPerfil, ehDono, idValido, OPS };
