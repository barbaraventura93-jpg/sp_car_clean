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
 * DUAS ORGANIZAÇÕES, as duas atendidas — a do Drive decide, não um palpite meu:
 *
 *   (a) fotos soltas na pasta do serviço, identificadas pelo NOME
 *       ("Up antes.jpg" + "Up depois.jpg")          ← é como está hoje
 *   (b) subpastas "Antes" e "Depois" dentro da pasta do serviço, e aí o nome do
 *       arquivo não precisa dizer nada: tudo que está em "Depois" é resultado,
 *       e pareia com o mesmo nome base em "Antes"
 *
 * Se as subpastas existirem, elas mandam. Se não, vale o nome do arquivo.
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
 * ONDE CADA FOTO VAI — o NOME declara, o script não adivinha
 *
 *   nome com "antes" E nome com "depois", mesmo nome base, mesma pasta
 *        → cartão de antes e depois (os dois JUNTOS, mesmo processo)
 *   nome com "depois", sem par "antes"
 *        → carrossel, VARIADO: no máximo MAX_POR_PASTA por serviço, intercalando
 *          as pastas, para o carrossel não virar oito fotos do mesmo serviço
 *   qualquer outro nome (IMG_20261020_095116.jpg, moto-tanque-preto-01.jpg…)
 *        → NÃO ENTRA
 *
 * A última linha é a regra mais importante deste arquivo. Nome de câmera não diz
 * se a foto é antes ou depois, e tratar "não sei" como "é resultado" é o que põe
 * foto de carro sujo na vitrine. Só entra o que o nome declara.
 *
 * O QUE NUNCA ENTRA
 *
 *   • foto cujo nome não diz "antes" nem "depois" — o script não adivinha
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
 * CONSEQUÊNCIA PRÁTICA: para uma foto entrar no carrossel, o nome dela precisa
 * ter "depois". Renomear é o que publica. O `testar()` conta quantas ficaram de
 * fora por isso, em cada pasta, para você saber onde vale renomear.
 *
 * Foto já importada não entra de novo: o servidor guarda os ids já usados.
 */

/** Largura que pedimos ao Google. 1600 cobre tela de celular em 2x. */
var LARGURA = 1600;

/**
 * Variedade do carrossel.
 *
 * `intercalar()` faz rodadas pegando uma foto de cada pasta, então a variedade
 * vem da ordem, não do teto. O teto por pasta serve só para um serviço não tomar
 * o carrossel inteiro quando tem muito mais foto nomeada que os outros.
 *
 * 4, e não 2, por um motivo medido: hoje as fotos com "depois" no nome estão
 * todas em "Lavagem Detalhada Carros". Com teto 2 o carrossel teria DUAS fotos —
 * menos que as 8 estáticas que o site já mostrava. Teto apertado só dá variedade
 * quando há de onde variar.
 */
var MAX_POR_PASTA = 4;
var MAX_CARROSSEL = 12;

/**
 * Teto por GRUPO (mesmo nome base, ou seja o mesmo carro/serviço).
 *
 * Medido no primeiro ensaio: sem isto o carrossel recebia
 * "fusca-preto depois 2, 3, 5 e 7" — quatro slides do MESMO Fusca preto, com a
 * legenda idêntica nos quatro. Teto por pasta não resolve, porque os quatro
 * estão na mesma pasta E são o mesmo carro.
 */
