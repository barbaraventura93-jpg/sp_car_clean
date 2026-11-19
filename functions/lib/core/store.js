'use strict';

// Acesso a dados no DynamoDB com a MESMA interface do antigo
// `lib/core/firebase.js` (dbGet/dbSet/dbPatch/dbPush/dbDelete).
//
// Por que a interface é idêntica: 18 Lambdas chamam essas cinco funções. Se a
// assinatura mudasse, a migração seria reescrever 18 arquivos de uma vez, sem
// como testar um por um. Assim a troca é uma linha de `require` por arquivo, e
// o comportamento de cada função fica testado aqui.
//
// O mapeamento de caminho → chave está em `chaves.js`, compartilhado com o
// importador — ver o comentário de lá sobre por que não pode haver duas cópias.
//
// Sem dependência de terceiros: usa o `@aws-sdk/client-dynamodb` que já vem no
// runtime do Lambda e faz a conversão de tipos aqui mesmo. `lib-dynamodb` e
// `util-dynamodb` resolveriam isso, mas acrescentar pacote ao zip é mudança no
// workflow de deploy — e o repositório não tem dependência de terceiros.

const chaves = require('./chaves');

// O nome da tabela vem do ambiente; o padrão existe para a função não quebrar
// se o deploy do código chegar antes da variável (ordem que já aconteceu).
const TABELA = process.env.DATA_TABLE || 'sp-car-clean-data';

// `require` tardio do SDK, como em lib/webpush.js: fora do Lambda o pacote não
// está instalado, e carregá-lo no topo tornaria o módulo impossível de testar
// aqui. `_injetar` troca o transporte nos testes — é o que permite afirmar que
// cada função monta a chave e a expressão certas, sem falar com a AWS.
let _enviar = null;

async function enviar(op, params) {
  if (_enviar) return _enviar(op, params);
  const sdk = require('@aws-sdk/client-dynamodb');
  if (!_clienteReal) _clienteReal = new sdk.DynamoDBClient({});
  const Comando = sdk[`${op}Command`];
  if (!Comando) throw new Error(`operação desconhecida: ${op}`);
  return _clienteReal.send(new Comando(params));
}

let _clienteReal = null;

/** Só para teste: substitui o transporte por uma função (op, params) => resposta. */
function _injetar(fn) { _enviar = fn; }

// ── conversão JSON ↔ atributos do DynamoDB ────────────────────────────

function paraAttr(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'boolean') return { BOOL: v };
  if (typeof v === 'number') {
    if (!isFinite(v)) throw new Error('número não finito não pode ser gravado');
    return { N: String(v) };
  }
  if (typeof v === 'string') return { S: v };
  if (Array.isArray(v)) return { L: v.map(paraAttr) };
  if (typeof v === 'object') {
    const m = {};
    for (const [k, x] of Object.entries(v)) m[k] = paraAttr(x);
    return { M: m };
  }
  return { S: String(v) };
}

function deAttr(a) {
  if (!a || typeof a !== 'object') return null;
  if ('NULL' in a) return null;
  if ('BOOL' in a) return a.BOOL;
  if ('S' in a) return a.S;
  if ('N' in a) return Number(a.N);
  if ('L' in a) return a.L.map(deAttr);
  if ('M' in a) {
    const o = {};
    for (const [k, x] of Object.entries(a.M)) o[k] = deAttr(x);
    return o;
  }
  return null;
}

function itemParaAttrs(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = paraAttr(v);
  return out;
}

// ── id no estilo do Firebase ──────────────────────────────────────────
//
// O `push` do Firebase gera id de 20 caracteres que ORDENA por tempo. Os ids
// antigos (`-OxNjqy27uU8rQCsqYxV`) seguem esse formato, e o app ordena por
// chave em alguns lugares. Gerar UUID quebraria essa ordenação em silêncio.
const ALFABETO = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let _ultimoTs = 0;
let _aleatorio = [];

