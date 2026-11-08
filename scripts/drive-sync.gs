/**
 * SP Car Clean — fotos do Drive para o site, sozinho.
 *
 * Roda no Apps Script, na conta Google que é dona das pastas. Assim não existe
 * conta de serviço, nem chave JSON, nem projeto no Google Cloud — a documentação
 * do Google recomenda evitar chave de conta de serviço justamente para carga que
 * roda fora do Google Cloud, e a nossa Lambda está na AWS.
 *
 * NÃO PRECISA CRIAR PASTA NENHUMA. A fonte são as pastas de serviço que já
 * existem dentro de "SP Car Clean_Fotos Instagram". A pasta é o serviço, e é
 * dela que sai a legenda que o cliente lê no site.
 *
 * COMO INSTALAR
 *
 *  1. script.google.com → Novo projeto → cole este arquivo inteiro
 *  2. Serviços (+) → "Drive API" → Adicionar     (precisa para a miniatura)
 *  3. Configurações do projeto → Propriedades do script → adicione:
 *
 *       ENDPOINT     https://spcarclean.com.br/api/drive-sync
 *       SEGREDO      (o mesmo valor que está no SSM)
 *       PASTA_RAIZ   (id da pasta "SP Car Clean_Fotos Instagram")
 *
 *       IGNORAR      (opcional) nomes de pasta a pular, separados por vírgula
 *
 *  4. Rode `testar()`. Ele NÃO envia nada: lista exatamente o que entraria, de
 *     qual pasta, com qual legenda, e o tamanho real de cada miniatura.
 *     Leia essa lista antes de ligar o gatilho — é a curadoria, e quem conhece
 *     as fotos é você.
 *  5. Se a lista estiver boa: Gatilhos (⏰) → Adicionar gatilho → função
 *     `sincronizar`, origem "Baseado no tempo", diariamente.
 *
 * ONDE CADA FOTO VAI
 *
 *   mesma pasta + mesmo nome base, com "antes" e "depois"
 *        → cartão de antes e depois (os dois JUNTOS, mesmo processo)
 *   foto de resultado
 *        → carrossel, VARIADO: no máximo MAX_POR_PASTA por serviço, intercalando
 *          as pastas, para o carrossel não virar oito fotos do mesmo serviço
 *
 * O QUE NUNCA ENTRA
 *
 *   • foto com "antes" no nome e sem par "depois" — carro sujo não é resultado
 *   • qualquer foto de pasta cujo NOME termina em "antes"
 *     (ex.: "Projeto PickupCorsa Uva Antes" — a pasta inteira é o antes)
 *   • foto com "processo" ou "andamento" no nome — serviço em andamento
 *   • as pastas "Unsplash" (banco de imagem de terceiros, não é trabalho seu) e
 *     "Arquivo"
 *   • vídeo. Não é esquecimento: vídeo de celular tem dezenas ou centenas de MB,
 *     e servir isso custaria o plano de dados de quem abre o site no celular.
 *     Reduzir exigiria transcodificar, que é ferramenta que o projeto não tem.
 *     O script avisa no log quando encontra um, em vez de ignorar calado.
 *
 * ATENÇÃO, e isto é o limite honesto do automático: foto com nome de câmera
 * (IMG_20261020_095116.jpg) não diz se é antes ou depois. O script a trata como
 * resultado. Se alguma foto de "antes" estiver com nome de câmera, ela vai
 * aparecer como resultado — por isso o `testar()` lista tudo com a pasta e o
 * nome, para você conferir uma vez. Renomear a foto, ou pôr a pasta no IGNORAR,
 * resolve.
 *
 * Foto já importada não entra de novo: o servidor guarda os ids já usados.
 */

/** Largura que pedimos ao Google. 1600 cobre tela de celular em 2x. */
var LARGURA = 1600;

/** Variedade do carrossel: teto por serviço e teto geral. */
var MAX_POR_PASTA = 2;
var MAX_CARROSSEL = 12;

