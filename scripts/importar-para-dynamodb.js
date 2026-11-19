'use strict';

// Importa o backup do Firebase para a tabela `sp-car-clean-data` do DynamoDB.
//
// É a Fase 0 de docs/migracao-aws.md, com o mapeamento daquele documento.
// O Firebase foi excluído em 10/11/2026 e a única cópia dos dados é o backup
// de 09/11 no S3 — então este script é o caminho de volta dos dados, e o que
// ele errar ninguém mais corrige depois.
//
// Por isso duas regras de projeto estão embutidas:
//
//  1. Nó sem mapeamento ABORTA a importação. Um nó que o mapa não conhece
//     seria silenciosamente descartado, e a perda só apareceria meses depois,
//     quando alguém procurasse o dado. Falhar é a única opção honesta.
//  2. Nada é gravado sem `--executar`. Sem a flag o script só mostra o plano.
//
// Uso:
//   node scripts/importar-para-dynamodb.js <backup.json.gz>              # plano
//   node scripts/importar-para-dynamodb.js <backup.json.gz> --executar   # grava
//   node scripts/importar-para-dynamodb.js <backup.json.gz> --conferir   # relê e compara
//
// Sem dependência nova: usa a CLI da AWS, que já está no ambiente.

const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const path = require('path');

const TABELA = 'sp-car-clean-data';
const REGIAO = 'sa-east-1';
const TTL_DIAS = 90;              // aiLogs e aiRateLimit, conforme o documento
const LOTE = 25;                  // teto do BatchWriteItem

// ── conversão (usa o mapeamento compartilhado) ────────────────────────
//
// O mapeamento vive em functions/lib/core/chaves.js, o MESMO que as Lambdas
// usam para ler. Ter uma cópia aqui foi tentador e é justamente o erro que o
// comentário daquele arquivo descreve: o importador gravaria numa chave e o
// app leria de outra, sem erro em lugar nenhum.

const chaves = require('../functions/lib/core/chaves.js');
const store = require('../functions/lib/core/store.js');

const paraAttr = store.paraAttr;

/** Itens de um nó, já com pk/sk e os campos de índice. */
function itensDoNo(no, valor) {
  const d = chaves.NOS[no];
  if (!valor || typeof valor !== 'object') {
    // Nó folha com valor escalar não existe no backup; nó vazio não gera item.
    return valor === undefined || valor === null ? [] : [montar(chaves.chaveDe(no), no, valor, no)];
  }

  if (d.folha) {
    // `config` são campos planos: o nó inteiro é um item só.
    return [montar(chaves.chaveDe(no), no, valor, no)];
  }

  if (d.doisNiveis) {
    const itens = [];
    for (const [pai, filhos] of Object.entries(valor)) {
      if (!filhos || typeof filhos !== 'object') continue;
      for (const [filho, v] of Object.entries(filhos)) {
        itens.push(montar(chaves.chaveDe(`${no}/${pai}/${filho}`, v), no, v, filho));
      }
    }
    return itens;
  }

  return Object.entries(valor).map(([filho, v]) =>
    montar(chaves.chaveDe(`${no}/${filho}`, v), no, v, filho));
}

function montar(k, no, valor, chaveFilho) {
  const extra = chaves.extrasDe(no, chaveFilho, valor);
  return { pk: k.pk, sk: k.sk, valor, no, extra: Object.keys(extra).length ? extra : undefined };
}

/**
 * Converte o backup inteiro em itens do DynamoDB.
 * Lança se houver nó sem mapeamento — ver regra 1 no topo.
 */