function novoId(agora = Date.now()) {
  let ts = agora;
  const repetido = ts === _ultimoTs;
  _ultimoTs = ts;

  const tempo = new Array(8);
  for (let i = 7; i >= 0; i--) {
    tempo[i] = ALFABETO.charAt(ts % 64);
    ts = Math.floor(ts / 64);
  }

  if (!repetido) {
    _aleatorio = [];
    for (let i = 0; i < 12; i++) _aleatorio[i] = Math.floor(Math.random() * 64);
  } else {
    // Mesmo milissegundo: incrementa o sufixo, para o id seguinte ser maior.
    let i = 11;
    for (; i >= 0 && _aleatorio[i] === 63; i--) _aleatorio[i] = 0;
    if (i >= 0) _aleatorio[i]++;
  }

  return tempo.join('') + _aleatorio.map((n) => ALFABETO.charAt(n)).join('');
}

// ── leitura ───────────────────────────────────────────────────────────

const dbPath = (no) => (String(no).startsWith('/') ? String(no) : '/' + no);

async function pegarItem(pk, sk) {
  const r = await enviar('GetItem', {
    TableName: TABELA,
    Key: { pk: { S: pk }, sk: { S: sk } },
  });
  return r.Item || null;
}

async function consultar(pk, prefixo) {
  const itens = [];
  let inicio;
  do {
    const r = await enviar('Query', {
      TableName: TABELA,
      KeyConditionExpression: prefixo ? 'pk = :pk AND begins_with(sk, :pre)' : 'pk = :pk',
      ExpressionAttributeValues: prefixo
        ? { ':pk': { S: pk }, ':pre': { S: prefixo } }
        : { ':pk': { S: pk } },
      ExclusiveStartKey: inicio,
    });
    itens.push(...(r.Items || []));
    inicio = r.LastEvaluatedKey;
  } while (inicio);
  return itens;
}

/** Anos com registro de disponibilidade (item-índice; ver chaves.js). */
async function anosDisponibilidade() {
  const it = await pegarItem(chaves.META_ANOS.pk, chaves.META_ANOS.sk);
  const anos = it ? deAttr(it.dados) : null;
  return Array.isArray(anos) ? anos.map(String) : [];
}

function remontar(no, itens) {
  const d = chaves.NOS[no];
  const fora = {};
  for (const it of itens) {
    // Em nó cuja chave do Firebase está na PARTIÇÃO (clientProfiles), é o `pk`
    // que dá a chave; nos outros, o `sk`.
    const k = d?.chaveDoItem ? d.chaveDoItem(it) : chaves.chaveDoSk(no, it.sk?.S || '');
    if (k === null || k === '') continue;
    fora[k] = deAttr(it.dados);
  }
  return Object.keys(fora).length ? fora : null;
}

/**
 * Varredura com filtro, para o nó cujos itens estão espalhados por partição.
 *
 * CUSTO: lê a tabela inteira (hoje ~12,4 mil itens, ~1,5 MB) para devolver
 * poucos registros. Com 2 clientes isso é fração de centavo e ~1 s, uma vez por
 * carga do painel. Quando a base de clientes crescer, a saída é um índice por
 * `no` — mudança de infraestrutura, não de código, e por isso fica anotada
 * aqui em vez de ser feita agora.
 */
async function varrer(no, sk) {
  const itens = [];
  let inicio;
  do {
    const r = await enviar('Scan', {
      TableName: TABELA,
      FilterExpression: sk ? '#no = :no AND sk = :sk' : '#no = :no',
      ExpressionAttributeNames: { '#no': 'no' },
      ExpressionAttributeValues: sk
        ? { ':no': { S: no }, ':sk': { S: sk } }
        : { ':no': { S: no } },
      ExclusiveStartKey: inicio,
    });
    itens.push(...(r.Items || []));
    inicio = r.LastEvaluatedKey;
  } while (inicio);
  return itens;
}

function pegarCampo(valor, campo) {
  if (!campo) return valor;
  let v = valor;
  for (const parte of String(campo).split('.')) {
    if (v === null || v === undefined || typeof v !== 'object') return null;
    v = v[parte];
  }
  return v === undefined ? null : v;
}

