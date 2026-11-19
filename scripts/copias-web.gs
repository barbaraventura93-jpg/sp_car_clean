/**
 * SP Car Clean — cópias reduzidas das fotos grandes do Drive, numa pasta "_web".
 *
 * POR QUE EXISTE: o conector do Google Drive que o Claude usa para montar os
 * posts não baixa arquivo acima de 10 MB (conferido em 17/11/2026: "motor mini
 * antes.jpg", de 10,09 MB, baixou; "motor mini depois.jpg", de 11,6 MB, e as
 * fotos do teto, de 14 a 15 MB, foram recusadas com "over limit of 10 MB"). As
 * fotos de câmera boa passam disso, e as 24 da Pickup Corsa Uva têm de 22 a
 * 32 MB. Sem uma cópia menor, essas fotos ficam fora dos posts.
 *
 * O QUE FAZ: em cada pasta dentro de "SP Car Clean_Fotos Instagram", para cada
 * foto acima de LIMITE_BYTES, grava uma cópia reduzida com o MESMO NOME numa
 * subpasta "_web" daquela pasta. O ORIGINAL NUNCA É ALTERADO, MOVIDO NEM
 * APAGADO: o script só cria arquivos dentro de "_web".
 *
 * COMO REDUZ: igual ao drive-sync.gs, pede ao próprio Google a miniatura grande
 * do arquivo (LARGURA px no lado maior). Ela chega re-codificada em JPEG, com
 * algumas centenas de KB a poucos MB, e sem EXIF — o que também descarta o GPS
 * de foto tirada na casa do cliente. 2600 px é o mesmo teto que os scripts de
 * arte já usam (treat() reduz tudo para 2600 antes de tratar), então nada se
 * perde para um post de 1080 px.
 *
 * O sufixo de tamanho do thumbnailLink não está na documentação do Google. Se a
 * miniatura vier pequena demais ou falhar, a foto é pulada com o motivo no log,
 * e nada é gravado. O `testar()` mostra o tamanho real antes de gravar qualquer
 * coisa.
 *
 * COMO INSTALAR (uma vez, uns 5 minutos)
 *
 *  1. script.google.com → Novo projeto → apague o conteúdo e cole este arquivo
 *  2. Serviços (+) → "Drive API" → Adicionar        (precisa para a miniatura)
 *  3. Configurações do projeto → Propriedades do script → adicione:
 *
 *       PASTA_RAIZ   11MbFvZ910VzW0mK374bd1_dYbCwOCyvS
 *                    (id da pasta "SP Car Clean_Fotos Instagram")
 *
 *  4. Rode `testar()`. Ele NÃO grava nada: lista cada foto grande, de qual pasta,
 *     e o tamanho que a cópia teria. Na primeira vez o Google pede autorização.
 *  5. Se a lista estiver boa, rode `gerarCopias()` uma vez.
 *  6. Gatilhos (⏰) → Adicionar gatilho → função `gerarCopias`, origem
 *     "Baseado no tempo", diariamente. Daí em diante, foto nova grande ganha
 *     cópia sozinha no dia seguinte.
 *
 * Rodar de novo não duplica: se "_web" já tem um arquivo com o mesmo nome, a
 * foto é pulada.
 */

/**
 * Acima disto a foto ganha cópia: é o limite do conector, 10 MiB. Medido, não
 * suposto: 10.091.930 bytes baixou e 11.561.558 foi recusado.
 */
var LIMITE_BYTES = 10 * 1024 * 1024;

/** Lado maior da cópia, em px. */
var LARGURA = 2600;

/** Cópia menor que isto no lado maior não serve para post: é pulada. */
var LADO_MINIMO = 1600;

/** Nome da subpasta das cópias. */
var PASTA_WEB = '_web';

/**
 * O Apps Script tem 6 minutos por execução. Parar antes deixa o resto para a
 * próxima rodada do gatilho, em vez de ser cortado no meio de uma gravação.
 */
