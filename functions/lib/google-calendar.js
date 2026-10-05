'use strict';

// Google Agenda (Calendar API v3) sem SDK: token de acesso a partir do refresh
// token do admin (OAuth, autorizado uma vez com scripts/google-calendar-auth.js)
// e upsert/remoção de eventos com id fixo por agendamento.
//
// Variáveis (SSM):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_ID → agenda que recebe os eventos (padrão: "primary", a principal do admin)

const crypto = require('crypto');

const API = 'https://www.googleapis.com/calendar/v3';

function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

let _token = null; // { value, exp }
async function accessToken() {
  if (_token && _token.exp > Date.now() + 60_000) return _token.value;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google OAuth: ${data.error || resp.status} ${data.error_description || ''}`.trim());
  }
  _token = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return _token.value;
}

const calendarId = () => encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');

// Id do evento derivado do código do agendamento: só [a-v0-9] (base32hex), como a API exige.
function eventId(bookingId) {
  return 'spcc' + crypto.createHash('sha1').update(String(bookingId)).digest('hex');
}

async function call(method, path, body) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return resp;
}

/**
 * Cria ou atualiza o evento (id fixo). sendUpdates 'all' avisa os convidados
 * (o cliente recebe/atualiza o evento na agenda dele); 'none' não avisa ninguém.
 */
async function upsertEvent(event, sendUpdates = 'none') {
  const q = `?sendUpdates=${sendUpdates}`;
  let resp = await call('PUT', `/calendars/${calendarId()}/events/${event.id}${q}`, event);
  if (resp.status === 404) {
    resp = await call('POST', `/calendars/${calendarId()}/events${q}`, event);
    // 409: outra execução criou o mesmo id agora há pouco → atualiza.
    if (resp.status === 409) resp = await call('PUT', `/calendars/${calendarId()}/events/${event.id}${q}`, event);
  }
  if (!resp.ok) throw new Error(`Google Calendar ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

async function deleteEvent(id, sendUpdates = 'none') {
  const resp = await call('DELETE', `/calendars/${calendarId()}/events/${id}?sendUpdates=${sendUpdates}`);
  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    throw new Error(`Google Calendar ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
}

module.exports = { configured, eventId, upsertEvent, deleteEvent };
