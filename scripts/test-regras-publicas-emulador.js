'use strict';

// Os casos do scripts/regras-emulador.js rodados contra o PORTE em JS
// (functions/lib/core/regras-publicas.js), sem emulador e sem Java.
//
// Rodar: node scripts/test-regras-publicas-emulador.js
//
// POR QUE EXISTE: aquele arquivo tem ~90 casos de uso e de ataque escritos
// para as regras do Realtime Database — por outra pessoa, de forma
// independente. Essas regras não são mais aplicadas por ninguém (o banco é o
// DynamoDB), e quem faz o papel delas agora é o porte em JS. Rodar os mesmos
// casos contra o porte é o cruzamento mais forte disponível: se o porte estiver
// mais frouxo que a regra que substituiu, aparece aqui.
//
// Como funciona: `regras-emulador.js` fala com o emulador por `fetch`. Aqui o
// `fetch` é substituído por um banco em memória que autoriza pelo porte. Os
// casos não são copiados — o arquivo deles é carregado como está, para não
// existirem duas listas que podem divergir.

const path = require('path');
const regras = require('../functions/lib/core/regras-publicas.js');

// ── banco em memória, com a semântica do Realtime Database ────────────
let BANCO = {};

const segs = (caminho) => String(caminho).split('/').filter(Boolean);

function ler(caminho) {
  let v = BANCO;
  for (const s of segs(caminho)) {
    if (v === null || typeof v !== 'object') return null;
    v = v[s];
  }
  return v === undefined ? null : v;
}

function gravar(caminho, valor) {
  const partes = segs(caminho);
  if (!partes.length) { BANCO = valor === null ? {} : valor; return; }
  let no = BANCO;
  for (const s of partes.slice(0, -1)) {
    if (!no[s] || typeof no[s] !== 'object') no[s] = {};
    no = no[s];
  }
  const ultimo = partes[partes.length - 1];
  if (valor === null) delete no[ultimo];
  else no[ultimo] = valor;
}

function mesclar(caminho, valor) {
  const atual = ler(caminho);
  gravar(caminho, { ...(atual && typeof atual === 'object' ? atual : {}), ...valor });
}

// ── o transporte: autoriza pelo porte e responde como o emulador ──────
//
// 200 = permitido, 403 = negado. É o que `permite`/`nega` conferem.
process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'emulador.invalido:9000';

function consultaDaUrl(u) {
  const q = u.includes('?') ? u.slice(u.indexOf('?') + 1) : '';
  const p = new URLSearchParams(q);
  const campo = p.get('orderBy');
  const igual = p.get('equalTo');
  if (campo === null) return undefined;
  const tira = (x) => (typeof x === 'string' ? x.replace(/^"|"$/g, '') : x);
  return { ordem: tira(campo), igual: igual === null ? undefined : tira(igual) };
}

function filtrar(valor, c) {
  if (!c || !valor || typeof valor !== 'object') return valor;
  const fora = {};
  for (const [k, item] of Object.entries(valor)) {
    if (item && typeof item === 'object' && item[c.ordem] === c.igual) fora[k] = item;
  }
  return Object.keys(fora).length ? fora : null;
}

const ok = (dados) => ({ status: 200, json: async () => dados });
const negado = () => ({ status: 403, json: async () => ({ error: 'Permission denied' }) });

global.fetch = async (u, opt = {}) => {
  const metodo = (opt.method || 'GET').toUpperCase();
  const ehAdmin = String((opt.headers || {}).Authorization || '').includes('owner');
  const caminho = decodeURIComponent(
    u.replace(/^https?:\/\/[^/]*\//, '').replace(/\.json.*$/, '')
  );
  const partes = segs(caminho);
  const corpo = opt.body === undefined ? undefined : JSON.parse(opt.body);
  const consulta = consultaDaUrl(u);

  // Admin fala com o banco direto, como a Lambda faz com o segredo: é o papel
  // dela nos casos (aprovar, moderar, ativar gift card).
  if (ehAdmin) {
    if (metodo === 'GET') return ok(filtrar(ler(caminho), consulta));
    if (metodo === 'PUT') { gravar(caminho, corpo); return ok(corpo); }
    if (metodo === 'PATCH') { mesclar(caminho, corpo); return ok(corpo); }
    if (metodo === 'DELETE') { gravar(caminho, null); return ok(null); }
    return negado();
  }

  if (metodo === 'GET') {
    if (!regras.podeLer(partes, consulta)) return negado();
    return ok(filtrar(ler(caminho), consulta));
  }
  if (metodo === 'DELETE') {
    return regras.podeApagar() ? ok(null) : negado();
  }
  if (metodo === 'PUT' || metodo === 'PATCH') {
    const atual = ler(caminho);
    const resultante = metodo === 'PATCH'
      ? { ...(atual && typeof atual === 'object' ? atual : {}), ...corpo }
      : corpo;
    if (!regras.podeGravar(partes, resultante, atual)) return negado();
    if (metodo === 'PUT') gravar(caminho, corpo); else mesclar(caminho, corpo);
    return ok(corpo);
  }
  return negado();
};

console.log('rodando os casos de scripts/regras-emulador.js contra o porte em JS:');
require(path.resolve(__dirname, 'regras-emulador.js'));
