'use strict';

// =====================================================================
// DB — acesso a dados com a MESMA interface do Firebase Realtime Database.
//
// Por que existe: as regras do RTDB autorizam escrita administrativa por
// `auth.token.email == spcarclean0@gmail.com`. Com o login migrado para o
// Cognito, o Firebase vê o navegador como anônimo e recusa toda escrita do
// painel. Ver docs/migracao-aws.md.
//
// A solução é rotear pelo servidor: `/api/admin-data` valida o token do
// Cognito (grupo `admin`) e fala com o Firebase usando o segredo do banco. O
// navegador nunca recebe o segredo.
//
// Em vez de reescrever os 187 pontos de acesso a dados do app.js, isto emula a
// interface da ref do Firebase e é injetado no único lugar onde as refs são
// criadas. Foi a mesma estratégia do AUTH, e por isso o diff no app.js é de
// uma linha por ref, não de 187 chamadas.
//
// A superfície emulada foi MEDIDA no app.js, não adivinhada:
//   ref:   child, once, on, off, set, update, remove, push, key
//   query: orderByChild, orderByKey, equalTo, limitToLast, limitToFirst
//   snap:  val, exists
//
// `once` aceita as DUAS formas do Firebase — promessa e callback. São 20 os
// pontos do app que passam callback; sem isso eles nunca disparariam, e o
// sintoma seria tela vazia sem nenhum erro no console.
//
// REGRA DE ROTEAMENTO
//
//   leitura  → Firebase direto quando o nó é de leitura pública, ou quem lê
//              não é admin (preserva o tempo real e a latência baixa do site).
//              Pela Lambda quando é nó restrito e quem lê é admin.
//   escrita  → pela Lambda quando há admin logado; Firebase direto caso
//              contrário.
//
// O "caso contrário" na escrita é deliberado e necessário: visitante criando
// agendamento, entrando na lista de espera ou comprando gift card escreve
// anonimamente, e as regras do RTDB permitem isso. Mandar essas escritas para
// a Lambda as faria falhar por falta de token.
//
// CONSULTAS: no caminho direto a cadeia é repassada ao Firebase, que filtra no
// servidor. No caminho da Lambda o nó vem inteiro e o filtro é aplicado aqui.
// O resultado é o mesmo; o que muda é quem filtra. Importa porque
// `feedback.orderByChild('status').equalTo('approved')` é o que impede
// avaliação pendente de aparecer no site — ignorar o filtro publicaria todas.
//
// LIMITE CONHECIDO: `on('value')` em nó restrito não é tempo real — a Lambda
// não tem como empurrar evento. Faz uma leitura imediata e depois repete a
// cada 45 s. Para um painel usado por uma pessoa isso é suficiente, e vale a
// troca por ter o painel de volta.
// =====================================================================