async function dbGet(no) {
  const k = chaves.chaveDe(no);

  if (k.tipo === 'item') {
    const it = await pegarItem(k.pk, k.sk);
    if (!it) return null;
    return pegarCampo(deAttr(it.dados), k.campo);
  }

  if (k.tipo === 'colecao') {
    return remontar(k.no, await consultar(k.pk, k.prefixo));
  }

  if (k.tipo === 'varredura') {
    return remontar(k.no, await varrer(k.no, k.sk));
  }

  // 'anos': o nó está espalhado por partição de ano.
  const anos = await anosDisponibilidade();
  const lotes = await Promise.all(anos.map((a) => consultar(`AVAIL#${a}`, k.prefixo)));
  return remontar(k.no, lotes.flat());
}

// ── escrita ───────────────────────────────────────────────────────────

/** Mantém o índice de anos: ano novo invisível na leitura da raiz é perda. */
async function registrarAno(no, chaveFilho) {
  if (!chaves.NOS[no]?.porAno) return;
  const ano = chaves.anoDe(chaveFilho);
  if (!/^\d{4}$/.test(ano)) return;
  const anos = await anosDisponibilidade();
  if (anos.includes(ano)) return;
  const novos = [...anos, ano].sort();
  await enviar('PutItem', {
    TableName: TABELA,
    Item: itemParaAttrs({ pk: chaves.META_ANOS.pk, sk: chaves.META_ANOS.sk, no: '_meta', dados: novos }),
  });
}

async function gravarItem(k, valor, chaveFilho) {
  const extras = chaves.extrasDe(k.no, chaveFilho, valor);
  await enviar('PutItem', {
    TableName: TABELA,
    Item: itemParaAttrs({ pk: k.pk, sk: k.sk, no: k.no, ...extras, dados: valor === undefined ? null : valor }),
  });
  await registrarAno(k.no, chaveFilho);
}

/** SET de um campo dentro do registro, sem reescrever o resto. */
async function gravarCampo(k, campo, valor) {
  const partes = String(campo).split('.');
  const nomes = {};
  const caminho = ['dados', ...partes].map((p, i) => {
    const alias = `#p${i}`;
    nomes[alias] = p;
    return alias;
  }).join('.');
  await enviar('UpdateItem', {
    TableName: TABELA,
    Key: { pk: { S: k.pk }, sk: { S: k.sk } },
    UpdateExpression: `SET ${caminho} = :v, #no = :no`,
    ExpressionAttributeNames: { ...nomes, '#no': 'no' },
    ExpressionAttributeValues: { ':v': paraAttr(valor), ':no': { S: k.no } },
  });
}

const ultimoSegmento = (no) => {
  const s = chaves.segmentos(no);
  return s.length > 1 ? s[s.length - 1] : null;
};

async function dbSet(no, valor) {
  const k = chaves.chaveDe(no, valor);

  if (k.tipo === 'item') {
    if (k.campo) return gravarCampo(k, k.campo, valor);
    return gravarItem(k, valor, ultimoSegmento(no) || k.sk);
  }

  // Gravar o nó INTEIRO substitui o que havia: o que não vem no valor novo
  // tem de desaparecer, senão `set` viraria `patch` e registro apagado
  // reapareceria.
  const antigos = k.tipo === 'colecao'
    ? await consultar(k.pk, k.prefixo)
    : (await Promise.all((await anosDisponibilidade()).map((a) => consultar(`AVAIL#${a}`, k.prefixo)))).flat();

  const manter = new Set();
  const escritas = [];
  for (const [filho, v] of Object.entries(valor || {})) {
    const ki = chaves.chaveDe(`${k.no}/${filho}`, v);
    manter.add(`${ki.pk}|${ki.sk}`);
    escritas.push({ PutRequest: { Item: itemParaAttrs({
      pk: ki.pk, sk: ki.sk, no: k.no, ...chaves.extrasDe(k.no, filho, v),
      dados: v === undefined ? null : v,
    }) } });
  }
  for (const it of antigos) {
    const id = `${it.pk.S}|${it.sk.S}`;
    if (!manter.has(id)) escritas.push({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } });
  }
  await escreverEmLote(escritas);
  for (const filho of Object.keys(valor || {})) await registrarAno(k.no, filho);
}