var TEMPO_MAX_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

/** Execução de verdade. É esta que o gatilho diário chama. */
function gerarCopias() { executar(false); }

/** Ensaio: não grava nada, só lista o que seria criado. Rode esta primeiro. */
function testar() { executar(true); }

// ---------------------------------------------------------------------------

function executar(ensaio) {
  var raiz = PropertiesService.getScriptProperties().getProperty('PASTA_RAIZ');
  if (!raiz) throw new Error('Falta a propriedade do script PASTA_RAIZ');
  if (ensaio) Logger.log('ENSAIO — nada será gravado.');

  var inicio = Date.now();
  var resumo = { criadas: 0, jaTinham: 0, puladas: 0, erros: 0, pendentes: 0 };

  percorrer(DriveApp.getFolderById(raiz), '', function (pasta, caminho) {
    var fotos = [];
    var it = pasta.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      fotos.push({ id: f.getId(), nome: f.getName(), bytes: f.getSize(),
                   mime: String(f.getMimeType() || '').toLowerCase() });
    }
    var grandes = fotos.filter(function (a) { return precisaDeCopia(a, {}); });
    if (!grandes.length) return;

    var web = subpasta(pasta, PASTA_WEB);
    var naWeb = web ? nomesEm(web) : {};

    grandes.forEach(function (a) {
      if (!precisaDeCopia(a, naWeb)) { resumo.jaTinham++; return; }
      if (Date.now() - inicio > TEMPO_MAX_MS) { resumo.pendentes++; return; }
      try {
        var mini = miniatura(a.id);
        var motivo = motivoParaPular(mini.bytes, mini.lado);
        if (motivo) {
          Logger.log('  PULADA [%s] %s: %s', caminho, a.nome, motivo);
          resumo.puladas++;
          return;
        }
        Logger.log('  %s [%s] %s  %s MB → %s KB',
          ensaio ? 'CRIARIA' : 'CRIADA ', caminho, a.nome,
          (a.bytes / 1048576).toFixed(1), Math.round(mini.bytes / 1024));
        if (!ensaio) {
          if (!web) web = pasta.createFolder(PASTA_WEB);
          web.createFile(mini.blob.setName(a.nome));
        }
        naWeb[a.nome] = true;
        resumo.criadas++;
      } catch (e) {
        Logger.log('  ERRO [%s] %s: %s', caminho, a.nome, e.message);
        resumo.erros++;
      }
    });
  });

  Logger.log('');
  Logger.log('=== %s: %s cópia(s) %s, %s já tinham, %s pulada(s), %s erro(s)%s',
    ensaio ? 'ENSAIO' : 'FEITO', resumo.criadas, ensaio ? 'a criar' : 'criada(s)',
    resumo.jaTinham, resumo.puladas, resumo.erros,
    resumo.pendentes ? ', ' + resumo.pendentes + ' ficaram para a próxima rodada (tempo)' : '');
}

/** Visita a pasta e todas as subpastas, menos as próprias "_web". */
function percorrer(pasta, caminho, visitar) {
  var aqui = caminho ? caminho + '/' + pasta.getName() : pasta.getName();
  visitar(pasta, aqui);
  var it = pasta.getFolders();
  while (it.hasNext()) {
    var sub = it.next();
    if (ehPastaWeb(sub.getName())) continue;
    percorrer(sub, aqui, visitar);
  }
}

function subpasta(pasta, nome) {
  var it = pasta.getFoldersByName(nome);
  return it.hasNext() ? it.next() : null;
}

function nomesEm(pasta) {
  var out = {};
  var it = pasta.getFiles();
  while (it.hasNext()) out[it.next().getName()] = true;
  return out;
}

/**
 * Pede a miniatura grande ao Google. Devolve o blob, o tamanho em bytes e o
 * lado maior em px (lido do cabeçalho do JPEG/PNG, para conferir que o Google
 * não devolveu uma miniatura pequena demais).
 */
