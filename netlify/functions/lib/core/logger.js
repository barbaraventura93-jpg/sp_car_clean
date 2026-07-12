const { dbPush, dbDelete, dbGet } = require('./firebase');

const MAX_LOGS = 200;

async function log({ agentId, trigger, ok, summary = '', error = null, durationMs }) {
  await dbPush('/aiLogs', {
    agentId,
    trigger,
    ok,
    summary: summary || '',
    error:   error   || null,
    durationMs,
    at: new Date().toISOString()
  });

  // Prune oldest entries beyond MAX_LOGS (non-fatal if it fails)
  try {
    const all = await dbGet('/aiLogs');
    if (all && typeof all === 'object') {
      const keys = Object.keys(all); // Firebase push keys are chronologically ordered
      if (keys.length > MAX_LOGS) {
        for (const key of keys.slice(0, keys.length - MAX_LOGS)) {
          await dbDelete(`/aiLogs/${key}`);
        }
      }
    }
  } catch { /* pruning failure is non-fatal */ }
}

module.exports = { log };
