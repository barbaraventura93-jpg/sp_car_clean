'use strict';

// Reativação de clientes inativos — dois modos, um agente.
//
//  • MANUAL (`payload.clients`, pelo painel): devolve os textos para revisão.
//    Era o único modo que existia.
//  • AUTOMÁTICO (cron, sem payload): o agente escolhe os clientes, escreve e
//    ENVIA. Pedido da dona, literal: "não recuso os e-mails, se ele enviasse
//    automaticamente os e-mails num padrão seria melhor, mas tem que ter uma
//    funcionalidade do cliente se descadastrar, caso não queira mais receber
//    e-mails de marketing".
//
// O "padrão" do envio automático são as constantes abaixo. Elas existem porque
// envio automático sem limite tem três jeitos de dar errado: mandar para quem
// não quer (descadastro), mandar demais para a mesma pessoa (intervalo) e
// mandar para a base toda de uma vez (teto por execução). As três travas são
// testadas em scripts/test-reativacao-auto.js.

const optout = require('../core/optout');

const MAX_CLIENTS   = 20;  // modo manual: teto de tokens por clique
const MAX_AUTO      = 8;   // modo automático: por execução (semanal)
const DIAS_INATIVO  = 90;  // sem agendamento há tanto tempo = inativo
const INTERVALO_DIAS = 90; // intervalo mínimo entre dois marketings ao mesmo e-mail

const STATUS_ATIVO = new Set(['confirmed', 'approved', 'completed']);

// Template genérico do EmailJS (`titulo` + `mensagem` livres), o mesmo que o
// lembrete de agendamento usa. Assim o rodapé de descadastro entra no corpo:
// não depende de ninguém editar o template no painel do EmailJS.
const TEMPLATE = () => process.env.EMAILJS_UPDATE_TEMPLATE || 'template_update';

const dataDe = (b) => b?.startDate || b?.date || '';

// ── seleção (função pura: é o que o teste exercita) ───────────────────
//
// Agrupa os agendamentos por e-mail, acha a última visita de cada um e devolve
// quem passou de `diasInativo`, do mais frio para o mais recente — quem está
// quase virando perdido vem primeiro, já que o teto por execução corta a cauda.
function selecionarInativos({ bookings, svcMap, agora, diasInativo = DIAS_INATIVO }) {
  const hoje = new Date(agora || Date.now());
  const porEmail = new Map();

  for (const b of Object.values(bookings || {})) {
    const email = optout.normaliza(b?.email);
    if (!email || !email.includes('@')) continue;
    if (!STATUS_ATIVO.has(b?.status)) continue;
    const data = dataDe(b);
    if (!data) continue;

    const atual = porEmail.get(email);
    if (!atual || data > atual.lastDate) {
      porEmail.set(email, {
        email,
        name: b.name || 'Cliente',
        car: b.car || '',
        lastService: b.service || (b.services || [])[0] || null,
        lastDate: String(data).slice(0, 10),
      });
    }
  }

  const inativos = [];
  for (const c of porEmail.values()) {
    const dias = Math.floor((hoje - new Date(`${c.lastDate}T12:00:00Z`)) / 86400000);
    if (!isFinite(dias) || dias < diasInativo) continue;
    inativos.push({
      ...c,
      dias,
      lastServiceName: (svcMap || {})[c.lastService]?.name || c.lastService || null,
    });
  }

  return inativos.sort((a, b) => b.dias - a.dias);
}

// ── corpo do e-mail (função pura) ─────────────────────────────────────
//
// O rodapé de descadastro é montado aqui, junto do corpo, e não no envio: é a
// única forma de garantir que nenhum caminho manda marketing sem a saída.
function montarEmail({ cliente, corpo, brand, segredo, siteUrl }) {
  const primeiro = String(cliente.name || 'Cliente').split(' ')[0];
  const mensagem = String(corpo || '').trim()
    + `\n\nAgende em ${String(siteUrl || '').replace(/\/$/, '')} ou responda este e-mail.`
    + `\n\n— Equipe ${brand}`
    + optout.rodapeDescadastro(cliente.email, segredo, siteUrl);

  return {
    to_email: cliente.email,
    to_name: cliente.name || 'Cliente',
    titulo: `${primeiro}, que tal cuidar do seu carro de novo? — ${brand}`,
    mensagem,
  };
}

// ── agente ────────────────────────────────────────────────────────────

async function textoDoCliente({ cliente, coupon, brand, core, maxTokens }) {
  const ctx = [
    `Cliente: ${cliente.name}`,
    cliente.car ? `Veículo: ${cliente.car}` : '',
    cliente.lastServiceName ? `Último serviço: ${cliente.lastServiceName}` : '',
    cliente.dias ? `Dias sem visita: ${cliente.dias}` : '',
    cliente.vip ? 'Status: VIP' : '',
    cliente.points ? `Pontos acumulados: ${cliente.points}` : '',
    coupon ? `Cupom a oferecer: ${coupon}` : '',
  ].filter(Boolean).join('\n');

  const result = await core.claude.complete({
    system: `Você é o assistente de relacionamento da ${brand}, estúdio de estética automotiva em São Paulo. Escreva em português. Tom cordial e direto. Máximo 5 linhas.`,
    messages: [{
      role: 'user',
      content: `Escreva o corpo de um e-mail de reativação para este cliente. Mencione o veículo e o último serviço. Sugira o próximo serviço mais lógico (ex: polimento se foi lavagem, higienização se faz tempo). ${coupon ? 'Mencione o cupom.' : ''} Sem assunto, sem saudação formal, sem assinatura — apenas o corpo.\n\n${ctx}`,
    }],
    maxTokens: maxTokens || 400,
  });

  return result.text;
}