async function dbPatch(no, valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('dbPatch exige objeto');
  }
  const k = chaves.chaveDe(no, valor);

  if (k.tipo === 'item') {
    if (k.campo) return gravarCampo(k, k.campo, valor);
    // Mesclar campo a campo: o registro pode não existir ainda, e então o
    // UpdateItem o cria com só esses campos — igual ao PATCH do Firebase.
    const nomes = { '#no': 'no' };
    const valores = { ':no': { S: k.no } };
    const sets = ['#no = :no'];
    Object.entries(valor).forEach(([campo, v], i) => {
      nomes[`#c${i}`] = campo;
      valores[`:v${i}`] = paraAttr(v);
      sets.push(`dados.#c${i} = :v${i}`);
    });
    const extras = chaves.extrasDe(k.no, ultimoSegmento(no) || k.sk, valor);
    Object.entries(extras).forEach(([campo, v], i) => {
      nomes[`#e${i}`] = campo;
      valores[`:e${i}`] = paraAttr(v);
      sets.push(`#e${i} = :e${i}`);
    });
    try {
      await enviar('UpdateItem', {
        TableName: TABELA,
        Key: { pk: { S: k.pk }, sk: { S: k.sk } },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: nomes,
        ExpressionAttributeValues: valores,
      });
    } catch (e) {
      // `dados.#c = :v` falha se `dados` ainda não existe no item.
      if (e.name !== 'ValidationException') throw e;
      const atual = await pegarItem(k.pk, k.sk);
      const base = atual ? deAttr(atual.dados) : null;
      const mesclado = { ...(base && typeof base === 'object' ? base : {}), ...valor };
      await gravarItem(k, mesclado, ultimoSegmento(no) || k.sk);
    }
    return;
  }

  // PATCH no nó: mescla FILHOS (não apaga os que não vieram).
  const escritas = [];
  for (const [filho, v] of Object.entries(valor)) {
    const ki = chaves.chaveDe(`${k.no}/${filho}`, v);
    escritas.push({ PutRequest: { Item: itemParaAttrs({
      pk: ki.pk, sk: ki.sk, no: k.no, ...chaves.extrasDe(k.no, filho, v),
      dados: v === undefined ? null : v,
    }) } });
  }
  await escreverEmLote(escritas);
  for (const filho of Object.keys(valor)) await registrarAno(k.no, filho);
}

/**
 * Incremento atômico de um contador, devolvendo o valor novo.
 *
 * Substitui o `{".sv":{"increment":1}}` do Realtime Database. Precisa ser
 * atômico de verdade: o rate-limit por IP é compartilhado entre instâncias do
 * Lambda, e ler-somar-gravar perderia contagens exatamente quando o volume
 * sobe, que é quando o limite importa.
 *
 * `ADD` do DynamoDB só funciona em atributo de primeiro nível — por isso o
 * valor do registro mora em `dados` e não dentro de um mapa.
 */
async function dbIncrement(no, delta = 1) {
  const k = chaves.chaveDe(no);
  if (k.tipo !== 'item' || k.campo) throw new Error('dbIncrement só vale para um registro inteiro');
  const extras = chaves.extrasDe(k.no, ultimoSegmento(no) || k.sk, null);
  const nomes = { '#no': 'no' };
  const valores = { ':no': { S: k.no }, ':d': { N: String(delta) } };
  const sets = ['#no = :no'];
  Object.entries(extras).forEach(([campo, v], i) => {
    nomes[`#e${i}`] = campo;
    valores[`:e${i}`] = paraAttr(v);
    sets.push(`#e${i} = :e${i}`);
  });
  const r = await enviar('UpdateItem', {
    TableName: TABELA,
    Key: { pk: { S: k.pk }, sk: { S: k.sk } },
    UpdateExpression: `SET ${sets.join(', ')} ADD dados :d`,
    ExpressionAttributeNames: nomes,
    ExpressionAttributeValues: valores,
    ReturnValues: 'UPDATED_NEW',
  });
  return deAttr(r.Attributes?.dados);
}

