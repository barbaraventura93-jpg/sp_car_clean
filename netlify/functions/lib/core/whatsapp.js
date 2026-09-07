// ============================================================
// WhatsApp Cloud API (Meta) — envio de mensagens ao CLIENTE
// saindo do número oficial da loja.
//
// Mensagens iniciadas pela empresa (fora da janela de 24h) exigem
// TEMPLATES pré-aprovados pela Meta. Cada tipo de evento abaixo
// mapeia para um template com parâmetros posicionais ({{1}}, {{2}}…).
//
// Variáveis de ambiente necessárias (Netlify → Site settings → Env):
//   WHATSAPP_TOKEN            → token de acesso (System User, permanente)
//   WHATSAPP_PHONE_NUMBER_ID  → ID do número na Cloud API (não é o telefone)
//   WHATSAPP_TEMPLATE_LANG    → idioma dos templates (padrão: pt_BR)
//   WA_TPL_*                  → (opcional) sobrescreve o nome de cada template
//
// Tudo é best-effort: se não estiver configurado ou o telefone faltar,
// a função simplesmente não envia (não quebra o fluxo de agendamento).
// ============================================================

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const LANG          = process.env.WHATSAPP_TEMPLATE_LANG  || 'pt_BR';

// Mapa: tipo de evento → { template, params(data) }
// A ORDEM do array `params` deve bater EXATAMENTE com {{1}},{{2}}… do
// corpo do template cadastrado na Meta (ver PASSO A PASSO no fim do arquivo
// e em WHATSAPP_SETUP.md).
// Os templates da Meta usam parâmetros NOMEADOS (ex.: {{nome}}), então cada
// parâmetro é um par [nome_da_variável, valor]. Os nomes têm que ser idênticos
// aos usados no corpo do template cadastrado (minúsculas, underscore, sem acento).
const TEMPLATES = {
  // Novo agendamento recebido (cliente acabou de solicitar pelo site)
  'new-booking': {
    name:   process.env.WA_TPL_NEW_BOOKING || 'agendamento_recebido',
    params: d => [['nome', d.name], ['servico', d.service || '-'], ['data', d.date || '-'], ['codigo', d.id || '-']]
  },
  // Reagendamento aprovado pela loja
  'reschedule-approved': {
    name:   process.env.WA_TPL_RESCHEDULE_APPROVED || 'reagendamento_aprovado',
    params: d => [['nome', d.name], ['nova_data', d.newDate || '-'], ['codigo', d.id || '-']]
  },
  // Reagendamento recusado pela loja
  'reschedule-rejected': {
    name:   process.env.WA_TPL_RESCHEDULE_REJECTED || 'reagendamento_recusado',
    params: d => [['nome', d.name], ['codigo', d.id || '-']]
  },
  // Cancelamento confirmado
  'client-cancel': {
    name:   process.env.WA_TPL_CANCEL || 'cancelamento_confirmado',
    params: d => [['nome', d.name], ['servico', d.service || '-'], ['data', d.date || '-'], ['codigo', d.id || '-']]
  },
  // Correção de valor
  'price-correction': {
    name:   process.env.WA_TPL_PRICE || 'correcao_valor',
    params: d => [['nome', d.name], ['valor_antigo', d.oldPrice || '-'], ['valor_novo', d.newPrice || '-'], ['codigo', d.id || '-']]
  },
  // Lembrete do dia anterior (enviado pela rotina reminder-check)
  'reminder': {
    name:   process.env.WA_TPL_REMINDER || 'lembrete_agendamento',
    params: d => [['nome', d.name], ['data', d.date || '-']]
  }
};

function isConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

// Normaliza telefone para o formato E.164 sem "+" exigido pela API.
// Assume Brasil (55) quando não houver código de país.
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  // Remove zeros à esquerda (ex.: "011 9…")
  digits = digits.replace(/^0+/, '');
  // Já tem código do Brasil? (55 + DDD(2) + número(8-9) = 12-13 dígitos)
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }
  // Número nacional (DDD + número = 10-11 dígitos) → prefixa 55
  if (digits.length === 10 || digits.length === 11) {
    return '55' + digits;
  }
  // Qualquer outro caso com código de país já embutido: usa como veio
  if (digits.length > 13) return digits;
  // Fallback: prefixa 55
  return '55' + digits;
}

async function callGraph(payload) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error?.message || `HTTP ${resp.status}`;
    throw new Error(err);
  }
  return body;
}

// Envia um template ao cliente. Retorna { ok, ... } sem lançar exceção,
// para ser usado em Promise.all junto com push/telegram.
async function sendWhatsAppTemplate(type, data) {
  try {
    if (!isConfigured())        return { ok: false, skipped: 'not_configured' };
    const cfg = TEMPLATES[type || 'new-booking'];
    if (!cfg)                   return { ok: false, skipped: 'no_template_for_type' };
    const to = normalizePhone(data.phone);
    if (!to)                    return { ok: false, skipped: 'no_phone' };

    const values = cfg.params(data).map(([pname, v]) => ({
      type: 'text', parameter_name: pname, text: String(v ?? '-')
    }));
    const resp = await callGraph({
      to,
      type: 'template',
      template: {
        name: cfg.name,
        language: { code: LANG },
        components: [{ type: 'body', parameters: values }]
      }
    });
    return { ok: true, id: resp?.messages?.[0]?.id || null, to };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Envio de texto livre — SÓ funciona dentro da janela de 24h (após o
// cliente ter mandado mensagem). Útil para respostas de atendimento.
async function sendWhatsAppText(phone, text) {
  try {
    if (!isConfigured()) return { ok: false, skipped: 'not_configured' };
    const to = normalizePhone(phone);
    if (!to)             return { ok: false, skipped: 'no_phone' };
    const resp = await callGraph({
      to, type: 'text', text: { preview_url: false, body: text }
    });
    return { ok: true, id: resp?.messages?.[0]?.id || null, to };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWhatsAppTemplate, sendWhatsAppText, normalizePhone, isConfigured };