module.exports = {
  id: 'reativacao',
  trigger: 'both',

  // expostos para teste
  selecionarInativos,
  montarEmail,
  MAX_AUTO,
  DIAS_INATIVO,
  INTERVALO_DIAS,

  async run(payload, core) {
    const { clients, coupon } = payload || {};
    const manual = Array.isArray(clients) && clients.length > 0;

    const [servicesData, config] = await Promise.all([
      core.firebase.dbGet('/services').catch(() => ({})),
      core.firebase.dbGet('/config').catch(() => ({})),
    ]);
    const svcMap = servicesData || {};
    const brand = config?.businessName || 'SP Car Clean';

    const descadastrados = await optout.carregarDescadastrados(core.firebase.dbGet);

    if (manual) return rodarManual({ clients, coupon, svcMap, brand, descadastrados, core });
    return rodarAutomatico({ coupon, svcMap, brand, descadastrados, core });
  },
};

// Modo manual: só gera texto. O descadastro é respeitado aqui também — a dona
// revisa e dispara, e a lista não pode conter quem pediu para sair.
async function rodarManual({ clients, coupon, svcMap, brand, descadastrados, core }) {
  const elegiveis = [];
  let pulados = 0;
  for (const c of clients) {
    const email = optout.normaliza(c?.email);
    if (!email || descadastrados.has(email)) { pulados++; continue; }
    elegiveis.push({
      ...c,
      email,
      lastServiceName: svcMap[c.lastService]?.name || c.lastService || null,
      dias: c.lastDate ? Math.floor((Date.now() - new Date(c.lastDate).getTime()) / 86400000) : null,
    });
  }

  const drafts = [];
  for (const cliente of elegiveis.slice(0, MAX_CLIENTS)) {
    const text = await textoDoCliente({ cliente, coupon, brand, core });
    drafts.push({ email: cliente.email, name: cliente.name, text });
  }

  return {
    ok: true,
    summary: `${drafts.length} texto(s) gerado(s) para revisão`
      + (pulados ? ` · ${pulados} fora da lista (descadastrados)` : ''),
    drafts,
    pulados,
  };
}

// Modo automático: escolhe, escreve, envia e registra.
async function rodarAutomatico({ coupon, svcMap, brand, descadastrados, core }) {
  const segredo = process.env.FIREBASE_DATABASE_SECRET;
  const siteUrl = (process.env.URL || 'https://www.spcarclean.com.br').replace(/\/$/, '');

  // Sem segredo não existe link de descadastro válido, e marketing sem saída é
  // exatamente o que esta mudança veio impedir. Então não envia — e diz por quê.
  if (!segredo) {
    return { ok: false, summary: 'envio automático abortado: FIREBASE_DATABASE_SECRET ausente (sem ele não há link de descadastro)', enviados: 0 };
  }
  if (!process.env.EMAILJS_SERVICE_ID || !process.env.EMAILJS_PUBLIC_KEY) {
    return { ok: false, summary: 'envio automático abortado: EmailJS não configurado', enviados: 0 };
  }

  const bookings = await core.firebase.dbGet('/bookings').catch(() => ({}));
  const envios = await optout.carregarEnvios(core.firebase.dbGet);
  const agora = new Date().toISOString();

  const inativos = selecionarInativos({ bookings, svcMap, agora });
  const fila = inativos
    .filter((c) => optout.podeReceber(c.email, { descadastrados, envios, intervaloDias: INTERVALO_DIAS, agora }))
    .slice(0, MAX_AUTO);

  const enviados = [];
  const erros = [];

  for (const cliente of fila) {
    try {
      const corpo = await textoDoCliente({ cliente, coupon, brand, core });
      const params = montarEmail({ cliente, corpo, brand, segredo, siteUrl });
      await core.email.sendEmail({ templateId: TEMPLATE(), params });
      await optout.registrarEnvio({ email: cliente.email, assunto: params.titulo, dbSet: core.firebase.dbSet });
      enviados.push({ email: cliente.email, dias: cliente.dias });
    } catch (err) {
      // Um e-mail que falha não pode derrubar o lote: o próximo cliente ainda
      // merece o seu. E o que falhou NÃO é registrado como enviado, então entra
      // na fila da semana seguinte.
      erros.push({ email: cliente.email, error: err.message });
      console.error(`reativacao: falha ao enviar para ${cliente.email}: ${err.message}`);
    }
  }

  const resumo = `${enviados.length} e-mail(s) de reativação enviado(s)`
    + ` · ${inativos.length} inativo(s) há ${DIAS_INATIVO}+ dias`
    + (erros.length ? ` · ${erros.length} falha(s)` : '');

  // A dona precisa saber o que saiu em nome dela sem ter que abrir log.
  if (core.telegram?.sendTelegram) {
    const linhas = enviados.map((e) => `• ${e.email.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')} (${e.dias}d)`).join('\n');
    await core.telegram.sendTelegram(
      `📨 *Reativação automática*\n${enviados.length} e\\-mail\\(s\\) enviado\\(s\\)\\.`
      + (linhas ? `\n${linhas}` : '')
      + (erros.length ? `\n⚠️ ${erros.length} falha\\(s\\)` : '')
    ).catch(() => {});
  }

  return { ok: true, summary: resumo, enviados: enviados.length, candidatos: inativos.length, erros };
}