function converter(backup) {
  const desconhecidos = Object.keys(backup).filter((n) => !chaves.conhecido(n));
  if (desconhecidos.length) {
    throw new Error(
      `nó sem mapeamento: ${desconhecidos.join(', ')}. `
      + 'Importar assim perderia esse dado em silêncio — acrescente ao NOS de '
      + 'functions/lib/core/chaves.js primeiro.'
    );
  }

  const itens = [];
  const porNo = {};
  const anos = new Set();

  for (const [no, valor] of Object.entries(backup)) {
    const convertidos = itensDoNo(no, valor);
    porNo[no] = { origem: contarOrigem(valor, no), itens: convertidos.length };
    for (const it of convertidos) {
      if (!it.pk || !it.sk) throw new Error(`item sem chave no nó ${no}: ${JSON.stringify(it).slice(0, 120)}`);
      itens.push(it);
      if (chaves.NOS[no]?.porAno) {
        const m = /^AVAIL#(\d{4})$/.exec(it.pk);
        if (m) anos.add(m[1]);
      }
    }
  }

  // Item-índice dos anos: sem ele, ler `blocked` inteiro exigiria adivinhar as
  // partições. Ver chaves.js (META_ANOS).
  if (anos.size) {
    itens.push({
      pk: chaves.META_ANOS.pk, sk: chaves.META_ANOS.sk, no: '_meta',
      valor: [...anos].sort(),
    });
    porNo._meta = { origem: anos.size, itens: 1 };
  }

  return { itens, porNo };
}

/** Quantos registros o nó tem na origem (para conferir contagem). */
function contarOrigem(valor, no) {
  if (!valor || typeof valor !== 'object') return 1;
  if (chaves.NOS[no]?.folha) return 1;                 // vira um item só
  if (chaves.NOS[no]?.doisNiveis) {
    return Object.values(valor).reduce((s, f) => s + (f && typeof f === 'object' ? Object.keys(f).length : 0), 0);
  }
  return Object.keys(valor).length;
}

/** Item do DynamoDB no formato do `batch-write-item`. */
function itemFinal(it) {
  const campos = { pk: it.pk, sk: it.sk, ...(it.extra || {}), no: it.no };
  campos.dados = it.valor === undefined ? null : it.valor;
  const item = store.itemParaAttrs(campos);
  for (const k of ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', 'no', 'token']) {
    if (!item[k]) continue;
    if (item[k].M || item[k].L) throw new Error(`campo de chave ${k} não pode ser objeto/lista`);
    if (item[k].S === '') throw new Error(`campo de chave ${k} não pode ser string vazia`);
  }
  return { PutRequest: { Item: item } };
}

// ── execução ──────────────────────────────────────────────────────────

