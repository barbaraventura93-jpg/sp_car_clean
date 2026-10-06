/**
 * SP Car Clean — agendamentos na agenda do Google do admin.
 *
 * Google Apps Script (grátis, roda na conta do admin, sem Google Cloud nem cartão).
 * A cada 5 minutos lê o feed do site e cria, atualiza ou apaga os eventos na
 * agenda principal de quem instalou o script.
 *
 * Instalação (uma vez, entrando com spcarclean0@gmail.com):
 *  1. https://script.google.com → Novo projeto → apague o conteúdo e cole este arquivo.
 *  2. Troque COLE_AQUI_O_LINK pelo link do painel (Configurações → 📅 Google Agenda →
 *     "Copiar link do script").
 *  3. Escolha a função "instalar" no menu de cima e clique em Executar. Autorize
 *     (Avançado → Acessar SP Car Clean, se o Google avisar que o app não é verificado).
 * Pronto: a sincronização roda sozinha a cada 5 minutos. Para forçar, execute "sincronizar".
 */

const FEED_URL = 'COLE_AQUI_O_LINK';
const PREFIXO = 'ev_'; // propriedades do script: ev_<código> → { eventId, hash }

function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // outra execução ainda rodando

  try {
    const resp = UrlFetchApp.fetch(FEED_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      throw new Error('Feed respondeu ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
    }
    const feed = JSON.parse(resp.getContentText());
    const agenda = CalendarApp.getDefaultCalendar();
    const props = PropertiesService.getScriptProperties();
    const salvos = props.getProperties();
    const existentes = new Set(feed.ids);
    let criados = 0, alterados = 0, apagados = 0;

    for (const ev of feed.events) {
      const chave = PREFIXO + ev.id;
      const antes = salvos[chave] ? JSON.parse(salvos[chave]) : null;
      if (antes && antes.hash === ev.hash) continue;

      const inicio = new Date(ev.start);
      const fim = new Date(ev.end);
      let evento = antes ? agenda.getEventById(antes.eventId) : null;
      if (evento) {
        evento.setTitle(ev.title);
        evento.setTime(inicio, fim);
        evento.setLocation(ev.location);
        evento.setDescription(ev.description);
        alterados++;
      } else {
        evento = agenda.createEvent(ev.title, inicio, fim, { location: ev.location, description: ev.description });
        criados++;
      }
      props.setProperty(chave, JSON.stringify({ eventId: evento.getId(), hash: ev.hash }));
    }

    // Cancelados, rejeitados ou excluídos no site saem da agenda.
    for (const chave of Object.keys(salvos)) {
      if (chave.indexOf(PREFIXO) !== 0 || existentes.has(chave.slice(PREFIXO.length))) continue;
      const evento = agenda.getEventById(JSON.parse(salvos[chave]).eventId);
      if (evento) evento.deleteEvent();
      props.deleteProperty(chave);
      apagados++;
    }

    console.log('Agenda: ' + criados + ' criado(s), ' + alterados + ' alterado(s), ' + apagados + ' apagado(s)');
  } finally {
    lock.releaseLock();
  }
}

// Liga a sincronização automática a cada 5 minutos e já roda a primeira vez.
function instalar() {
  if (FEED_URL.indexOf('https://') !== 0) throw new Error('Cole o link do painel em FEED_URL antes de instalar.');
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  sincronizar();
}
