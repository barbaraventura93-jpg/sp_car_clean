'use strict';

// `npm test` — roda TODOS os testes do projeto e sai com código diferente de
// zero se qualquer um falhar. É o que o deploy consulta antes de publicar.
//
// Dois grupos, descobertos sozinhos (arquivo novo `scripts/test-*.js` entra
// sem precisar ser cadastrado aqui):
//
//   puros      Node + assert, sem rede. Rodam direto.
//   navegador  usam o Playwright. Precisam do site gerado e servido em
//              localhost:8099 — este arquivo faz o build e sobe o servidor.
//
// `npm run test:rapido` roda só os puros (segundos, sem navegador).
//
// Nenhum teste fala com AWS, Firebase, InfinitePay ou e-mail. O build usa
// chaves de mentira: as de verdade só existem no GitHub Actions.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const PORTA = 8099;
const SO_PUROS = process.argv.includes('--rapido');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function descobrir() {
  const arquivos = fs.readdirSync(__dirname)
    .filter((f) => /^test-.*\.js$/.test(f))
    .sort();
  const puros = [];
  const navegador = [];
  for (const f of arquivos) {
    const usaNavegador = /require\(['"]playwright['"]\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    (usaNavegador ? navegador : puros).push(f);
  }
  return { puros, navegador };
}

// Assíncrono de propósito: o servidor local vive neste mesmo processo, e um
// spawnSync o deixaria mudo enquanto o teste de navegador espera a página.
function rodar(arquivo) {
  const inicio = Date.now();
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(__dirname, arquivo)], { cwd: RAIZ });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    const relogio = setTimeout(() => { saida += '\n[run-tests] tempo esgotado (180s)'; filho.kill('SIGKILL'); }, 180_000);
    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      const ok = codigo === 0;
      const seg = ((Date.now() - inicio) / 1000).toFixed(1);
      console.log(`${ok ? '  ok   ' : '  FALHA'}  ${arquivo}  (${seg}s)`);
      if (!ok) console.log((saida.trim() || 'sem saída').split('\n').map((l) => '         | ' + l).join('\n'));
      resolve(ok);
    });
  });
}

function gerarSite() {
  const r = spawnSync(process.execPath, ['build.js'], {
    cwd: RAIZ, encoding: 'utf8',
    env: {
      ...process.env,
      FIREBASE_API_KEY: 'chave-de-teste',
      EMAILJS_SERVICE_ID: 'servico-de-teste',
      EMAILJS_PUBLIC_KEY: 'chave-publica-de-teste',
    },
  });
  if (r.status !== 0) {
    console.log(`  FALHA  build.js\n${r.stdout || ''}${r.stderr || ''}`);
    return false;
  }
  return true;
}

function servir(pasta) {
  const servidor = http.createServer((req, res) => {
    let caminho = decodeURIComponent(req.url.split('?')[0]);
    if (caminho.endsWith('/')) caminho += 'index.html';
    const arquivo = path.join(pasta, caminho);
    // Nada fora da pasta servida, mesmo com `..` na URL.
    if (!arquivo.startsWith(pasta + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(arquivo, (err, dados) => {
      if (err) { res.writeHead(404); res.end('não encontrado'); return; }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
      res.end(dados);
    });
  });
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(PORTA, '127.0.0.1', () => resolve(servidor));
  });
}

(async () => {
  const { puros, navegador } = descobrir();
  const falhas = [];
  let total = 0;

  console.log(`\nTestes puros (${puros.length})`);
  for (const f of puros) { total++; if (!(await rodar(f))) falhas.push(f); }

  if (SO_PUROS) {
    console.log(`\nTestes de navegador: NÃO RODADOS (${navegador.length}) — modo rápido. Use \`npm test\` antes de enviar.`);
  } else {
    console.log(`\nTestes de navegador (${navegador.length})`);
    let playwrightOk = true;
    try { require.resolve('playwright'); } catch { playwrightOk = false; }
    if (!playwrightOk) {
      // Não é "pulado": sem navegador a rede de segurança tem um buraco, e o
      // comando tem que dizer isso com código de erro.
      console.log('  FALHA  Playwright não instalado. Rode `npm ci` e `npx playwright install chromium`.');
      falhas.push(...navegador);
      total += navegador.length;
    } else if (!gerarSite()) {
      falhas.push('build.js');
      total++;
    } else {
      let servidor;
      try {
        servidor = await servir(path.join(RAIZ, 'dist'));
      } catch (err) {
        console.log(`  FALHA  não consegui abrir a porta ${PORTA}: ${err.message}`);
        falhas.push('servidor local');
      }
      if (servidor) {
        for (const f of navegador) { total++; if (!(await rodar(f))) falhas.push(f); }
        await new Promise((r) => servidor.close(r));
      }
    }
  }

  console.log('');
  if (falhas.length) {
    console.log(`RESULTADO: ${falhas.length} falha(s) em ${total}: ${falhas.join(', ')}`);
    process.exit(1);
  }
  console.log(`RESULTADO: ${total} de ${total} passaram.`);
})();
