'use strict';

// Consulta de status de agendamento (item 3b do backlog de segurança).
//
// A leitura pública de /bookings foi desativada nas regras do RTDB para evitar
// enumeração de códigos e exposição de dados pessoais. Esta função faz a consulta
// server-side (via Database Secret) exigindo CÓDIGO + E-MAIL e devolve apenas os
// campos seguros do agendamento (sem notas internas). Falhas retornam sempre a
// mesma resposta genérica, para não revelar se um código existe (anti-oráculo),
// e há rate-limit por IP.

const RL_WINDOW_MS = 3_600_000; // 1 hora
const RL_MAX       = 30;        // tentativas por IP/hora
const rlStore      = {};        // em memória — reseta a cada cold start

// Campos internos que nunca voltam ao cliente.
const INTERNAL_FIELDS = ['adminNotes'];

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

  const dbUrl    = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const dbSecret = process.env.FIREBASE_DATABASE_SECRET;
  if (!dbUrl || !dbSecret) {
    console.error('booking-status: FIREBASE_DATABASE_URL ou FIREBASE_DATABASE_SECRET não configurado');
    return reply(500, { ok: false, error: 'indisponível' });
  }

  try {
    const resp = await fetch(
      `${dbUrl}/bookings/${encodeURIComponent(code)}.json?auth=${dbSecret}`
    );
    if (!resp.ok) return notFound();
    const booking = await resp.json();
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