var MAX_POR_GRUPO = 2;

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
    // Organização (b): subpastas Antes/Depois. Tudo que está em "Depois" é
    // resultado, e pareia com o mesmo nome base em "Antes" — sem depender de a
    // palavra estar no nome do arquivo.
    if (pasta.subDepois || pasta.subAntes) {
      Logger.log('  [%s] usando as subpastas Antes/Depois', pasta.nome);
      var porNome = {};
      (pasta.subAntes ? listar(pasta.subAntes) : []).forEach(function (f) {
        if (f.tipo !== 'imagem') {
          Logger.log('  [%s/Antes] PULADO (não é imagem — o Drive diz "%s"): %s', pasta.nome, f.mime || 'tipo desconhecido', f.nome);
          resumo.pulados++;
          return;
        }
        var k = baseDoNome(f.nome);
        porNome[k] = porNome[k] || {};
        if (!porNome[k].antes) porNome[k].antes = f;
      });
      var resultadosSub = [];
      (pasta.subDepois ? listar(pasta.subDepois) : []).forEach(function (f) {
        if (f.tipo === 'video') {
          Logger.log('  [%s/Depois] PULADO (vídeo, %s MB): %s', pasta.nome,
            (f.bytes / 1048576).toFixed(0), f.nome);
          resumo.pulados++;
          return;
        }
        if (f.tipo !== 'imagem') {
          Logger.log('  [%s/Depois] PULADO (não é imagem — o Drive diz "%s"): %s', pasta.nome, f.mime || 'tipo desconhecido', f.nome);
          resumo.pulados++;
          return;
        }
        var k = baseDoNome(f.nome);
        porNome[k] = porNome[k] || {};
        f.grupo = k;
        if (!porNome[k].depois) { porNome[k].depois = f; } else { resultadosSub.push(f); }
      });
      Object.keys(porNome).forEach(function (k) {
        var g = porNome[k];
        if (g.antes && g.depois) enviarPar(pasta, k, g, ensaio, endpoint, segredo, jaImportados, resumo);
        else if (g.depois) { g.depois.grupo = k; resultadosSub.push(g.depois); }
        else { Logger.log('  [%s/Antes] PULADO (sem par em Depois): %s', pasta.nome, g.antes.nome); resumo.pulados++; }
      });
      if (resultadosSub.length) candidatasCarrossel[pasta.nome] = { pasta: pasta, fotos: resultadosSub };
      return;
    }

    // Organização (a): fotos soltas, identificadas pelo nome.
    var arquivos = listar(pasta.id);
    var grupos = {}, resultados = [], semNome = 0;

    arquivos.forEach(function (f) {
      if (f.tipo === 'video') {
        Logger.log('  [%s] PULADO (vídeo, %s MB): %s', pasta.nome,
          (f.bytes / 1048576).toFixed(0), f.nome);
        resumo.pulados++;
        return;
      }
      if (f.tipo !== 'imagem') {
        // Antes isto sumia em silêncio, e o relatório não fechava a conta: no
        // primeiro ensaio, 7 arquivos foram pulados sem nenhuma linha dizendo
        // por quê. HEIC de iPhone cai aqui, e é informação que importa.
        Logger.log('  [%s] PULADO (não é imagem nem vídeo — o Drive diz "%s"): %s',
          pasta.nome, f.mime || 'tipo desconhecido', f.nome);
        resumo.pulados++;
        return;
      }
      if (emProcesso(f.nome)) {
        Logger.log('  [%s] PULADO (serviço em andamento): %s', pasta.nome, f.nome);
        resumo.pulados++;
        return;
      }

      var m = classificar(f.nome);
      if (!m) {
        // O nome não declara o lado. Não entra — ver a regra no topo.
        semNome++;
        resumo.pulados++;
        return;
      }
      grupos[m.grupo] = grupos[m.grupo] || {};
      f.grupo = m.grupo;
      if (!grupos[m.grupo][m.lado]) {
        grupos[m.grupo][m.lado] = f;
      } else if (m.lado === 'depois' && !pasta.soAntes) {
        resultados.push(f);
      } else {
        // Segunda foto do MESMO lado (ex.: "Up Antes.jpg" e "Up Antes costas.jpg").
        // Antes era descartada calada; agora aparece, para a conta do relatório
        // fechar.
        Logger.log('  [%s] PULADO (já existe um "%s" para "%s"): %s',
          pasta.nome, m.lado, m.grupo, f.nome);
        resumo.pulados++;
      }
    });

    Object.keys(grupos).forEach(function (nome) {
      var g = grupos[nome];
      if (g.antes && g.depois) {
        enviarPar(pasta, nome, g, ensaio, endpoint, segredo, jaImportados, resumo);
        return;
      }
      if (g.depois && !pasta.soAntes) {
        g.depois.grupo = nome;
        resultados.push(g.depois);   // "depois" sozinho É resultado
      } else {
        Logger.log('  [%s] PULADO ("antes" sem par): %s', pasta.nome,
          (g.antes || g.depois).nome);
        resumo.pulados++;
      }
    });

    if (semNome) {
      Logger.log('  [%s] %s foto(s) fora: o nome não diz "antes" nem "depois"', pasta.nome, semNome);
    }
    if (resultados.length) candidatasCarrossel[pasta.nome] = { pasta: pasta, fotos: resultados };
  });

  // ── 2. Carrossel variado: intercala as pastas ────────────────────────
  var escolhidas = intercalar(candidatasCarrossel, MAX_POR_PASTA, MAX_CARROSSEL, MAX_POR_GRUPO);
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
function intercalar(porPasta, maxPorPasta, maxTotal, maxPorGrupo) {
  var nomes = Object.keys(porPasta).sort();
  var saida = [];
  var usadoNoGrupo = {};
  var limiteGrupo = maxPorGrupo || 99;
  // Cada pasta avança no próprio ritmo: se uma foto é recusada pelo teto do
  // grupo, a pasta tenta a seguinte em vez de perder a vez.
  var cursor = {};
  nomes.forEach(function (n) { cursor[n] = 0; });

  for (var rodada = 0; rodada < maxPorPasta && saida.length < maxTotal; rodada++) {
    for (var i = 0; i < nomes.length && saida.length < maxTotal; i++) {
      var g = porPasta[nomes[i]];
      var foto = null;
      while (cursor[nomes[i]] < g.fotos.length) {
        var candidata = g.fotos[cursor[nomes[i]]++];
        var chave = candidata.grupo || candidata.nome;
        if ((usadoNoGrupo[chave] || 0) >= limiteGrupo) continue;
        usadoNoGrupo[chave] = (usadoNoGrupo[chave] || 0) + 1;
        foto = candidata;
        break;
      }
      if (!foto) continue;
      saida.push({ pasta: g.pasta, foto: foto, legenda: legendaDe(g.pasta.nome, foto.nome) });
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
    // Duas organizações possíveis, e o script aceita as duas:
    //
    //   (a) as fotos soltas na pasta do serviço, identificadas pelo NOME
    //       ("Up antes.jpg" / "Up depois.jpg")  ← é como o Drive está hoje
    //   (b) subpastas "Antes" e "Depois" dentro da pasta do serviço
    //
    // Nenhuma das duas exige criar pasta: (a) funciona com o que já existe, e
    // (b) passa a valer sozinha se um dia a organização mudar.
    var dentro = pastasAntesDepois(f);
    out.push({
      id: f.getId(),
      nome: nome,
      // Pasta cujo nome termina em "antes": tudo dentro é foto de antes.
      soAntes: /\bantes\s*$/i.test(nome),
      subAntes: dentro.antes,
      subDepois: dentro.depois,
    });
  }
  out.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  Logger.log('Pastas usadas: %s', out.map(function (p) {
    return p.nome + (p.soAntes ? ' (só antes)' : '');
  }).join(' · '));
  return out;
}

/**
 * Procura subpastas "Antes" e "Depois" dentro de uma pasta de serviço.
 *
 * Existe porque a instrução admitia duas leituras — "as fotos de depois que
 * estão nas pastas" e "as pastas de Depois" — e escolher uma seria apostar. Com
 * as duas atendidas, a organização do Drive decide, não o meu palpite.
 */
function pastasAntesDepois(pastaServico) {
  var r = { antes: null, depois: null };
  var it = pastaServico.getFolders();
  while (it.hasNext()) {
    var sub = it.next();
    var n = sub.getName().trim().toLowerCase();
    if (n === 'antes') r.antes = sub.getId();
    else if (n === 'depois') r.depois = sub.getId();
  }
  return r;
}

/** Arquivos da pasta, do mais novo para o mais antigo. */
function listar(idPasta) {
  var it = DriveApp.getFolderById(idPasta).getFiles();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    var nome = f.getName();
    var mime = String(f.getMimeType() || '').toLowerCase();
    out.push({
      id: f.getId(), nome: nome, bytes: f.getSize(), em: f.getDateCreated(),
      mime: mime, tipo: tipoDe(nome, mime),
    });
  }
  out.sort(function (a, b) { return b.em - a.em; });
  return out;
}

