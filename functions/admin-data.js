'use strict';

// =====================================================================
// admin-data — leitura e escrita dos dados administrativos, no servidor.
//
// Por que existe: o login do site era Firebase Auth, e as regras do banco
// autorizavam escrita admin por `auth.token.email == spcarclean0@gmail.com`.
// Em 08/11/2026 a chave de API do projeto Google foi apagada: o login quebrou
// para todos e o painel ficou inacessível. Logada pelo Cognito, o Firebase vê
// o navegador como anônimo e recusa toda escrita administrativa.
//
// Esta função é a ponte: valida o token do Cognito (exigindo o grupo `admin`)
// e fala com o Firebase usando o FIREBASE_DATABASE_SECRET, que ignora as
// regras. O navegador nunca recebe o segredo.
//
// NÃO é um proxy genérico, de propósito. Um endpoint que aceitasse qualquer
// caminho e qualquer corpo recriaria exatamente a classe de brecha que a
// migração está fechando — foi assim que o gift card virou forjável. Aqui cada
// nó declara quais operações aceita, e o que não está declarado é recusado.
//
// Quando os dados forem para o DynamoDB, só o interior desta função muda; o
// painel não é reescrito de novo.
//
// POST /api/admin-data
//   { "op": "ler"|"gravar"|"mesclar"|"apagar", "caminho": "bookings/SPC-X", "dados": {...} }
// =====================================================================

const { clientIp, rateLimit, originAllowed, corsHeaders } = require('./lib/guard');
const { verifyAdmin, identificar, bearerToken } = require('./lib/admin-auth');

// Política por nó. `raiz` controla o que vale no nó inteiro; `item`, no filho.
// Substituir ou apagar um nó inteiro é o que apaga a base de uma vez, então só
// está liberado onde o app realmente faz isso — hoje, `blocked`, que o
// setBlocked() regrava por completo.
const NOS = {
  // Operação do dia a dia
  bookings: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  blocked: { ler: true, raiz: { gravar: true, apagar: false }, item: { gravar: true, apagar: true } },
  dayLoad: { ler: true, raiz: { gravar: true, apagar: false }, item: { gravar: true, apagar: true } },
  waitlist: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },

  // Catálogo e vitrine
  services: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  combos: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  config: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  portfolio: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  gallery: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },

  // Clientes
  clientProfiles: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  clientNotes: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  clientLinks: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  clientLinkDismissals: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  clientOverrides: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  bookingIndex: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },

  // Dinheiro
  coupons: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  giftcards: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  referrals: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },

  // Avaliação — a moderação acontece por aqui
  feedback: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },

  // Estoque
  stock: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  stockRecipes: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },

  // Operacional
  adminPushTokens: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  aiConfig: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: true, apagar: true } },
  aiUsage: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: false, apagar: false } },
  aiLogs: { ler: true, raiz: { gravar: false, apagar: false }, item: { gravar: false, apagar: true } },
};

// Caminhos que nenhuma operação alcança, mesmo sendo filhos de nó liberado.
// `config/adminPassword` era uma senha em texto puro num nó de leitura
// pública; foi apagada em 08/11/2026 e não volta por aqui.
const BLOQUEADOS = new Set(['config/adminPassword']);

const PROFUNDIDADE_MAX = 4;
const CORPO_MAX_BYTES = 256 * 1024;

const OPS = new Set(['ler', 'gravar', 'mesclar', 'apagar']);

function reply(statusCode, cors, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Valida o caminho e devolve { segmentos } ou { erro }.
 *
 * A validação é por lista de permissão no formato, não por procura de
 * caracteres ruins: `..`, barra inicial, `?`, `#` e `.` sozinho morrem aqui,
 * assim como qualquer tentativa de anexar `?auth=` ao caminho.
 */
function validarCaminho(caminho) {
  if (typeof caminho !== 'string' || !caminho) return { erro: 'caminho é obrigatório' };
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_@.:+-]+)*$/.test(caminho)) {
    return { erro: 'caminho com formato inválido' };
  }
  const segmentos = caminho.split('/');
  if (segmentos.length > PROFUNDIDADE_MAX) return { erro: 'caminho fundo demais' };
  if (segmentos.some((s) => s === '.' || s === '..' || !s)) return { erro: 'caminho inválido' };
  if (BLOQUEADOS.has(caminho)) return { erro: 'caminho bloqueado' };
  if (!Object.prototype.hasOwnProperty.call(NOS, segmentos[0])) {
    return { erro: `nó não permitido: ${segmentos[0]}` };
  }
  return { segmentos };
}

