'use strict';

// Netlify Scheduled Function — executa diariamente às 08:00 BRT (11:00 UTC)
// Configurado em netlify.toml: schedule = "0 11 * * *"

exports.handler = async () => {
  const config = require('./lib/core/config');
  const logger  = require('./lib/core/logger');

  const now = new Date();
  const dow = ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];

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

      let agentMod;
      try { agentMod = require(`./lib/agents/${agentId}`); }
      catch { console.log(`ai-dispatcher: módulo ${agentId} não encontrado`); continue; }

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