// O tipo vem do MIME que o Drive guarda, nao da extensao no nome. No primeiro
// ensaio, quatro fotos boas ("1 - Higienizacao de tecido Antes" e companhia)
// foram descartadas so porque o nome nao tem ponto nenhum: split('.').pop()
// devolvia o nome inteiro como se fosse extensao. O Drive sabe o tipo real.
//
// HEIC de iPhone tambem passa a entrar, e isso e seguro: o que mandamos ao
// site e sempre a MINIATURA que o Drive gera (JPEG/PNG), nunca o arquivo
// original. O formato do original nunca chega ao navegador.
function tipoDe(nome, mime) {
  if (mime.indexOf('image/') === 0) return 'imagem';
  if (mime.indexOf('video/') === 0) return 'video';
  // MIME genérico ou ausente: cai na extensão, se houver uma de verdade.
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    var ext = extensaoDe(nome);
    if (ext && IMAGENS.indexOf(ext) !== -1) return 'imagem';
    if (ext && VIDEOS.indexOf(ext) !== -1) return 'video';
  }
  return 'outro';
}

// Só é extensão se houver ponto E o que vem depois for curto o bastante para
// ser uma extensão. "2 - Higienizacao de tecido Antes" não tem extensão.
function extensaoDe(nome) {
  var i = String(nome).lastIndexOf('.');
  if (i <= 0) return '';
  var ext = nome.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

/**
 * Nome base para parear entre as subpastas Antes e Depois.
 *
 * Tira extensão, ruído, numeração e as próprias palavras antes/depois — assim
 * "Fusca 1.jpg" em Antes casa com "Fusca 1.jpg" em Depois, e "Fusca antes.jpg"
 * casa com "Fusca depois.jpg" mesmo dentro das subpastas.
 */
function baseDoNome(nome) {
  return limparPrefixos(nome)
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\b(antes|depois)\b\s*/gi, ' ')
    .replace(/\s*\bde\s+costas\b\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Extensão do arquivo, para o relatório dizer por que algo não serve. */
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
