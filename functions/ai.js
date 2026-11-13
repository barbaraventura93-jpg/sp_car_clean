'use strict';

// POST /api/ai — orquestrador de agentes de IA
// Agentes admin: exigem Authorization: Bearer <Firebase ID token>
// Agentes públicos: rate-limit por IP (20 req/hora)

const { verifyAdmin } = require('./lib/admin-auth');

const CORS_ORIGINS  = ['https://www.spcarclean.com.br'];
// Tudo que não é chamado por visitante exige admin. `insumos` lê o estoque e
// dispara alerta no Telegram: público, qualquer pessoa gastava o orçamento do
// mês e enchia o Telegram da dona. O painel já chama com o token de admin.
const ADMIN_AGENTS  = new Set(['ping', 'relatorio', 'reativacao', 'agenda', 'satisfacao', 'checkin', 'conteudo', 'insumos']);
// Os únicos agentes que um visitante sem login pode chamar. Lista de
// permissão: agente novo nasce fechado, e só entra aqui de propósito.
const PUBLIC_AGENTS = new Set(['concierge', 'orcamento', 'upsell']);

// Tetos da entrada pública. Texto de visitante vira custo de IA (paga-se por
// tamanho) e entra no prompt: sem teto, uma conversa forjada de megabytes
// custava caro e esgotava o orçamento mensal, que desliga o agente sozinho.
const MAX_BODY_BYTES   = 6 * 1024 * 1024; // comporta a foto do orçamento (~4 MB em base64)
const MAX_MSG_CHARS    = 1000;            // uma mensagem do visitante
const MAX_HIST_MSGS    = 10;              // o site manda no máximo 9
const MAX_HIST_CHARS   = 2000;            // cada mensagem do histórico (a resposta da IA tem até 600 tokens)
const MAX_FIELD_CHARS  = 120;             // campos curtos do upsell

/**
 * Valida e normaliza o payload de um agente público. Devolve { payload } ou
 * { erro }. O que não é esperado é descartado, não repassado ao agente.
 */
function validarEntradaPublica(agentId, bruto) {
  const p = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const texto = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

  if (agentId === 'concierge') {
    const userMessage = texto(p.userMessage, MAX_MSG_CHARS);
    if (!userMessage || !userMessage.trim()) return { erro: 'mensagem ausente ou longa demais' };
    const hist = p.messages === undefined ? [] : p.messages;
    if (!Array.isArray(hist) || hist.length > MAX_HIST_MSGS) return { erro: 'histórico inválido' };
    const messages = [];
    for (const m of hist) {
      // Só os dois papéis de uma conversa, e só texto: nada de bloco de
      // imagem, de ferramenta ou de papel inventado vindo do navegador.
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) return { erro: 'histórico inválido' };
      const content = texto(m.content, MAX_HIST_CHARS);
      if (content === null) return { erro: 'histórico inválido' };
      messages.push({ role: m.role, content });
    }
    return { payload: { messages, userMessage } };
  }

  if (agentId === 'orcamento') {
    // Mesmos limites do agente, conferidos aqui para o visitante receber o
    // motivo certo (o erro interno do agente não é mais devolvido a ele).
    if (typeof p.imageBase64 !== 'string' || !p.imageBase64) return { erro: 'imagem ausente' };
    if (p.imageBase64.length > 4_000_000) return { erro: 'Imagem muito grande — reduza a qualidade antes de enviar' };
    if (p.imageType !== undefined && !['image/jpeg', 'image/png', 'image/webp'].includes(p.imageType)) return { erro: 'Tipo de imagem não suportado' };
    if (p.userMessage !== undefined && texto(p.userMessage, MAX_MSG_CHARS) === null) return { erro: 'mensagem longa demais' };
    return { payload: { imageBase64: p.imageBase64, imageType: typeof p.imageType === 'string' ? p.imageType : 'image/jpeg', userMessage: p.userMessage } };
  }

  if (agentId === 'upsell') {
    const limpo = {};
    for (const campo of ['email', 'serviceId', 'lastService', 'lastDate']) {
      if (p[campo] === undefined || p[campo] === null) continue;
      const v = texto(p[campo], MAX_FIELD_CHARS);
      if (v === null) return { erro: `campo inválido: ${campo}` };
      limpo[campo] = v;
    }
    if (p.daysSince !== undefined && p.daysSince !== null) {
      const d = Number(p.daysSince);
      if (!Number.isFinite(d) || d < 0 || d > 36500) return { erro: 'campo inválido: daysSince' };
      limpo.daysSince = Math.floor(d);
    }
    return { payload: limpo };
  }

  return { erro: 'agente não disponível' };
}
const RL_WINDOW_MS  = 3_600_000; // 1 hora
const RL_MAX        = 20;

const rlStore = {}; // em memória — resets a cada cold start