async function dbPush(no, valor) {
  const id = novoId();
  const k = chaves.chaveDe(`${String(no).replace(/\/+$/, '')}/${id}`, valor);
  await gravarItem(k, valor, id);
  return { name: id };   // mesma resposta do POST do Firebase
}

async function dbDelete(no) {
  const k = chaves.chaveDe(no);

  if (k.tipo === 'item' && k.campo) {
    const partes = String(k.campo).split('.');
    const nomes = {};
    const caminho = ['dados', ...partes].map((p, i) => { nomes[`#p${i}`] = p; return `#p${i}`; }).join('.');
    await enviar('UpdateItem', {
      TableName: TABELA,
      Key: { pk: { S: k.pk }, sk: { S: k.sk } },
      UpdateExpression: `REMOVE ${caminho}`,
      ExpressionAttributeNames: nomes,
    });
    return;
  }

  if (k.tipo === 'item') {
    await enviar('DeleteItem', {
      TableName: TABELA, Key: { pk: { S: k.pk }, sk: { S: k.sk } },
    });
    return;
  }

  const itens = k.tipo === 'colecao'
    ? await consultar(k.pk, k.prefixo)
    : (await Promise.all((await anosDisponibilidade()).map((a) => consultar(`AVAIL#${a}`, k.prefixo)))).flat();
  await escreverEmLote(itens.map((it) => ({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } })));
}

/**
 * Exporta a tabela inteira no MESMO formato que o backup do Firebase tinha —
 * `{ no: { chave: valor } }` — que é o formato que
 * scripts/importar-para-dynamodb.js consome.
 *
 * Isso não é nostalgia de formato: é o que fecha o ciclo. Um backup que só o
 * próprio backup entende não restaura nada. Exportando na forma que o
 * importador lê, restaurar é rodar o importador sobre o arquivo de ontem.
 *
 * O item-índice de anos (`_meta`) fica de fora: é derivado, e o importador o
 * regenera. Exportá-lo faria o importador recusar o arquivo (nó desconhecido).
 */
async function exportarTudo() {
  const itens = [];
  let inicio;
  do {
    const r = await enviar('Scan', { TableName: TABELA, ExclusiveStartKey: inicio });
    itens.push(...(r.Items || []));
    inicio = r.LastEvaluatedKey;
  } while (inicio);

  const fora = {};
  let ignorados = 0;
  for (const it of itens) {
    const no = it.no?.S;
    if (!no || no === '_meta') continue;
    const d = chaves.NOS[no];
    if (!d) { ignorados++; continue; }
    const valor = deAttr(it.dados);

    if (d.folha) { fora[no] = valor; continue; }

    if (d.doisNiveis) {
      const pai = d.chaveDoItem(it);
      const filho = chaves.chaveDoSk(no, it.sk?.S || '');
      if (!pai || !filho) { ignorados++; continue; }
      fora[no] = fora[no] || {};
      fora[no][pai] = fora[no][pai] || {};
      fora[no][pai][filho] = valor;
      continue;
    }

    const k = d.chaveDoItem ? d.chaveDoItem(it) : chaves.chaveDoSk(no, it.sk?.S || '');
    if (k === null || k === '') { ignorados++; continue; }
    fora[no] = fora[no] || {};
    fora[no][k] = valor;
  }
  return { dados: fora, itens: itens.length, ignorados };
}

/**
 * Várias escritas que acontecem TODAS ou NENHUMA (TransactWriteItems).
 *
 * Existe para a criação do agendamento com cupom e gift card: gravar o pedido,
 * marcar o cupom como usado e descontar o saldo do gift card. Feito em passos
 * separados, dois pedidos simultâneos com o mesmo cupom de uso único passariam
 * os dois — cada um leu "não usado" antes do outro gravar. Com a transação e as
 * condições abaixo, o segundo falha inteiro e nada dele é gravado.
 *
 * Cada escrita é uma de:
 *   { tipo: 'criar', caminho, valor }
 *       grava o registro só se ele ainda NÃO existe.
 *   { tipo: 'atualizar', caminho, campos, seIgual, seAusenteOuIgual }
 *       SET de campos de primeiro nível dentro de `dados`, só se o registro
 *       existe e cada campo de `seIgual` tem exatamente aquele valor (e cada um
 *       de `seAusenteOuIgual` está ausente ou com aquele valor).
 *
 * Se alguma condição falhar, lança um erro com `condicaoFalhou = true` e o
 * índice da escrita que falhou em `indice` (quando o DynamoDB informa).
 */
