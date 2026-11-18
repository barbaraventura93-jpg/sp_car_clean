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
// e fala com o banco. O navegador nunca recebe credencial de banco.
//
// DESDE 16/11/2026 O BANCO É O DYNAMODB. O Firebase foi excluído em 10/11 — a
// migração que este arquivo antecipava deixou de ser plano e virou necessidade.
// O caminho (`bookings/SPC-X`) continua sendo a linguagem da API: quem traduz
// para pk/sk é lib/core/chaves.js, e a tabela de permissões abaixo não mudou.
//
// NÃO é um proxy genérico, de propósito. Um endpoint que aceitasse qualquer
// caminho e qualquer corpo recriaria exatamente a classe de brecha que a
// migração está fechando — foi assim que o gift card virou forjável. Aqui cada
// nó declara quais operações aceita, e o que não está declarado é recusado.
//
// Foi o que aconteceu na troca para o DynamoDB: só o interior mudou, e o
// painel não foi reescrito.
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

const OPS = new Set(['ler', 'gravar', 'mesclar', 'apagar', 'confirmar-recebimento']);

// Pagamento recebido DIRETO pela empresa (dinheiro ou Pix fora do site). Só a
// admin registra, e é o que libera os pontos do cliente (lib/core/pontos.js).
// Operação própria, e não um `mesclar` qualquer, porque precisa de duas coisas
// que a escrita genérica não faz: conferir o estado do agendamento e creditar
// os pontos no servidor, uma vez só.
const METODOS_DIRETOS = new Set(['dinheiro', 'pix', 'cartao-maquininha', 'outro']);
const ENCERRADOS = new Set(['cancelled', 'rejected']);

async function confirmarRecebimento(id, dados, autor) {
  const metodo = dados && dados.metodo;
  if (!METODOS_DIRETOS.has(metodo)) return { status: 400, erro: 'forma de pagamento inválida' };
  const valor = dados.valor === undefined || dados.valor === null ? null : Number(dados.valor);
  if (valor !== null && (!Number.isFinite(valor) || valor <= 0 || valor > 100000)) {
    return { status: 400, erro: 'valor recebido inválido' };
  }
  const b = await store.dbGet(`bookings/${id}`);
  if (!b) return { status: 404, erro: 'agendamento não encontrado' };
  if (b.paymentConfirmedAt) return { status: 409, erro: 'o pagamento deste agendamento já foi confirmado' };
  if (ENCERRADOS.has(b.status)) return { status: 409, erro: `agendamento ${b.status} não recebe pagamento` };

  const agora = new Date().toISOString();
  await store.dbPatch(`bookings/${id}`, {
    paymentConfirmedAt: agora,
    paymentMethod: metodo,
    paymentConfirmedBy: autor,
    ...(valor !== null ? { receivedAmount: valor } : {}),
    // Concluído continua concluído; o resto passa a confirmado.
    ...(b.status === 'completed' ? {} : { status: 'confirmed', confirmedAt: b.confirmedAt || agora }),
  });
  const pontosCreditados = await pontos.creditarPorPagamento(id, { store });
  return { status: 200, dados: { paymentConfirmedAt: agora, pontos: pontosCreditados } };
}

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

const store = require('./lib/core/store');
const publicas = require('./lib/core/regras-publicas');
const agendamentoPublico = require('./lib/core/agendamento-publico');
const pontos = require('./lib/core/pontos');

// Op da API → operação no banco. Mantido como mapa explícito: um `if` em
// cadeia convidaria a acrescentar operação sem passar pela tabela de
// permissões, que é o que mantém esta função não sendo um proxy genérico.
const EXECUTAR = {
  ler:     (caminho) => store.dbGet(caminho),
  gravar:  (caminho, dados) => store.dbSet(caminho, dados),
  mesclar: (caminho, dados) => store.dbPatch(caminho, dados),
  apagar:  (caminho) => store.dbDelete(caminho),
};

/** Consulta aceita: só `{ ordem, igual }`, ambos texto curto. */
function consultaValida(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const chaves = Object.keys(c);
  if (chaves.some((k) => k !== 'ordem' && k !== 'igual')) return false;
  if (typeof c.ordem !== 'string' || c.ordem.length > 60) return false;
  if (c.igual !== undefined && typeof c.igual !== 'string' && typeof c.igual !== 'number'
      && typeof c.igual !== 'boolean') return false;
  return true;
}

/** Aplica `{ordem, igual}` sobre o nó, como o Firebase fazia no servidor. */
function aplicarFiltro(valor, c) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return valor;
  const fora = {};
  for (const [k, item] of Object.entries(valor)) {
    if (item && typeof item === 'object' && item[c.ordem] === c.igual) fora[k] = item;
  }
  return Object.keys(fora).length ? fora : null;
}

/**
 * Autoriza o visitante não logado. Devolve `null` se pode, ou a mensagem de
 * recusa.
 *
 * A escrita é validada contra o valor que RESULTARÁ dela — no `mesclar`, o
 * mesclado. Validar só o pedaço enviado deixaria passar "mudar status" sem
 * olhar o resto do registro, que é como se cancela um agendamento alheio.
 */