/** Pastas que nunca são fonte, independente do IGNORAR. */
var PASTAS_FORA = ['unsplash', 'arquivo'];

/** Extensões que o navegador exibe. HEIC fica fora: Chrome e Firefox não abrem. */
var IMAGENS = ['jpg', 'jpeg', 'png', 'webp'];
var VIDEOS = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'];

// ---------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------

/** Execução de verdade. É esta que o gatilho diário chama. */
function sincronizar() { executar(false); }

/** Ensaio: não envia nada, só lista o que entraria. Rode esta primeiro. */
function testar() { executar(true); }

// ---------------------------------------------------------------------

function cfg(nome, opcional) {
  var v = PropertiesService.getScriptProperties().getProperty(nome);
  if (!v && !opcional) throw new Error('Falta a propriedade do script: ' + nome);
  return v || '';
}

function executar(ensaio) {
  var endpoint = cfg('ENDPOINT');
  var segredo = cfg('SEGREDO');

  if (ensaio) Logger.log('ENSAIO — nada será enviado.');

  var estado = chamar(endpoint, segredo, { op: 'estado' });
  var jaImportados = {};
  (estado.ids || []).forEach(function (id) { jaImportados[id] = true; });
  Logger.log('Já no site: %s foto(s).\n', (estado.ids || []).length);

  var ignorar = cfg('IGNORAR', true).split(',').map(function (s) {
    return s.trim().toLowerCase();
  }).filter(Boolean);

  var pastas = subpastas(cfg('PASTA_RAIZ'), ignorar);
  var resumo = { carrossel: 0, pares: 0, pulados: 0, erros: 0, enviados: 0 };

  // ── 1. Pares de antes/depois, dentro de cada pasta ───────────────────
  // Mesmo processo = mesma pasta + mesmo nome base. Cruzar pastas juntaria o
  // "antes" de um carro com o "depois" de outro.
  var candidatasCarrossel = {};

  pastas.forEach(function (pasta) {
    var arquivos = listar(pasta.id);
    var grupos = {}, resultados = [];

    arquivos.forEach(function (f) {
      if (f.tipo === 'video') {
        Logger.log('  [%s] PULADO (vídeo, %s MB): %s', pasta.nome,
          (f.bytes / 1048576).toFixed(0), f.nome);
        resumo.pulados++;
        return;
      }
      if (f.tipo !== 'imagem') { resumo.pulados++; return; }
      if (emProcesso(f.nome)) {
        Logger.log('  [%s] PULADO (serviço em andamento): %s', pasta.nome, f.nome);
        resumo.pulados++;
        return;
      }

      var m = classificar(f.nome);
      if (m) {
        grupos[m.grupo] = grupos[m.grupo] || {};
        if (!grupos[m.grupo][m.lado]) grupos[m.grupo][m.lado] = f;
        else if (m.lado === 'depois' && !pasta.soAntes) resultados.push(f);
        return;
      }
      // Sem antes/depois no nome: é resultado, salvo se a PASTA é um "antes".
      if (pasta.soAntes) {
        Logger.log('  [%s] PULADO (pasta de "antes"): %s', pasta.nome, f.nome);
        resumo.pulados++;
        return;
      }
      resultados.push(f);
    });

    Object.keys(grupos).forEach(function (nome) {
      var g = grupos[nome];
      if (g.antes && g.depois) {
        enviarPar(pasta, nome, g, ensaio, endpoint, segredo, jaImportados, resumo);
        return;
      }
      if (g.depois && !pasta.soAntes) {
        resultados.push(g.depois);   // "depois" sozinho É resultado
      } else {
        Logger.log('  [%s] PULADO ("antes" sem par): %s', pasta.nome,
          (g.antes || g.depois).nome);
        resumo.pulados++;
      }
    });

    if (resultados.length) candidatasCarrossel[pasta.nome] = { pasta: pasta, fotos: resultados };
  });

  // ── 2. Carrossel variado: intercala as pastas ────────────────────────
  var escolhidas = intercalar(candidatasCarrossel, MAX_POR_PASTA, MAX_CARROSSEL);
  Logger.log('');
  escolhidas.forEach(function (item) {
    if (jaImportados[item.foto.id]) return;
    resumo.enviados++;
    try {
      var foto = miniatura(item.foto);
      Logger.log('  CARROSSEL  [%s]  %s  → %s KB  (legenda: "%s")',
        item.pasta.nome, item.foto.nome, Math.round(foto.bytes / 1024), item.legenda);
      if (ensaio) { resumo.carrossel++; return; }
      chamar(endpoint, segredo, {
        op: 'carrossel',
        arquivoId: item.foto.id,
        nome: item.foto.nome,
        legenda: item.legenda,
        conteudoBase64: foto.base64,
      });
      resumo.carrossel++;
    } catch (e) {
      Logger.log('  ERRO em %s: %s', item.foto.nome, e.message);
      resumo.erros++;
    }
  });

  Logger.log('');
  if (!resumo.enviados && !resumo.pares) Logger.log('Nada novo para importar.');
  Logger.log('=== %s: %s no carrossel, %s par(es), %s pulado(s), %s erro(s)',
    ensaio ? 'ENSAIO' : 'FEITO', resumo.carrossel, resumo.pares, resumo.pulados, resumo.erros);
  if (ensaio) {
    Logger.log('Nada foi enviado. Confira a lista acima — se estiver boa, crie o gatilho diário.');
  }
}