async function dbTransacao(escritas) {
  if (!Array.isArray(escritas) || !escritas.length || escritas.length > 25) {
    throw new Error('dbTransacao exige de 1 a 25 escritas');
  }
  const itens = escritas.map((e, n) => {
    const k = chaves.chaveDe(e.caminho, e.valor);
    if (k.tipo !== 'item' || k.campo) throw new Error(`dbTransacao: ${e.caminho} não é um registro`);

    if (e.tipo === 'criar') {
      const extras = chaves.extrasDe(k.no, ultimoSegmento(e.caminho) || k.sk, e.valor);
      return { Put: {
        TableName: TABELA,
        Item: itemParaAttrs({ pk: k.pk, sk: k.sk, no: k.no, ...extras, dados: e.valor }),
        ConditionExpression: 'attribute_not_exists(pk)',
      } };
    }

    if (e.tipo === 'atualizar') {
      const nomes = { '#d': 'dados' };
      const valores = {};
      const sets = [];
      const conds = ['attribute_exists(pk)'];
      Object.entries(e.campos || {}).forEach(([campo, v], i) => {
        nomes[`#c${i}`] = campo;
        valores[`:c${i}`] = paraAttr(v);
        sets.push(`#d.#c${i} = :c${i}`);
      });
      Object.entries(e.seIgual || {}).forEach(([campo, v], i) => {
        nomes[`#q${i}`] = campo;
        valores[`:q${i}`] = paraAttr(v);
        conds.push(`#d.#q${i} = :q${i}`);
      });
      Object.entries(e.seAusenteOuIgual || {}).forEach(([campo, v], i) => {
        nomes[`#a${i}`] = campo;
        valores[`:a${i}`] = paraAttr(v);
        conds.push(`(attribute_not_exists(#d.#a${i}) OR #d.#a${i} = :a${i})`);
      });
      if (!sets.length) throw new Error(`dbTransacao: nada a atualizar em ${e.caminho} (#${n})`);
      return { Update: {
        TableName: TABELA,
        Key: { pk: { S: k.pk }, sk: { S: k.sk } },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: conds.join(' AND '),
        ExpressionAttributeNames: nomes,
        ExpressionAttributeValues: valores,
      } };
    }
    throw new Error(`dbTransacao: tipo desconhecido '${e.tipo}'`);
  });

  try {
    await enviar('TransactWriteItems', { TransactItems: itens });
  } catch (err) {
    const motivos = err?.CancellationReasons || [];
    const indice = motivos.findIndex((m) => m && m.Code === 'ConditionalCheckFailed');
    if (err?.name === 'TransactionCanceledException' && indice >= 0) {
      const e = new Error('condição da transação não satisfeita');
      e.condicaoFalhou = true;
      e.indice = indice;
      throw e;
    }
    throw err;
  }
}

/** BatchWriteItem em fatias de 25, com um reenvio dos não-processados. */
async function escreverEmLote(escritas) {
  for (let i = 0; i < escritas.length; i += 25) {
    const fatia = escritas.slice(i, i + 25);
    let r = await enviar('BatchWriteItem', { RequestItems: { [TABELA]: fatia } });
    const resto = r.UnprocessedItems?.[TABELA];
    if (resto && resto.length) {
      r = await enviar('BatchWriteItem', { RequestItems: { [TABELA]: resto } });
      const falta = r.UnprocessedItems?.[TABELA]?.length || 0;
      if (falta) throw new Error(`${falta} item(ns) não gravados — escrita incompleta`);
    }
  }
}

module.exports = {
  dbPath, dbGet, dbSet, dbPatch, dbPush, dbDelete, dbIncrement, dbTransacao, exportarTudo,
  // expostos para teste e para o importador
  paraAttr, deAttr, itemParaAttrs, novoId, TABELA, _injetar,
};
