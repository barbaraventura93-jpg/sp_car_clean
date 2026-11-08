/**
 * SP Car Clean — fotos do Drive para o site, sozinho.
 *
 * Roda no Apps Script, na conta Google que é dona das pastas. Escolha
 * deliberada: assim não existe conta de serviço, nem chave JSON, nem projeto no
 * Google Cloud. A documentação do Google recomenda evitar chave de conta de
 * serviço justamente para carga que roda fora do Google Cloud — e a nossa Lambda
 * está na AWS.
 *
 * COMO INSTALAR
 *
 *  1. script.google.com → Novo projeto → cole este arquivo inteiro
 *  2. Serviços (+) → "Drive API" → Adicionar     (precisa para a miniatura)
 *  3. Configurações do projeto → Propriedades do script → adicione:
 *
 *       ENDPOINT             https://spcarclean.com.br/api/drive-sync
 *       SEGREDO              (o mesmo valor que está no SSM)
 *       PASTA_CARROSSEL      (id da pasta "Site/Carrossel")
 *       PASTA_ANTES_DEPOIS   (id da pasta "Site/Antes e Depois")
 *
 *     O id da pasta é o trecho final da URL quando ela está aberta no Drive:
 *     drive.google.com/drive/folders/ESTE_PEDACO_AQUI
 *
 *  4. Rode `testar()` primeiro. Ele NÃO envia nada: só mostra no log o que faria
 *     e o tamanho real das miniaturas. É assim que a gente confirma que a
 *     miniatura serve, porque o tamanho dela é a única parte deste desenho que a
 *     documentação do Google não especifica.
 *  5. Se o log estiver bom: Gatilhos (⏰) → Adicionar gatilho → função
 *     `sincronizar`, origem "Baseado no tempo", diariamente.
 *
 * A REGRA DO QUE ENTRA NO SITE
 *
 *   Site/Carrossel        → cada foto vira um item do carrossel ("só o depois")
 *   Site/Antes e Depois   → pares, pelo NOME do arquivo:
 *                             "Fusca antes.jpg"  +  "Fusca depois.jpg"
 *                           viram um cartão de antes/depois (os dois juntos)
 *
 * O par é pelo nome porque o nome é a única coisa que diz qual foto é qual —
 * `IMG_20261020_095116.jpg` não diz nada. Arquivo sem par, ou com nome fora do
 * padrão, é PULADO e aparece no log. Preferi pular e avisar a adivinhar: foto de
 * "antes" entrando como resultado é o contrário de uma vitrine.
 *
 * Foto já importada não entra de novo: o servidor guarda os ids já usados.
 */

/** Largura que pedimos ao Google. 1600 cobre tela de celular em 2x. */
var LARGURA = 1600;

/** Extensões que aceitamos. HEIC fica fora: o navegador não exibe. */
var EXTENSOES = ['jpg', 'jpeg', 'png', 'webp'];

// ---------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------

/** Execução de verdade. É esta que o gatilho diário chama. */
function sincronizar() {
  executar(false);
}

/** Ensaio: não envia nada, só relata. Rode esta primeiro. */
function testar() {
  executar(true);
}

// ---------------------------------------------------------------------

function cfg(nome) {
  var v = PropertiesService.getScriptProperties().getProperty(nome);
  if (!v) throw new Error('Falta a propriedade do script: ' + nome);
  return v;
}

function executar(ensaio) {
  var endpoint = cfg('ENDPOINT');
  var segredo = cfg('SEGREDO');

  var jaImportados = {};
  if (ensaio) {
    Logger.log('ENSAIO — nada será enviado.');
  }
  // Mesmo no ensaio consultamos o estado: saber o que JÁ está no site é metade
  // da informação útil do relatório.
  var estado = chamar(endpoint, segredo, { op: 'estado' });
  (estado.ids || []).forEach(function (id) { jaImportados[id] = true; });
  Logger.log('Já no site: %s foto(s).', (estado.ids || []).length);

  var resumo = { carrossel: 0, pares: 0, pulados: 0, erros: 0 };

  // ── Carrossel: foto avulsa do resultado ──────────────────────────────
  var doCarrossel = listar(cfg('PASTA_CARROSSEL'));
  Logger.log('--- Carrossel: %s arquivo(s) na pasta', doCarrossel.length);
  doCarrossel.forEach(function (f) {
    if (jaImportados[f.id]) return;
    try {
      var foto = miniatura(f);
      Logger.log('  %s → %s KB', f.nome, Math.round(foto.bytes / 1024));
      if (ensaio) { resumo.carrossel++; return; }
      chamar(endpoint, segredo, {
        op: 'carrossel',
        arquivoId: f.id,
        nome: f.nome,
        legenda: legendaDe(f.nome),
        conteudoBase64: foto.base64,
      });
      resumo.carrossel++;
    } catch (e) {
      Logger.log('  ERRO em %s: %s', f.nome, e.message);
      resumo.erros++;
    }
  });

  // ── Antes e depois: pares pelo nome ──────────────────────────────────
  var doPar = listar(cfg('PASTA_ANTES_DEPOIS'));
  Logger.log('--- Antes e Depois: %s arquivo(s) na pasta', doPar.length);
  var grupos = {};
  doPar.forEach(function (f) {
    var m = classificar(f.nome);
    if (!m) {
      Logger.log('  PULADO (nome sem "antes"/"depois"): %s', f.nome);
      resumo.pulados++;
      return;
    }
    grupos[m.grupo] = grupos[m.grupo] || {};
    grupos[m.grupo][m.lado] = f;
  });

  Object.keys(grupos).forEach(function (nome) {
    var g = grupos[nome];
    if (!g.antes || !g.depois) {
      Logger.log('  PULADO (par incompleto): %s — tem só o %s', nome, g.antes ? 'antes' : 'depois');
      resumo.pulados++;
      return;
    }
    if (jaImportados[g.antes.id] || jaImportados[g.depois.id]) return;
    try {
      var a = miniatura(g.antes);
      var d = miniatura(g.depois);
      Logger.log('  par "%s" → antes %s KB, depois %s KB', nome,
        Math.round(a.bytes / 1024), Math.round(d.bytes / 1024));
      if (ensaio) { resumo.pares++; return; }
      chamar(endpoint, segredo, {
        op: 'antes-depois',
        legenda: legendaDe(nome),
        antes: { arquivoId: g.antes.id, nome: g.antes.nome, conteudoBase64: a.base64 },
        depois: { arquivoId: g.depois.id, nome: g.depois.nome, conteudoBase64: d.base64 },
      });
      resumo.pares++;
    } catch (e) {
      Logger.log('  ERRO no par %s: %s', nome, e.message);
      resumo.erros++;
    }
  });

  Logger.log('=== %s: %s no carrossel, %s par(es), %s pulado(s), %s erro(s)',
    ensaio ? 'ENSAIO' : 'FEITO', resumo.carrossel, resumo.pares, resumo.pulados, resumo.erros);
  if (ensaio) Logger.log('Nada foi enviado. Se os tamanhos acima estiverem bons, crie o gatilho diário.');
}