exports.handler = async (event) => {
  const origin    = event.headers.origin || '';
  const isLocal   = /^https?:\/\/localhost(:\d+)?$/.test(origin);
  const corsAllow = (isLocal || CORS_ORIGINS.includes(origin)) ? origin : CORS_ORIGINS[0];

  const cors = {
    'Access-Control-Allow-Origin':  corsAllow,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const reply = (status, body) => ({ statusCode: status, headers: cors, body: JSON.stringify(body) });

  if (String(event.body || '').length > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'requisição grande demais' });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

  const { agentId } = body || {};
  let payload = (body && body.payload) || {};
  if (!agentId || !/^[a-z]+$/.test(agentId)) {
    return reply(400, { ok: false, error: 'agentId inválido' });
  }

  const config = require('./lib/core/config');
  const logger  = require('./lib/core/logger');
  const AGENTS  = require('./lib/agents');

  // --- Autenticação / rate-limit ---
  if (ADMIN_AGENTS.has(agentId)) {
    const token = (event.headers.authorization || '').replace(/^Bearer /, '');
    if (!token)               return reply(401, { ok: false, error: 'não autorizado' });
    if (!await verifyAdmin(token)) return reply(403, { ok: false, error: 'token inválido' });
  } else {
    if (!PUBLIC_AGENTS.has(agentId)) return reply(404, { ok: false, error: 'agente não encontrado' });
    const v = validarEntradaPublica(agentId, payload);
    if (v.erro) return reply(400, { ok: false, error: v.erro });
    payload = v.payload;
    const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    // Pré-checagem em memória (rápida, por instância) + checagem persistente no
    // Firebase (compartilhada entre instâncias/cold starts). Qualquer uma que
    // estoure → 429.
    if (!checkRL(ip)) return reply(429, { ok: false, error: 'muitas requisições — tente em 1 hora' });
    if (!await checkRLPersistent(ip)) return reply(429, { ok: false, error: 'muitas requisições — tente em 1 hora' });
  }

  // --- Flag + budget ---
  const budget = await config.checkBudget(agentId);
  if (!budget.ok) return reply(200, { ok: false, reason: budget.reason });

  // --- Carregar e executar agente ---
  const agentMod = AGENTS[agentId];
  if (!agentMod) return reply(404, { ok: false, error: 'agente não encontrado' });

  const { core, getUsage } = buildCore();
  const t0 = Date.now();

  try {
    const result = await agentMod.run(payload, core);
    await config.incrementUsage(agentId, getUsage());
    await logger.log({ agentId, trigger: 'http', ok: true, summary: result.summary || '', durationMs: Date.now() - t0 });
    return reply(200, { ok: true, ...result });
  } catch (err) {
    await logger.log({ agentId, trigger: 'http', ok: false, summary: '', error: err.message, durationMs: Date.now() - t0 });
    // O detalhe do erro (que pode trazer a resposta crua da API de IA) fica no
    // log acima. A admin vê o motivo; o visitante vê uma mensagem genérica.
    return reply(200, { ok: false, error: ADMIN_AGENTS.has(agentId) ? err.message : 'Não consegui responder agora. Tente de novo em instantes.' });
  }
};

// Exportado para teste.
exports._interno = { validarEntradaPublica, ADMIN_AGENTS, PUBLIC_AGENTS, MAX_MSG_CHARS, MAX_HIST_MSGS, MAX_HIST_CHARS };

// --- Helpers ---

function buildCore() {
  const claude   = require('./lib/core/claude');
  const firebase = require('./lib/core/firebase');
  const telegram = require('./lib/core/telegram');
  const email    = require('./lib/core/email');
  const usage    = { inputTokens: 0, outputTokens: 0 };

  const core = {
    claude: {
      async complete(opts) {
        const r = await claude.complete(opts);
        usage.inputTokens  += r.inputTokens;
        usage.outputTokens += r.outputTokens;
        return r;
      }
    },
    firebase,
    telegram,
    email
  };

  return { core, getUsage: () => ({ ...usage }) };
}

function checkRL(ip) {
  const now = Date.now();
  if (!rlStore[ip] || now - rlStore[ip].start > RL_WINDOW_MS) {
    rlStore[ip] = { count: 1, start: now };
    return true;
  }
  if (rlStore[ip].count >= RL_MAX) return false;
  rlStore[ip].count++;
  return true;
}

// Rate-limit persistente e compartilhado entre instâncias (item 6). Usa o
// incremento atômico do Realtime Database (server value {".sv":{"increment":1}})
// num contador por hora e por IP, escrito com o Database Secret (ignora as
// regras). Fail-open: se o DB não responder, não bloqueia (os tetos de orçamento
// por agente e o rate-limit em memória seguem valendo). Os buckets antigos são
// limpos diariamente pelo ai-dispatcher.
async function checkRLPersistent(ip) {
  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  if (!dbUrl || !dbSecret) return true; // sem DB configurado → não bloqueia
  const bucket = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, ''); // YYYYMMDDHH
  const key    = `${bucket}_${String(ip).replace(/[^0-9A-Za-z]/g, '_').slice(0, 60)}`;
  try {
    const resp = await fetch(`${dbUrl}/aiRateLimit/${key}.json?auth=${dbSecret}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '.sv': { increment: 1 } })
    });
    if (!resp.ok) return true; // fail-open
    const count = Number(await resp.json());
    return !Number.isFinite(count) || count <= RL_MAX;
  } catch {
    return true; // fail-open
  }
}
