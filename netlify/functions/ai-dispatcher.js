'use strict';

// Netlify Scheduled Function — executa diariamente às 08:00 BRT (11:00 UTC)
// Configurado em netlify.toml: schedule = "0 11 * * *"

exports.handler = async () => {
  const config = require('./lib/core/config');
  const logger  = require('./lib/core/logger');
  const AGENTS  = require('./lib/agents');

  const now = new Date();
  const dow = ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];

  // Limpeza dos buckets de rate-limit (item 6): remove contadores de horas de
  // dias anteriores para não acumular. As chaves são `YYYYMMDDHH_ip`.
  await cleanupRateLimit(now).catch(e => console.error('ai-dispatcher: cleanup rate-limit falhou:', e.message));

  let dispatched = 0;

  for (const agentId of Object.keys(config.DEFAULTS)) {
    try {
      const cfg = await config.getAgentConfig(agentId);
      if (!cfg?.enabled || !cfg.schedule) continue;

      const s = cfg.schedule;
      const shouldRun = s === 'daily:08' || s === `weekly:${dow}:08`;
      if (!shouldRun) continue;

      const budget = await config.checkBudget(agentId);
      if (!budget.ok) {
        console.log(`ai-dispatcher: ${agentId} ignorado — ${budget.reason}`);
        continue;
      }

      const agentMod = AGENTS[agentId];
      if (!agentMod) { console.log(`ai-dispatcher: módulo ${agentId} não encontrado`); continue; }

      const { core, getUsage } = buildCore();
      const t0 = Date.now();

      try {
        const result = await agentMod.run({}, core);
        await config.incrementUsage(agentId, getUsage());
        await logger.log({ agentId, trigger: 'cron', ok: true, summary: result.summary || '', durationMs: Date.now() - t0 });
        dispatched++;
      } catch (err) {
        await logger.log({ agentId, trigger: 'cron', ok: false, summary: '', error: err.message, durationMs: Date.now() - t0 });
      }
    } catch (err) {
      console.error(`ai-dispatcher: erro em ${agentId}:`, err.message);
    }
  }

  console.log(`ai-dispatcher: ${dispatched} agente(s) executado(s)`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, dispatched }) };
};

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

// Remove os buckets de rate-limit (aiRateLimit) cujas chaves são de dias
// anteriores a hoje. Usa `shallow=true` para baixar só as chaves.
async function cleanupRateLimit(now) {
  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  if (!dbUrl || !dbSecret) return;
  const today = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const resp = await fetch(`${dbUrl}/aiRateLimit.json?shallow=true&auth=${dbSecret}`);
  if (!resp.ok) return;
  const keys = await resp.json();
  if (!keys || typeof keys !== 'object') return;
  let removed = 0;
  for (const key of Object.keys(keys)) {
    const day = key.slice(0, 8); // YYYYMMDD do bucket
    if (day < today) {
      await fetch(`${dbUrl}/aiRateLimit/${encodeURIComponent(key)}.json?auth=${dbSecret}`, { method: 'DELETE' }).catch(() => {});
      removed++;
    }
  }
  if (removed) console.log(`ai-dispatcher: ${removed} bucket(s) de rate-limit antigos removidos`);
}