const DB = (function () {
  // Nós que as regras do RTDB liberavam para leitura anônima. Não regem mais o
  // roteamento (ver `usarLambdaParaLer`); ficam registrados porque é a lista
  // que o endpoint público da Fase 3 vai ter que servir sem token.
  const LEITURA_PUBLICA = new Set([
    'services', 'combos', 'config', 'portfolio', 'gallery',
    'dayLoad', 'blocked', 'coupons', 'feedback',
  ]);

  const INTERVALO_POLL_MS = 45_000;

  let _ehAdmin = () => false;
  let _pegarToken = async () => null;
  const _timers = new Map(); // assinatura -> id do setInterval

  function configurar({ ehAdmin, pegarToken }) {
    if (typeof ehAdmin === 'function') _ehAdmin = ehAdmin;
    if (typeof pegarToken === 'function') _pegarToken = pegarToken;
  }

  function raizDe(caminho) {
    return String(caminho).split('/')[0];
  }

  // TODO acesso a dados vai pela API, para admin e para visitante.
  //
  // Até 10/11/2026 havia duas rotas: nó público ia direto ao Firebase (de
  // graça e em tempo real) e nó restrito ia pela Lambda. Com o Firebase
  // excluído, o caminho direto não existe mais — e era ele que fazia a aba
  // Serviços do painel falhar enquanto o resto respondia.
  //
  // Quem autoriza o visitante agora é o servidor
  // (`functions/lib/core/regras-publicas.js`), porque no DynamoDB não existe
  // "regra do banco": eram as regras do Realtime Database que cumpriam esse
  // papel. O navegador não decide mais nada sobre permissão — ele pede, e a
  // API concede ou recusa.
  function usarLambdaParaLer() {
    return true;
  }

  function usarLambdaParaEscrever() {
    return true;
  }

  // `consulta` vai no corpo porque, para quem não é admin, é o SERVIDOR que
  // filtra: `feedback` só abre com o filtro de aprovadas, e filtrar no
  // navegador deixaria a avaliação pendente chegar aqui — chegar já é vazar.
  //
  // Sem token a requisição vai anônima, de propósito: é assim que o visitante
  // lê o catálogo e cria o próprio agendamento. Antes disto, a falta de token
  // era erro ("Sessão expirada"), porque só o admin usava este caminho.
  async function chamarLambda(op, caminho, dados, consulta) {
    let token = null;
    try { token = await _pegarToken(); } catch { token = null; }
    const pedido = { op, caminho };
    if (dados !== undefined) pedido.dados = dados;
    if (consulta) pedido.consulta = consulta;
    const resp = await fetch('/api/admin-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(pedido),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok || corpo.ok === false) {
      throw new Error(corpo.error || `Falha ao acessar os dados (HTTP ${resp.status})`);
    }
    return corpo.dados;
  }

  // Snapshot com a superfície que o app realmente usa: val() e exists().
  function snapshot(valor) {
    return {
      val: () => (valor === undefined ? null : valor),
      exists: () => valor !== null && valor !== undefined,
    };
  }

  // ---------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------
  // Aplica a consulta sobre o valor cru do nó (caminho da Lambda). Devolve o
  // mesmo que o Firebase devolveria: objeto com os filhos que passaram, ou
  // null quando nenhum passa.
  function aplicarConsulta(valor, q) {
    if (!q || !q.ordem) return valor;
    if (valor === null || valor === undefined || typeof valor !== 'object') return valor;

    let itens = Object.keys(valor).map((k) => [k, valor[k]]);

    const chaveDeOrdem = ([k, v]) => {
      if (q.ordem.tipo === 'key') return k;
      if (q.ordem.tipo === 'value') return v;
      return v && typeof v === 'object' ? v[q.ordem.campo] : undefined;
    };

    if ('igual' in q) {
      itens = itens.filter((par) => chaveDeOrdem(par) === q.igual);
    }

    // Ordena como o Firebase: nulos primeiro, depois números, depois strings.
    const peso = (x) => (x === undefined || x === null ? 0 : typeof x === 'number' ? 1 : 2);
    itens.sort((a, b) => {
      const ka = chaveDeOrdem(a);
      const kb = chaveDeOrdem(b);
      if (peso(ka) !== peso(kb)) return peso(ka) - peso(kb);
      if (ka === kb) return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      return ka < kb ? -1 : 1;
    });

    if (typeof q.limiteFim === 'number') itens = itens.slice(-q.limiteFim);
    if (typeof q.limiteInicio === 'number') itens = itens.slice(0, q.limiteInicio);

    if (!itens.length) return null;
    const saida = {};
    for (const [k, v] of itens) saida[k] = v;
    return saida;
  }

  // A API aceita só `{ ordem: <campo>, igual: <valor> }` — o filtro de
  // igualdade por campo, que é o que o servidor precisa para decidir a
  // permissão. Ordenação e limite continuam sendo aplicados aqui, sobre o
  // resultado, porque não mudam o que pode ser lido.
  function consultaParaApi(q) {
    if (!q || !q.ordem || q.ordem.tipo !== 'child' || !('igual' in q)) return null;
    return { ordem: q.ordem.campo, igual: q.igual };
  }

  // Chave no formato do push do Firebase: 20 caracteres, ordenáveis por tempo.
  // Mantém a ordenação cronológica de quem já está gravado no banco.
  const ALFABETO = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let _ultimoTs = 0;
  let _aleatorios = [];
  function novaChavePush() {
    let agora = Date.now();
    const repetido = agora === _ultimoTs;
    _ultimoTs = agora;
    const tempo = new Array(8);
    for (let i = 7; i >= 0; i--) {
      tempo[i] = ALFABETO.charAt(agora % 64);
      agora = Math.floor(agora / 64);
    }
    let chave = tempo.join('');
    if (!repetido) {
      for (let i = 0; i < 12; i++) _aleatorios[i] = Math.floor(Math.random() * 64);
    } else {
      // Mesmo milissegundo: incrementa o sufixo para não colidir.
      let i = 11;
      for (; i >= 0 && _aleatorios[i] === 63; i--) _aleatorios[i] = 0;
      if (i >= 0) _aleatorios[i]++;
    }
    for (let i = 0; i < 12; i++) chave += ALFABETO.charAt(_aleatorios[i]);
    return chave;
  }


  function criarRef(caminho, consulta) {
    const q = consulta || null;
    const comConsulta = (extra) => criarRef(caminho, { ...(q || {}), ...extra });

    const api = {
      get key() {
        const p = String(caminho).split('/');
        return p[p.length - 1];
      },

      child(sub) {
        return criarRef(`${caminho}/${String(sub)}`);
      },

      // Cadeia de consulta. Guarda a intenção; quem executa é `once`/`on`,
      // repassando ao Firebase (direto) ou filtrando aqui (Lambda).
      orderByChild(campo) { return comConsulta({ ordem: { tipo: 'child', campo: String(campo) } }); },
      orderByKey() { return comConsulta({ ordem: { tipo: 'key' } }); },
      orderByValue() { return comConsulta({ ordem: { tipo: 'value' } }); },
      equalTo(valor) { return comConsulta({ igual: valor }); },
      limitToLast(n) { return comConsulta({ limiteFim: Number(n) }); },
      limitToFirst(n) { return comConsulta({ limiteInicio: Number(n) }); },

      // Aceita as duas formas do Firebase: `await once('value')` e
      // `once('value', cb, erroCb)`. Os 20 pontos do app que usam callback
      // dependem da segunda.
      once(evento, cb, erroCb) {
        if (evento !== 'value') return Promise.reject(new Error(`evento não suportado: ${evento}`));
        const p = chamarLambda('ler', caminho, undefined, consultaParaApi(q))
          .then((v) => snapshot(aplicarConsulta(v, q)));
        if (typeof cb !== 'function') return p;
        // Com callback de erro, ele recebe a falha e a promessa não fica
        // rejeitada sem dono. SEM callback de erro a promessa REJEITA, como no
        // Firebase — e isso importa: `openClientAccount()` trata a negação no
        // `.catch()` da própria chamada. A primeira versão disto engolia o erro
        // "para evitar unhandledrejection", e o efeito foi a tela de "Minha
        // Conta" nunca abrir para o cliente, sem nada no console.
        if (typeof erroCb === 'function') {
          return p.then(
            (snap) => { cb(snap); return snap; },
            (e) => { erroCb(e); return undefined; }
          );
        }
        return p.then((snap) => { cb(snap); return snap; });
      },

      on(evento, cb, erroCb) {
        if (evento !== 'value') throw new Error(`evento não suportado: ${evento}`);
        // A API não empurra evento como o Firebase fazia: lê agora e repete.
        // Para um painel usado por uma pessoa, e para um site que mostra
        // catálogo, isso basta — e é a troca que trouxe o painel de volta.
        const buscar = () => {
          chamarLambda('ler', caminho, undefined, consultaParaApi(q))
            .then((v) => cb(snapshot(aplicarConsulta(v, q))))
            .catch((e) => { if (erroCb) erroCb(e); else console.warn('DB.on', caminho, e.message); });
        };
        buscar();
        const assinatura = caminho + '|' + JSON.stringify(q);
        const anterior = _timers.get(assinatura);
        if (anterior) clearInterval(anterior);
        _timers.set(assinatura, setInterval(buscar, INTERVALO_POLL_MS));
        return cb;
      },

      // Como no Firebase, `ref.off('value')` derruba todos os listeners do
      // caminho — inclusive os registrados sobre uma consulta dele.
      off(evento) {
        for (const assinatura of Array.from(_timers.keys())) {
          if (assinatura === caminho || assinatura.startsWith(caminho + '|')) {
            clearInterval(_timers.get(assinatura));
            _timers.delete(assinatura);
          }
        }
      },

      async set(valor) {
        // `set(null)` no Firebase apagava o nó; na API isso é 'apagar'.
        if (valor === null) return chamarLambda('apagar', caminho);
        return chamarLambda('gravar', caminho, valor);
      },

      async update(valor) {
        return chamarLambda('mesclar', caminho, valor);
      },

      async remove() {
        return chamarLambda('apagar', caminho);
      },

      // Igual ao Firebase: devolve a ref do filho novo de imediato (com `key`
      // disponível) e grava em segundo plano quando recebe valor.
      push(valor) {
        const filho = criarRef(`${caminho}/${novaChavePush()}`);
        if (valor !== undefined) {
          const p = filho.set(valor);
          filho.then = p.then.bind(p);
          filho.catch = p.catch.bind(p);
        }
        return filho;
      },
    };
    return api;
  }

  return {
    ref: (caminho) => criarRef(caminho),
    configurar,
    // Pagamento recebido direto (dinheiro/Pix), só admin: o servidor registra
    // e credita os pontos. Operação própria do /api/admin-data.
    confirmarRecebimento: (id, metodo, valor) =>
      chamarLambda('confirmar-recebimento', `bookings/${id}`, valor ? { metodo, valor } : { metodo }),
    _interno: {
      LEITURA_PUBLICA, novaChavePush, usarLambdaParaLer, usarLambdaParaEscrever,
      aplicarConsulta, INTERVALO_POLL_MS,
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { DB };
