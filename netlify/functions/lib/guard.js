'use strict';

// Proteções leves para as funções HTTP públicas (item 5 do backlog):
// rate-limit por IP (em memória — reseta a cada cold start e é por instância,
// mas corta o grosso do abuso) e checagem de origem (CORS) para reduzir chamadas
// de fora do site. Não substitui autenticação, mas evita geração de links de
// pagamento e disparo de notificações/WhatsApp em massa por terceiros.

const ALLOWED_ORIGINS = [
  'https://www.spcarclean.com.br',
  'https://spcarclean.com.br',
  'https://sp-car-clean.netlify.app'
];

const stores = {}; // { bucket: { ip: { count, start } } }

function clientIp(event) {
  return String((event.headers && (event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'])) || 'unknown')
    .split(',')[0].trim();
}

// true = permitido; false = estourou o limite.
function rateLimit(bucket, ip, { windowMs = 3_600_000, max = 20 } = {}) {
  const store = stores[bucket] || (stores[bucket] = {});
  const now = Date.now();
  const rec = store[ip];
  if (!rec || now - rec.start > windowMs) { store[ip] = { count: 1, start: now }; return true; }
  if (rec.count >= max) return false;
  rec.count++;
  return true;
}

function _origin(event) {
  return (event.headers && (event.headers.origin || event.headers.Origin)) || '';
}

// Aceita: sem Origin (alguns clientes não enviam), localhost, domínios oficiais
// e os previews *.netlify.app do projeto.
function originAllowed(event) {
  const origin = _origin(event);
  if (!origin) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+--)?sp-car-clean\.netlify\.app$/.test(origin)) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(event) {
  const origin = _origin(event);
  const allow = (origin && originAllowed(event)) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

module.exports = { clientIp, rateLimit, originAllowed, corsHeaders, ALLOWED_ORIGINS };