function enviarPar(pasta, nome, g, ensaio, endpoint, segredo, jaImportados, resumo) {
  if (jaImportados[g.antes.id] || jaImportados[g.depois.id]) return;
  resumo.enviados++;
  var legenda = legendaDe(pasta.nome, nome);
  try {
    var a = miniatura(g.antes);
    var d = miniatura(g.depois);
    Logger.log('  ANTES/DEPOIS  [%s]  "%s"  → %s + %s KB  (legenda: "%s")',
      pasta.nome, nome, Math.round(a.bytes / 1024), Math.round(d.bytes / 1024), legenda);
    if (ensaio) { resumo.pares++; return; }
    chamar(endpoint, segredo, {
      op: 'antes-depois',
      legenda: legenda,
      antes: { arquivoId: g.antes.id, nome: g.antes.nome, conteudoBase64: a.base64 },
      depois: { arquivoId: g.depois.id, nome: g.depois.nome, conteudoBase64: d.base64 },
    });
    resumo.pares++;
  } catch (e) {
    Logger.log('  ERRO no par "%s" [%s]: %s', nome, pasta.nome, e.message);
    resumo.erros++;
  }
}

/**
 * Intercala as pastas para o carrossel ficar variado.
 *
 * Pegar as N mais recentes daria oito fotos do serviço que foi fotografado por
 * último. Aqui cada rodada pega uma de cada pasta, até o teto por pasta e o teto
 * geral — então o carrossel mostra a variedade de serviços, que é o que a
 * vitrine precisa dizer.
 */
function intercalar(porPasta, maxPorPasta, maxTotal) {
  var nomes = Object.keys(porPasta).sort();
  var saida = [];
  for (var rodada = 0; rodada < maxPorPasta && saida.length < maxTotal; rodada++) {
    for (var i = 0; i < nomes.length && saida.length < maxTotal; i++) {
      var grupo = porPasta[nomes[i]];
      var foto = grupo.fotos[rodada];
      if (!foto) continue;
      saida.push({ pasta: grupo.pasta, foto: foto, legenda: legendaDe(grupo.pasta.nome, foto.nome) });
    }
  }
  return saida;
}

