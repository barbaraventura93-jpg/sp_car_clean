'use strict';

// POST /api/ai — orquestrador de agentes de IA
// Agentes admin: exigem Authorization: Bearer <Firebase ID token>
// Agentes públicos: rate-limit por IP (20 req/hora)

const CORS_ORIGINS  = ['https://www.spcarclean.com.br'];
const ADMIN_AGENTS  = new Set(['ping', 'relatorio', 'reativacao', 'agenda', 'satisfacao', 'checkin', 'conteudo']);
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

  let body;
  try { body = JSON.parse(event.body); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

  const { agentId, payload = {} } = body || {};
  if (!agentId || !/^[a-z]+$/.test(agentId)) {
    return reply(400, { ok: false, error: 'agentId inválido' });
  }

  const config = require('./lib/core/config');
  const logger  = require('./lib/core/logger');

  // --- Autenticação / rate-limit ---
  if (ADMIN_AGENTS.has(agentId)) {
    const token = (event.headers.authorization || '').replace(/^Bearer /, '');
    if (!token)               return reply(401, { ok: false, error: 'não autorizado' });
    if (!await verifyAdmin(token)) return reply(403, { ok: false, error: 'token inválido' });
  } else {
    const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    if (!checkRL(ip)) return reply(429, { ok: false, error: 'muitas requisições — tente em 1 hora' });
  }

  // --- Flag + budget ---
  const budget = await config.checkBudget(agentId);
  if (!budget.ok) return reply(200, { ok: false, reason: budget.reason });

  // --- Carregar e executar agente ---
  let agentMod;
  try { agentMod = require(`./lib/agents/${agentId}`); }
  catch { return reply(404, { ok: false, error: 'agente não encontrado' }); }

  const { core, getUsage } = buildCore();
  const t0 = Date.now();

  try {
    const result = await agentMod.run(payload, core);
    await config.incrementUsage(agentId, getUsage());
    await logger.log({ agentId, trigger: 'http', ok: true, summary: result.summary || '', durationMs: Date.now() - t0 });
    return reply(200, { ok: true, ...result });
  } catch (err) {
    await logger.log({ agentId, trigger: 'http', ok: false, summary: '', error: err.message, durationMs: Date.now() - t0 });
    return reply(200, { ok: false, error: err.message });
  }
};

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

async function verifyAdmin(token) {
  const apiKey     = process.env.FIREBASE_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL || 'spcarclean0@gmail.com';
  if (!apiKey) return false;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.users?.[0]?.email === adminEmail;
  } catch { return false; }
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
