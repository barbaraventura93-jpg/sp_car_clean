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
  // Nós com `.read: true` nas regras do RTDB: o navegador lê sem autenticação.
  const LEITURA_PUBLICA = new Set([
    'services', 'combos', 'config', 'portfolio', 'gallery',
    'dayLoad', 'blocked', 'coupons', 'feedback',
  ]);

  const INTERVALO_POLL_MS = 45_000;

  let _fb = null;            // firebase.database()
  let _ehAdmin = () => false;
  let _pegarToken = async () => null;
  const _timers = new Map(); // assinatura -> id do setInterval

  function configurar({ firebaseDb, ehAdmin, pegarToken }) {
    _fb = firebaseDb || null;
    if (typeof ehAdmin === 'function') _ehAdmin = ehAdmin;
    if (typeof pegarToken === 'function') _pegarToken = pegarToken;
  }

  function raizDe(caminho) {
    return String(caminho).split('/')[0];
  }

  function usarLambdaParaLer(caminho) {
    if (!_ehAdmin()) return false;
    return !LEITURA_PUBLICA.has(raizDe(caminho));
  }

  function usarLambdaParaEscrever() {
    return _ehAdmin();
  }

  async function chamarLambda(op, caminho, dados) {
    const token = await _pegarToken();
    if (!token) throw new Error('Sessão expirada. Entre novamente.');
    const resp = await fetch('/api/admin-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(dados === undefined ? { op, caminho } : { op, caminho, dados }),
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

  // Repassa a consulta ao Firebase (caminho direto), que filtra no servidor.
  function consultaFirebase(caminho, q) {
    if (!_fb) throw new Error('Banco não conectado.');
    let r = _fb.ref(caminho);
    if (q && q.ordem) {
      if (q.ordem.tipo === 'key') r = r.orderByKey();
      else if (q.ordem.tipo === 'value') r = r.orderByValue();
      else r = r.orderByChild(q.ordem.campo);
      if ('igual' in q) r = r.equalTo(q.igual);
      if (typeof q.limiteFim === 'number') r = r.limitToLast(q.limiteFim);
      if (typeof q.limiteInicio === 'number') r = r.limitToFirst(q.limiteInicio);
    }
    return r;
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

  function refFirebase(caminho) {
    if (!_fb) throw new Error('Banco não conectado.');
    return _fb.ref(caminho);
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
        const p = usarLambdaParaLer(caminho)
          ? chamarLambda('ler', caminho).then((v) => snapshot(aplicarConsulta(v, q)))
          : Promise.resolve(consultaFirebase(caminho, q).once('value'));
        if (typeof cb !== 'function') return p;
        // Com callback, o erro vai para erroCb (ou ao console) e a promessa
        // não fica rejeitada sem dono — que viraria unhandledrejection.
        return p.then(
          (snap) => { cb(snap); return snap; },
          (e) => {
            if (typeof erroCb === 'function') erroCb(e);
            else console.warn('DB.once', caminho, e.message);
            return undefined;
          }
        );
      },

      on(evento, cb, erroCb) {
        if (evento !== 'value') throw new Error(`evento não suportado: ${evento}`);
        if (!usarLambdaParaLer(caminho)) {
          return consultaFirebase(caminho, q).on('value', cb, erroCb);
        }
        // Nó restrito: a Lambda não empurra evento. Lê agora e repete.
        const buscar = () => {
          chamarLambda('ler', caminho)
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
        if (_fb) { try { refFirebase(caminho).off(evento || 'value'); } catch {} }
      },

      async set(valor) {
        if (usarLambdaParaEscrever()) {
          // `set(null)` no Firebase apaga o nó; na Lambda isso é 'apagar'.
          if (valor === null) return chamarLambda('apagar', caminho);
          return chamarLambda('gravar', caminho, valor);
        }
        return refFirebase(caminho).set(valor);
      },

      async update(valor) {
        if (usarLambdaParaEscrever()) return chamarLambda('mesclar', caminho, valor);
        return refFirebase(caminho).update(valor);
      },

      async remove() {
        if (usarLambdaParaEscrever()) return chamarLambda('apagar', caminho);
        return refFirebase(caminho).remove();
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
    _interno: {
      LEITURA_PUBLICA, novaChavePush, usarLambdaParaLer, usarLambdaParaEscrever,
      aplicarConsulta, INTERVALO_POLL_MS,
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { DB };