function miniatura(id) {
  var meta = Drive.Files.get(id, { fields: 'thumbnailLink', supportsAllDrives: true });
  if (!meta || !meta.thumbnailLink) {
    throw new Error('sem miniatura disponível (o Drive ainda pode estar processando o arquivo)');
  }
  var resp = UrlFetchApp.fetch(urlMiniatura(meta.thumbnailLink, LARGURA), {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('miniatura respondeu HTTP ' + resp.getResponseCode());
  }
  var blob = resp.getBlob();
  var bytes = blob.getBytes();
  var dim = dimensoes(bytes);
  return { blob: blob, bytes: bytes.length, lado: dim ? Math.max(dim.largura, dim.altura) : 0 };
}

// ---------------------------------------------------------------------------
// Regras puras (testadas em scripts/test-copias-web.js)
// ---------------------------------------------------------------------------

/** Pasta de cópias não é percorrida, senão cópia geraria cópia. */
function ehPastaWeb(nome) {
  return String(nome || '').trim().toLowerCase() === PASTA_WEB;
}

/**
 * A foto precisa de cópia? Só imagem, só acima do limite, e só se "_web" ainda
 * não tem um arquivo com o mesmo nome. Vídeo fica fora: reduzir exigiria
 * transcodificar, e a miniatura de vídeo é um quadro só.
 */
function precisaDeCopia(arquivo, nomesNaWeb) {
  if (!arquivo || String(arquivo.mime || '').indexOf('image/') !== 0) return false;
  if (!(arquivo.bytes > LIMITE_BYTES)) return false;
  return !(nomesNaWeb && nomesNaWeb[arquivo.nome]);
}

/** Troca (ou acrescenta) o sufixo de tamanho do thumbnailLink. */
function urlMiniatura(link, largura) {
  return /=s\d+/.test(link)
    ? link.replace(/=s\d+.*$/, '=s' + largura)
    : link + '=s' + largura;
}

/**
 * Por que a cópia não serve, ou '' se serve. Pequena demais não vale para post;
 * acima do limite continuaria sem baixar pelo conector.
 */
function motivoParaPular(bytes, lado) {
  if (!bytes) return 'a miniatura veio vazia';
  if (bytes > LIMITE_BYTES) return 'a cópia ainda passa de 10 MB';
  if (lado && lado < LADO_MINIMO) return 'o Google devolveu só ' + lado + ' px (mínimo ' + LADO_MINIMO + ')';
  return '';
}

/**
 * Largura e altura lidas do cabeçalho de um JPEG ou PNG, sem biblioteca.
 * Aceita array de bytes com sinal (o que o Apps Script devolve) ou sem sinal.
 * Devolve null se não reconhecer o formato.
 */
function dimensoes(bytes) {
  function b(i) { return bytes[i] & 0xff; }
  if (!bytes || bytes.length < 24) return null;
  // PNG: assinatura de 8 bytes, depois o chunk IHDR com largura e altura.
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) {
    return {
      largura: (b(16) << 24 | b(17) << 16 | b(18) << 8 | b(19)) >>> 0,
      altura: (b(20) << 24 | b(21) << 16 | b(22) << 8 | b(23)) >>> 0,
    };
  }
  // JPEG: procura o marcador SOF (C0–CF, menos C4, C8 e CC).
  if (b(0) !== 0xff || b(1) !== 0xd8) return null;
  var i = 2;
  while (i + 9 < bytes.length) {
    if (b(i) !== 0xff) { i++; continue; }
    var m = b(i + 1);
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    var tam = b(i + 2) << 8 | b(i + 3);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { altura: b(i + 5) << 8 | b(i + 6), largura: b(i + 7) << 8 | b(i + 8) };
    }
    i += 2 + tam;
  }
  return null;
}
