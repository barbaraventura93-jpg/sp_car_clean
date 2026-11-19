'use strict';

// O mesmo acesso a dados do `store.js`, com a assinatura de verbo HTTP que as
// funções escreveram quando o banco era o Firebase:
//
//   firebase('GET', 'bookings/SPC-1')         → dbGet
//   firebase('PUT', 'bookings/SPC-1', dados)  → dbSet
//   firebase('PATCH', 'bookings/SPC-1', {…})  → dbPatch
//   firebase('POST', 'feedback', dados)       → dbPush
//   firebase('DELETE', 'bookings/SPC-1')      → dbDelete
//
// POR QUE EXISTE: 13 Lambdas tinham cada uma a sua cópia de um ajudante
// `firebase(metodo, caminho, corpo)` que montava a URL do Realtime Database.
// São ~60 pontos de chamada. Convertê-los um por um seria 60 oportunidades de
// errar; trocando só o ajudante, cada arquivo muda em um lugar e os pontos de
// chamada ficam idênticos — o que também deixa o diff revisável.
//
// As respostas imitam as do Firebase: GET devolve o valor, PUT e PATCH
// devolvem o que foi escrito, POST devolve `{ name: <id> }`. Isso importa
// porque algum chamador usa o retorno, e devolver `undefined` onde antes vinha
// um objeto é o tipo de diferença que só aparece em produção.

const store = require('./store');

const VERBOS = {
  GET: async (caminho) => store.dbGet(caminho),
  PUT: async (caminho, corpo) => { await store.dbSet(caminho, corpo); return corpo; },
  PATCH: async (caminho, corpo) => { await store.dbPatch(caminho, corpo); return corpo; },
  POST: async (caminho, corpo) => store.dbPush(caminho, corpo),
  DELETE: async (caminho) => { await store.dbDelete(caminho); return null; },
};

/**
 * @param {string} metodo GET | PUT | PATCH | POST | DELETE
 * @param {string} caminho caminho no formato antigo, ex.: `bookings/SPC-1`
 * @param {*} [corpo]
 */
async function firebase(metodo, caminho, corpo) {
  const verbo = VERBOS[String(metodo || '').toUpperCase()];
  if (!verbo) throw new Error(`método não suportado: ${metodo}`);
  // Os chamadores antigos passam `encodeURIComponent(...)` nos segmentos,
  // porque o caminho ia para uma URL. Aqui não vai, e deixar escapado faria a
  // chave ficar diferente da gravada. Decodificar é seguro: os valores são
  // uid, código de agendamento e data — nenhum contém `%` de verdade.
  const limpo = String(caminho)
    .split('/')
    .map((s) => { try { return decodeURIComponent(s); } catch { return s; } })
    .join('/');
  return verbo(limpo, corpo);
}

module.exports = { firebase };