function aws(args) {
  return execFileSync('aws', ['--region', REGIAO, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gravar(itens, dirTmp) {
  let enviados = 0;
  for (let i = 0; i < itens.length; i += LOTE) {
    const fatia = itens.slice(i, i + LOTE).map(itemFinal);
    const arq = path.join(dirTmp, `lote-${String(i).padStart(6, '0')}.json`);
    fs.writeFileSync(arq, JSON.stringify({ [TABELA]: fatia }));
    const saida = aws(['dynamodb', 'batch-write-item', '--request-items', `file://${arq}`]);
    const resp = JSON.parse(saida || '{}');
    const naoProcessados = resp?.UnprocessedItems?.[TABELA]?.length || 0;
    if (naoProcessados) {
      // Reenvia uma vez: o DynamoDB devolve não-processados sob pressão, e
      // ignorar isso é perder registro sem erro nenhum.
      fs.writeFileSync(arq, JSON.stringify({ [TABELA]: resp.UnprocessedItems[TABELA] }));
      const r2 = JSON.parse(aws(['dynamodb', 'batch-write-item', '--request-items', `file://${arq}`]) || '{}');
      const resta = r2?.UnprocessedItems?.[TABELA]?.length || 0;
      if (resta) throw new Error(`${resta} item(ns) não gravados no lote ${i} — importação interrompida`);
    }
    fs.unlinkSync(arq);
    enviados += fatia.length;
    if (enviados % 500 === 0 || i + LOTE >= itens.length) {
      process.stdout.write(`\r  gravados ${enviados}/${itens.length}`);
    }
  }
  process.stdout.write('\n');
  return enviados;
}

function conferir(porNo) {
  console.log('\n=== conferência: contagem na tabela por partição ===');
  const saida = aws(['dynamodb', 'scan', '--table-name', TABELA,
    '--projection-expression', '#n', '--expression-attribute-names', '{"#n":"no"}',
    '--output', 'json']);
  const itens = JSON.parse(saida).Items || [];
  const contagem = {};
  for (const it of itens) {
    const no = it.no?.S || '(sem no)';
    contagem[no] = (contagem[no] || 0) + 1;
  }
  let ok = true;
  for (const [no, info] of Object.entries(porNo).sort()) {
    const naTabela = contagem[no] || 0;
    const bate = naTabela === info.itens;
    if (!bate) ok = false;
    console.log(`  ${bate ? 'ok  ' : 'ERRO'} ${no.padEnd(22)} origem=${String(info.origem).padStart(6)} esperado=${String(info.itens).padStart(6)} na tabela=${String(naTabela).padStart(6)}`);
  }
  const sobrando = Object.keys(contagem).filter((n) => !(n in porNo) && Object.keys(porNo).length > 2);
  if (sobrando.length) { ok = false; console.log(`  ERRO nós na tabela que não vieram deste backup: ${sobrando.join(', ')}`); }
  console.log(ok ? '\nCONFERE: a tabela tem exatamente o que o backup tinha.' : '\nDIVERGÊNCIA — ver linhas marcadas com ERRO.');
  return ok;
}

function main() {
  const [, , arquivo, ...flags] = process.argv;
  if (!arquivo) {
    console.error('uso: node scripts/importar-para-dynamodb.js <backup.json.gz> [--executar|--conferir]');
    process.exit(2);
  }
  const bruto = arquivo.endsWith('.gz')
    ? zlib.gunzipSync(fs.readFileSync(arquivo)).toString('utf8')
    : fs.readFileSync(arquivo, 'utf8');
  const backup = JSON.parse(bruto);

  const { itens: todos, porNo: porNoTudo } = converter(backup);

  // `--so=aiLogs,feedback` reimporta só esses nós. O item-índice de anos entra
  // sempre: ele é derivado do backup inteiro, e recalculá-lo a partir de um
  // subconjunto apagaria os anos que ficaram de fora.
  const soFlag = flags.find((f) => f.startsWith('--so='));
  const so = soFlag ? soFlag.slice(5).split(',').map((x) => x.trim()).filter(Boolean) : null;
  const itens = so ? todos.filter((i) => so.includes(i.no) || i.no === '_meta') : todos;
  const porNo = so
    ? Object.fromEntries(Object.entries(porNoTudo).filter(([n]) => so.includes(n) || n === '_meta'))
    : porNoTudo;
  if (so) {
    const invalidos = so.filter((n) => !(n in porNoTudo));
    if (invalidos.length) throw new Error(`--so com nó que não está no backup: ${invalidos.join(', ')}`);
    console.log(`(--so: apenas ${so.join(', ')} — e o item-índice de anos)\n`);
  }

  console.log(`backup: ${arquivo}`);
  console.log(`nós: ${Object.keys(porNo).length} · itens a gravar: ${itens.length}\n`);
  for (const [no, info] of Object.entries(porNo).sort()) {
    console.log(`  ${no.padEnd(22)} origem=${String(info.origem).padStart(6)} → itens=${String(info.itens).padStart(6)}`);
  }

  if (flags.includes('--conferir')) { process.exit(conferir(porNo) ? 0 : 1); }

  if (!flags.includes('--executar')) {
    console.log('\n(plano apenas — nada foi gravado. Rode com --executar para gravar.)');
    return;
  }

  const dirTmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'imp-ddb-'));
  console.log(`\ngravando em ${TABELA} (${REGIAO})…`);
  const n = gravar(itens, dirTmp);
  fs.rmSync(dirTmp, { recursive: true, force: true });
  console.log(`\n${n} item(ns) gravados.`);
  process.exit(conferir(porNo) ? 0 : 1);
}

if (require.main === module) main();

module.exports = { converter, itensDoNo, itemFinal, paraAttr, contarOrigem };
