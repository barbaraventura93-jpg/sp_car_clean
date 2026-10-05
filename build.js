const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const key           = process.env.FIREBASE_API_KEY;
const ejsService    = process.env.EMAILJS_SERVICE_ID  || '';
const ejsPublicKey  = process.env.EMAILJS_PUBLIC_KEY  || '';

if (!key) {
  console.error('Erro: variável FIREBASE_API_KEY não definida (no CI vem dos Secrets do GitHub).');
  process.exit(1);
}

fs.mkdirSync('dist', { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('%%FIREBASE_API_KEY%%',   key);
html = html.replace('%%EMAILJS_SERVICE_ID%%', ejsService);
html = html.replace('%%EMAILJS_PUBLIC_KEY%%', ejsPublicKey);

// Versão dos assets: hash do conteúdo de app.js + styles.css. Vai como ?v= na URL
// (o S3 serve esses arquivos com cache de 7 dias — URL nova = navegador baixa de novo)
// e no CACHE_VERSION do service worker (sw.js muda → SW novo apaga os caches antigos).
const hash = crypto.createHash('sha256');
for (const f of ['app.js', 'styles.css']) hash.update(fs.readFileSync(f));
const version = hash.digest('hex').slice(0, 10);

function replaceOnce(src, from, to, file) {
  if (!src.includes(from)) {
    console.error(`Erro: "${from}" não encontrado em ${file} — não foi possível versionar os assets.`);
    process.exit(1);
  }
  return src.replace(from, to);
}

html = replaceOnce(html, 'href="styles.css"', `href="styles.css?v=${version}"`, 'index.html');
html = replaceOnce(html, 'src="app.js"',      `src="app.js?v=${version}"`,      'index.html');
fs.writeFileSync(path.join('dist', 'index.html'), html);

const sw = replaceOnce(fs.readFileSync('sw.js', 'utf8'), "'spcc-v1'", `'spcc-${version}'`, 'sw.js');
fs.writeFileSync(path.join('dist', 'sw.js'), sw);

for (const f of ['manifest.webmanifest', 'styles.css', 'app.js']) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join('dist', f));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

copyDir('assets', path.join('dist', 'assets'));

console.log(`Build concluído (assets v=${version}) — dist/ pronto para publicação.`);
