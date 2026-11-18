'use strict';

// Consulta de status de agendamento (item 3b do backlog de segurança).
//
// A leitura pública de /bookings foi desativada nas regras do RTDB para evitar
// enumeração de códigos e exposição de dados pessoais. Esta função faz a consulta
// server-side (via Database Secret) exigindo CÓDIGO + E-MAIL e devolve apenas os
// campos seguros do agendamento (sem notas internas). Falhas retornam sempre a
// mesma resposta genérica, para não revelar se um código existe (anti-oráculo),
// e há rate-limit por IP.

// O banco é o DynamoDB desde 16/11/2026.
const { dbGet } = require('./lib/core/store');

const RL_WINDOW_MS = 3_600_000; // 1 hora
const RL_MAX       = 30;        // tentativas por IP/hora
const rlStore      = {};        // em memória — reseta a cada cold start

// Campos internos que nunca voltam ao cliente. Vazio por ora: `adminNotes` é,
// por design, uma observação que o admin compartilha com o cliente (aparece como
// "Nota" na consulta de status e como "Obs" no WhatsApp de aprovação). Se um dia
// existir uma nota realmente privada, adicione o nome do campo aqui.
const INTERNAL_FIELDS = [];

exports.handler = async (event) => {
  const reply = (status, body) => ({
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  // Resposta genérica de "não encontrado" — idêntica para código inexistente e
  // e-mail que não confere, para não servir de oráculo de enumeração.
  const notFound = () => reply(200, { ok: false });

  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method Not Allowed' });

  let data;
  try { data = JSON.parse(event.body); }
  catch { return reply(400, { ok: false, error: 'JSON inválido' }); }

  const code  = String(data.code  || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  if (!code || !email || !email.includes('@')) {
    return reply(400, { ok: false, error: 'code e email são obrigatórios' });
  }

  // Rate-limit por IP.
  const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (!checkRL(ip)) return reply(429, { ok: false, error: 'muitas tentativas — tente mais tarde' });

  try {
    const booking = await dbGet(`bookings/${code}`);
    if (!booking || typeof booking !== 'object') return notFound();

    // Confere o e-mail do agendamento (case-insensitive).
    const bookingEmail = String(booking.email || '').trim().toLowerCase();
    if (!bookingEmail || bookingEmail !== email) return notFound();

    // Remove campos internos antes de devolver.
    const safe = {};
    for (const [k, v] of Object.entries(booking)) {
      if (!INTERNAL_FIELDS.includes(k)) safe[k] = v;
    }
    return reply(200, { ok: true, booking: safe });
  } catch (err) {
    console.error('booking-status error:', err.message);
    return reply(500, { ok: false, error: 'indisponível' });
  }
};

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