function autorizado(op, segmentos) {
  const regra = NOS[segmentos[0]];
  const naRaiz = segmentos.length === 1;
  if (op === 'ler') return regra.ler === true;
  const alvo = naRaiz ? regra.raiz : regra.item;
  if (op === 'apagar') return alvo.apagar === true;
  // gravar substitui; mesclar atualiza campos. Ambos exigem permissão de
  // escrita, mas mesclar na raiz não destrói o que não foi enviado.
  if (op === 'gravar') return alvo.gravar === true;
  if (op === 'mesclar') return alvo.gravar === true || (naRaiz && regra.item.gravar === true);
  return false;
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

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return reply(405, cors, { ok: false, error: 'método não permitido' });
  }
  if (!originAllowed(event)) {
    return reply(403, cors, { ok: false, error: 'origem não permitida' });
  }
  if (!rateLimit('admin-data', clientIp(event), { max: 600 })) {
    return reply(429, cors, { ok: false, error: 'muitas requisições — tente mais tarde' });
  }

  const token = bearerToken(event);
  if (!token) return reply(401, cors, { ok: false, error: 'não autorizado' });
  if (!(await verifyAdmin(token))) {
    return reply(403, cors, { ok: false, error: 'acesso restrito ao administrador' });
  }

  const bruto = event.body || '';
  if (bruto.length > CORPO_MAX_BYTES) {
    return reply(413, cors, { ok: false, error: 'corpo grande demais' });
  }

  let body;
  try {
    body = JSON.parse(bruto);
  } catch {
    return reply(400, cors, { ok: false, error: 'JSON inválido' });
  }

  const { op, caminho, dados } = body || {};
  if (!OPS.has(op)) return reply(400, cors, { ok: false, error: 'op inválida' });

  const v = validarCaminho(caminho);
  if (v.erro) return reply(400, cors, { ok: false, error: v.erro });
  if (!autorizado(op, v.segmentos)) {
    return reply(403, cors, { ok: false, error: `operação '${op}' não permitida em '${caminho}'` });
  }
  if ((op === 'gravar' || op === 'mesclar') && (dados === undefined || dados === null)) {
    return reply(400, cors, { ok: false, error: 'dados é obrigatório para gravar/mesclar' });
  }
  // Mesclar espera objeto: o PATCH do Firebase com escalar não faz sentido e
  // apagaria o nó em alguns casos.
  if (op === 'mesclar' && (typeof dados !== 'object' || Array.isArray(dados))) {
    return reply(400, cors, { ok: false, error: 'mesclar exige um objeto' });
  }

  // Quem fez o quê fica no CloudWatch. Num endpoint que escreve na base do
  // negócio, poder reconstruir uma alteração depois não é luxo.
  let quem = null;
  try {
    quem = await identificar(token);
  } catch { /* o verifyAdmin já passou; a identidade é só para o log */ }
  const autor = quem ? `${quem.email || quem.uid} (${quem.origem})` : 'desconhecido';

  try {
    let resultado;
    if (op === 'ler') resultado = await firebase('GET', caminho);
    else if (op === 'gravar') resultado = await firebase('PUT', caminho, dados);
    else if (op === 'mesclar') resultado = await firebase('PATCH', caminho, dados);
    else resultado = await firebase('DELETE', caminho);

    if (op !== 'ler') console.log(`admin-data: ${autor} ${op} ${caminho}`);
    return reply(200, cors, { ok: true, dados: resultado });
  } catch (err) {
    console.error(`admin-data: ${autor} ${op} ${caminho} falhou: ${err.message}`);
    return reply(502, cors, { ok: false, error: 'falha ao acessar o banco' });
  }
};

// Exportado para teste: a política é o coração da segurança desta função, e
// precisa ser verificável sem rede.
exports._interno = { NOS, BLOQUEADOS, validarCaminho, autorizado };