/** Subpastas da raiz que servem como fonte. */
function subpastas(idRaiz, ignorar) {
  var it = DriveApp.getFolderById(idRaiz).getFolders();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    var nome = f.getName().trim();
    var chave = nome.toLowerCase();
    if (PASTAS_FORA.indexOf(chave) !== -1 || ignorar.indexOf(chave) !== -1) {
      Logger.log('Pasta ignorada: %s', nome);
      continue;
    }
    out.push({
      id: f.getId(),
      nome: nome,
      // Pasta cujo nome termina em "antes": tudo dentro é foto de antes.
      soAntes: /\bantes\s*$/i.test(nome),
    });
  }
  out.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  Logger.log('Pastas usadas: %s', out.map(function (p) {
    return p.nome + (p.soAntes ? ' (só antes)' : '');
  }).join(' · '));
  return out;
}

/** Arquivos da pasta, do mais novo para o mais antigo. */
function listar(idPasta) {
  var it = DriveApp.getFolderById(idPasta).getFiles();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    var nome = f.getName();
    var ext = String(nome.split('.').pop() || '').toLowerCase();
    out.push({
      id: f.getId(), nome: nome, bytes: f.getSize(), em: f.getDateCreated(),
      tipo: IMAGENS.indexOf(ext) !== -1 ? 'imagem' : (VIDEOS.indexOf(ext) !== -1 ? 'video' : 'outro'),
    });
  }
  out.sort(function (a, b) { return b.em - a.em; });
  return out;
}

/** Serviço em andamento não é resultado. */
function emProcesso(nome) {
  return /\b(em\s+)?(processo|andamento|aplicando|fazendo)\b/i.test(limparPrefixos(nome));
}

/**
 * "Up Antes.jpg" → { grupo: "up", lado: "antes" }
 * "fusca-preto depois 3.jpg" → { grupo: "fusca-preto", lado: "depois" }
 *
 * Só reconhece a palavra no FIM do nome (antes de "de costas"/"costas" e de uma
 * numeração opcional). Nome que não traz isso não é classificado.
 */
function classificar(nome) {
  var semExt = limparPrefixos(nome).replace(/\.[^.]*$/, '');
  var m = semExt.match(/^(.*?)[\s_-]*(antes|depois)[\s_-]*(?:de\s+costas|costas)?[\s_-]*(\d+)?$/i);
  if (!m) return null;
  var grupo = String(m[1] || '').trim().toLowerCase().replace(/[\s_-]+$/, '');
  if (!grupo) return null;
  return { grupo: grupo, lado: m[2].toLowerCase() };
}

/** Tira o ruído que o Drive e o WhatsApp acrescentam ao nome. */
function limparPrefixos(nome) {
  return String(nome)
    .replace(/^c[óo]pia\s+de\s+/i, '')
    .replace(/^copy\s+of\s+/i, '')
    .replace(/\s*\(\d+\)\s*$/, '');
}

/**
 * Legenda que o cliente lê no site.
 *
 * A PASTA manda, porque ela é o serviço: "Polimento Carro" diz algo, e
 * "Img 20261020 095116" não diz nada. O nome do arquivo só entra quando
 * acrescenta informação — o carro, por exemplo: "Polimento Carro — Fusca preto".
 */
function legendaDe(nomePasta, nomeArquivo) {
  var servico = String(nomePasta || '').trim();
  var detalhe = limparPrefixos(nomeArquivo || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\b(antes|depois)\b\s*/gi, ' ')
    .replace(/\s*\bde\s+costas\b\s*/gi, ' ')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  var inutil = !detalhe
    || /^(img|vid|dsc|pxl|photo|image|wa)\b/i.test(detalhe)
    || /^\d+$/.test(detalhe)
    || detalhe.toLowerCase() === servico.toLowerCase();

  if (!servico) return inutil ? 'SP Car Clean' : maiuscula(detalhe);
  if (inutil) return servico;
  return servico + ' — ' + maiuscula(detalhe);
}

function maiuscula(s) {
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
  var bytes = resp.getBlob().getBytes();
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