async function autorizarPublico(op, segmentos, dados, consulta) {
  const caminho = segmentos.join('/');
  if (op === 'ler') {
    return publicas.podeLer(segmentos, consulta) ? null : 'leitura não permitida';
  }
  if (op === 'apagar') return 'remoção não permitida';
  if (op !== 'gravar' && op !== 'mesclar') return 'operação não permitida';

  let atual = null;
  try {
    atual = await store.dbGet(caminho);
  } catch {
    return 'não foi possível conferir o registro';
  }
  const resultante = op === 'mesclar'
    ? { ...(atual && typeof atual === 'object' ? atual : {}), ...dados }
    : dados;
  return publicas.podeGravar(segmentos, resultante, atual) ? null : 'escrita não permitida';
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

  // DOIS NÍVEIS DE ACESSO.
  //
  // Admin (grupo `admin` no Cognito): a tabela NOS acima, como sempre.
  //
  // Visitante não logado: o que `lib/core/regras-publicas.js` permite — ler o
  // catálogo e criar o próprio pedido. Esse nível existe desde 16/11/2026
  // porque o banco deixou de ser o Firebase: eram as regras do Realtime
  // Database que autorizavam o visitante, e no DynamoDB não existe regra de
  // banco. Sem isto, o site não lê preço nem grava agendamento.
  //
  // Não vira proxy genérico: o visitante não escolhe operação nem nó: cada
  // combinação é declarada, e o que não está declarado é recusado.
  const token = bearerToken(event);
  const ehAdmin = token ? await verifyAdmin(token) : false;

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

  const { op, caminho, dados, consulta } = body || {};
  if (!OPS.has(op)) return reply(400, cors, { ok: false, error: 'op inválida' });

  const v = validarCaminho(caminho);
  if (v.erro) return reply(400, cors, { ok: false, error: v.erro });
  if (consulta !== undefined && !consultaValida(consulta)) {
    return reply(400, cors, { ok: false, error: 'consulta inválida' });
  }
  if (op === 'confirmar-recebimento') {
    if (!ehAdmin) return reply(403, cors, { ok: false, error: 'só a admin confirma recebimento' });
    if (v.segmentos[0] !== 'bookings' || v.segmentos.length !== 2) {
      return reply(400, cors, { ok: false, error: 'confirmar-recebimento vale só para um agendamento' });
    }
    let quem = null;
    try { quem = await identificar(token); } catch { /* só para o registro */ }
    const autor = quem ? (quem.email || quem.uid) : 'admin';
    try {
      const r = await confirmarRecebimento(v.segmentos[1], dados, autor);
      if (r.erro) return reply(r.status, cors, { ok: false, error: r.erro });
      console.log(`admin-data: ${autor} confirmou recebimento de ${caminho} (${dados.metodo}); pontos: ${r.dados.pontos.creditado}`);
      return reply(200, cors, { ok: true, dados: r.dados });
    } catch (err) {
      console.error(`admin-data: ${autor} confirmar-recebimento ${caminho} falhou: ${err.message}`);
      return reply(502, cors, { ok: false, error: 'falha ao acessar o banco' });
    }
  }
  if (ehAdmin) {
    if (!autorizado(op, v.segmentos)) {
      return reply(403, cors, { ok: false, error: `operação '${op}' não permitida em '${caminho}'` });
    }
  } else {
    const negado = await autorizarPublico(op, v.segmentos, dados, consulta);
    if (negado) return reply(403, cors, { ok: false, error: negado });
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
  if (ehAdmin) {
    try {
      quem = await identificar(token);
    } catch { /* o verifyAdmin já passou; a identidade é só para o log */ }
  }
  const autor = ehAdmin
    ? (quem ? `${quem.email || quem.uid} (${quem.origem})` : 'admin')
    : `visitante ${clientIp(event)}`;

  // Agendamento NOVO criado pelo site: o preço é do servidor, e cupom e gift
  // card são baixados na mesma transação (lib/core/agendamento-publico.js).
  // A alteração de um agendamento existente (cancelar) segue o caminho comum,
  // em que regras-publicas já impede mexer no preço.
  if (!ehAdmin && op === 'gravar' && v.segmentos[0] === 'bookings' && v.segmentos.length === 2) {
    try {
      const existente = await store.dbGet(caminho);
      if (existente === null || existente === undefined) {
        let quemVisita = null;
        if (token) {
          try { quemVisita = await identificar(token); } catch { quemVisita = null; }
        }
        const r = await agendamentoPublico.criarAgendamentoPublico(v.segmentos[1], dados, quemVisita, { store });
        if (r.erro) return reply(r.status, cors, { ok: false, error: r.erro });
        console.log(`admin-data: ${autor} criou ${caminho} por R$ ${r.agendamento.price} (preço do servidor)`);
        return reply(200, cors, { ok: true, dados: r.agendamento });
      }
    } catch (err) {
      console.error(`admin-data: ${autor} criar ${caminho} falhou: ${err.message}`);
      return reply(502, cors, { ok: false, error: 'falha ao acessar o banco' });
    }
  }

  try {
    const executar = EXECUTAR[op];
    if (!executar) return reply(400, cors, { ok: false, error: 'operação inválida' });
    let resultado = await executar(caminho, dados);

    // Filtro no SERVIDOR para quem não é admin. Filtrar no navegador deixaria a
    // avaliação pendente chegar lá — e chegar já é vazar, mesmo que a tela não
    // mostre.
    if (!ehAdmin && op === 'ler' && consulta) resultado = aplicarFiltro(resultado, consulta);

    if (op !== 'ler') console.log(`admin-data: ${autor} ${op} ${caminho}`);
    return reply(200, cors, { ok: true, dados: resultado });
  } catch (err) {
    console.error(`admin-data: ${autor} ${op} ${caminho} falhou: ${err.message}`);
    return reply(502, cors, { ok: false, error: 'falha ao acessar o banco' });
  }
};

// Exportado para teste: a política é o coração da segurança desta função, e
// precisa ser verificável sem rede.
exports._interno = { NOS, BLOQUEADOS, validarCaminho, autorizado, autorizarPublico, aplicarFiltro, consultaValida, confirmarRecebimento };
