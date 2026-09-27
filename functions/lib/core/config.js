const { dbGet, dbSet, dbPatch } = require('./firebase');
const { sendTelegram }          = require('./telegram');

const DEFAULTS = {
  ping:       { monthlyBudgetCalls: 10,  maxTokens: 256,  schedule: null,            trigger: 'http', name: 'Ping (Teste)',            desc: 'Valida a conectividade com a Claude API.' },
  relatorio:  { monthlyBudgetCalls: 10,  maxTokens: 1024, schedule: 'weekly:mon:08', trigger: 'both', name: 'Relatório Semanal',        desc: 'Resumo executivo semanal enviado via Telegram às segundas.' },
  reativacao: { monthlyBudgetCalls: 60,  maxTokens: 1024, schedule: null,            trigger: 'http', name: 'Reativação de Inativos',   desc: 'E-mails personalizados para clientes sem retorno há 90+ dias.' },
  agenda:     { monthlyBudgetCalls: 30,  maxTokens: 512,  schedule: null,            trigger: 'http', name: 'Otimizador de Agenda',     desc: 'Ranqueia candidatos da waitlist para vagas liberadas.' },
  upsell:     { monthlyBudgetCalls: 300, maxTokens: 256,  schedule: null,            trigger: 'http', name: 'Sugestão de Complemento',  desc: 'Sugere 1 complemento no agendamento com base no histórico.' },
  concierge:  { monthlyBudgetCalls: 500, maxTokens: 600,  schedule: null,            trigger: 'http', name: 'Chat Concierge',           desc: 'Widget de chat público que responde dúvidas e recomenda serviços.' },
  orcamento:  { monthlyBudgetCalls: 200, maxTokens: 1024, schedule: null,            trigger: 'http', name: 'Orçamento por Foto',       desc: 'Analisa fotos para recomendar serviço e faixa de preço.' },
  checkin:    { monthlyBudgetCalls: 150, maxTokens: 1024, schedule: null,            trigger: 'http', name: 'Descrição de Check-in',    desc: 'Gera descrição de condições do veículo a partir das fotos.' },
  satisfacao: { monthlyBudgetCalls: 60,  maxTokens: 1024, schedule: 'daily:08',      trigger: 'both', name: 'Análise de Satisfação',    desc: 'Classifica avaliações e alerta sobre notas baixas via Telegram.' },
  insumos:    { monthlyBudgetCalls: 10,  maxTokens: 1024, schedule: 'weekly:mon:08', trigger: 'both', name: 'Previsão de Reposição',    desc: 'Cruza agenda e estoque para alertar sobre itens em falta.' },
  conteudo:   { monthlyBudgetCalls: 60,  maxTokens: 1024, schedule: null,            trigger: 'http', name: 'Legendas para Galeria',    desc: 'Gera legenda de Instagram e descrição de galeria para o par de fotos.' }
};

async function getAgentConfig(agentId) {
  try { return await dbGet(`/aiConfig/${agentId}`); } catch { return null; }
}

async function checkBudget(agentId) {
  const cfg = await getAgentConfig(agentId);
  if (!cfg) return { ok: false, reason: 'no_config' };
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  const month = new Date().toISOString().slice(0, 7);
  let usage;
  try { usage = await dbGet(`/aiUsage/${month}/${agentId}`); } catch { usage = null; }
  const calls = usage?.calls || 0;

  if (calls >= cfg.monthlyBudgetCalls) {
    await autoDisable(agentId, 'budget');
    return { ok: false, reason: 'budget' };
  }
  return { ok: true, calls, limit: cfg.monthlyBudgetCalls };
}

async function incrementUsage(agentId, { inputTokens = 0, outputTokens = 0 } = {}) {
  const month = new Date().toISOString().slice(0, 7);
  let usage;
  try { usage = await dbGet(`/aiUsage/${month}/${agentId}`); } catch { usage = null; }
  await dbSet(`/aiUsage/${month}/${agentId}`, {
    calls:        (usage?.calls        || 0) + 1,
    inputTokens:  (usage?.inputTokens  || 0) + inputTokens,
    outputTokens: (usage?.outputTokens || 0) + outputTokens
  });
}

async function autoDisable(agentId, reason) {
  await dbPatch(`/aiConfig/${agentId}`, {
    enabled: false,
    disabledReason: reason,
    updatedAt: new Date().toISOString()
  });
  const name = DEFAULTS[agentId]?.name || agentId;
  await sendTelegram(`⚠️ *IA SP Car Clean*\nAgente *${name}* auto\\-desligado\\.\nMotivo: \`${reason}\``);
}

module.exports = { getAgentConfig, checkBudget, incrementUsage, autoDisable, DEFAULTS };