/** Arquivos de imagem da pasta, do mais novo para o mais antigo. */
function listar(idPasta) {
  var it = DriveApp.getFolderById(idPasta).getFiles();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    var nome = f.getName();
    var ext = String(nome.split('.').pop() || '').toLowerCase();
    if (EXTENSOES.indexOf(ext) === -1) continue;
    out.push({ id: f.getId(), nome: nome, em: f.getDateCreated() });
  }
  out.sort(function (a, b) { return b.em - a.em; });
  return out;
}

/**
 * "Fusca antes.jpg" → { grupo: "fusca", lado: "antes" }
 *
 * Exige a palavra antes/depois no nome. Nome que não traz isso é pulado, nunca
 * adivinhado — ver o comentário do topo.
 */
function classificar(nome) {
  var semExt = nome.replace(/\.[^.]*$/, '');
  var m = semExt.match(/^(.*?)[\s_-]*(antes|depois)[\s_-]*(\d+)?$/i);
  if (!m) return null;
  var grupo = String(m[1] || '').trim().toLowerCase();
  if (!grupo) return null;
  return { grupo: grupo, lado: m[2].toLowerCase() };
}

/** Legenda a partir do nome do arquivo: tira extensão, hífens e numeração. */
function legendaDe(nome) {
  var s = String(nome).replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ')
    .replace(/\s*\b(antes|depois)\b\s*/gi, ' ')
    .replace(/\s+\d+$/, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Pega a versão reduzida que o próprio Google gera.
 *
 * É daqui que vem a economia: o original tem de 2 a 23 MB, e a miniatura grande
 * chega com algumas centenas de KB, já re-codificada — o que também descarta o
 * EXIF, e com ele o GPS de foto tirada na casa do cliente.
 *
 * O sufixo de tamanho do thumbnailLink não está na documentação do Google, então
 * aqui ele é tentado e, se não vier nada utilizável, a função ESTOURA em vez de
 * mandar o original: original de 23 MB seria recusado pelo servidor de um jeito
 * bem menos claro. É o `testar()` que confirma que esta parte funciona.
 */
function miniatura(f) {
  var meta = Drive.Files.get(f.id, { fields: 'thumbnailLink,mimeType,size', supportsAllDrives: true });
  if (!meta || !meta.thumbnailLink) {
    throw new Error('sem miniatura disponível (o Drive ainda pode estar processando o arquivo)');
  }
  // O link vem com um sufixo de tamanho, tipo "=s220". Trocamos pela largura
  // que queremos; se o formato mudar, acrescentamos.
  var url = /=s\d+/.test(meta.thumbnailLink)
    ? meta.thumbnailLink.replace(/=s\d+.*$/, '=s' + LARGURA)
    : meta.thumbnailLink + '=s' + LARGURA;

  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('miniatura respondeu HTTP ' + resp.getResponseCode());
  }
  var blob = resp.getBlob();
  var bytes = blob.getBytes();
  if (!bytes.length) throw new Error('miniatura veio vazia');
  return { bytes: bytes.length, base64: Utilities.base64Encode(bytes) };
}

/** POST no endpoint do site. Estoura com a mensagem do servidor. */
function chamar(endpoint, segredo, corpo) {
  var resp = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Drive-Sync-Secret': segredo },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true,
  });
  var texto = resp.getContentText();
  var dados = {};
  try { dados = JSON.parse(texto); } catch (e) { /* resposta não-JSON cai abaixo */ }
  if (resp.getResponseCode() !== 200 || dados.ok === false) {
    throw new Error('servidor: HTTP ' + resp.getResponseCode() + ' ' + (dados.error || texto.slice(0, 200)));
  }
  return dados;
}
