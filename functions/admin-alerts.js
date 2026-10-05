'use strict';

// Cron diário — avisos da manhã para o admin (push no celular + Telegram).
// Roda às 07:30 BRT (10:30 UTC) — EventBridge Scheduler, infra/api.tf.
//
//  1. Entregas próximas: serviços aprovados/confirmados com retirada (endDate)
//     de hoje até ADMIN_ALERT_DAYS dias (padrão 2).
//  2. Estoque: produtos com quantidade abaixo do mínimo cadastrado (ou zerados).
//
// Novos agendamentos, reagendamentos e cancelamentos já avisam na hora
// (notify-booking). Variáveis: FIREBASE_DATABASE_URL, FIREBASE_DATABASE_SECRET,
// ADMIN_ALERT_DAYS (opcional), TELEGRAM_* (opcional), push (PUSH_TABLE + VAPID).

const { dbGet } = require('./lib/core/firebase');
const { sendTelegram } = require('./lib/core/telegram');
const { sendAdminPush } = require('./lib/webpush');

const ACTIVE = ['approved', 'confirmed'];

// Data no fuso de Brasília (UTC-3, sem horário de verão desde 2019), deslocada em dias.
function brtDate(offsetDays = 0) {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const fmtBR = (ymd) => (ymd && ymd.length >= 10 ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) : ymd || '-');

function dueDeliveries(bookings, days) {
  const from = brtDate(0);
  const to = brtDate(days);
  return Object.entries(bookings || {})
    .map(([key, b]) => (b && typeof b === 'object' ? { id: b.id || key, ...b } : null))
    .filter((b) => b && ACTIVE.includes(b.status))
    .map((b) => ({ ...b, due: String(b.endDate || b.pickup || b.startDate || b.date || '').slice(0, 10) }))
    .filter((b) => b.due >= from && b.due <= to)
    .sort((a, b) => a.due.localeCompare(b.due));
}

function lowStock(stock) {
  return Object.entries(stock || {})
    .map(([id, p]) => ({ id, name: (p && p.name) || id, unit: (p && p.unit) || 'un', qty: Number(p && p.qty) || 0, minQty: Number(p && p.minQty) || 0 }))
    .filter((p) => p.minQty > 0 && p.qty < p.minQty)
    .sort((a, b) => a.qty / a.minQty - b.qty / b.minQty);
}

function whenLabel(ymd) {
  if (ymd === brtDate(0)) return 'hoje';
  if (ymd === brtDate(1)) return 'amanhã';
  return fmtBR(ymd);
}

exports.handler = async () => {
  const days = Math.max(0, parseInt(process.env.ADMIN_ALERT_DAYS || '2', 10) || 2);
  const site = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

  let bookings, stock;
  try {
    [bookings, stock] = await Promise.all([dbGet('/bookings'), dbGet('/stock').catch(() => null)]);
  } catch (err) {
    console.error('admin-alerts: erro lendo o Firebase:', err.message);
    return { ok: false, error: err.message };
  }

  const due = dueDeliveries(bookings, days);
  const low = lowStock(stock);
  const results = {};

  if (due.length) {
    const lines = due.map((b) => `${whenLabel(b.due)} · ${b.name || 'Cliente'} · ${b.car || ''}`.trim());
    results.deliveries = await sendAdminPush({
      title: `🏁 ${due.length} entrega(s) nos próximos ${days} dia(s)`,
      body: lines.slice(0, 4).join('\n') + (lines.length > 4 ? `\n+${lines.length - 4}` : ''),
      link: `${site}/?admin`,
      tag: 'spcc-entregas'
    });
    await sendTelegram(
      `🏁 *Entregas próximas — SP Car Clean*\n\n` +
      due.map((b) => `• *${whenLabel(b.due)}* — ${b.name || 'Cliente'} (${b.id})${b.car ? ' · ' + b.car : ''}`).join('\n')
    );
  }

  if (low.length) {
    const lines = low.map((p) => `${p.name}: ${p.qty} ${p.unit} (mín. ${p.minQty})`);
    results.stock = await sendAdminPush({
      title: `📦 ${low.length} produto(s) em falta no estoque`,
      body: lines.slice(0, 4).join('\n') + (lines.length > 4 ? `\n+${lines.length - 4}` : ''),
      link: `${site}/?admin`,
      tag: 'spcc-estoque'
    });
    await sendTelegram(`📦 *Estoque abaixo do mínimo — SP Car Clean*\n\n` + lines.map((l) => `• ${l}`).join('\n'));
  }

  console.log(`admin-alerts: ${due.length} entrega(s), ${low.length} item(ns) de estoque`);
  return { ok: true, deliveries: due.length, lowStock: low.length, results };
};

exports._test = { dueDeliveries, lowStock, brtDate };
