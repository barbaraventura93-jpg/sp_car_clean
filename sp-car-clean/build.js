const fs = require('fs');
const path = require('path');

const key           = process.env.FIREBASE_API_KEY;
const ejsService    = process.env.EMAILJS_SERVICE_ID  || '';
const ejsPublicKey  = process.env.EMAILJS_PUBLIC_KEY  || '';

if (!key) {
  console.error('Erro: variável FIREBASE_API_KEY não configurada no Netlify.');
  process.exit(1);
}

fs.mkdirSync('dist', { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('%%FIREBASE_API_KEY%%',   key);
html = html.replace('%%EMAILJS_SERVICE_ID%%', ejsService);
html = html.replace('%%EMAILJS_PUBLIC_KEY%%', ejsPublicKey);
fs.writeFileSync(path.join('dist', 'index.html'), html);

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

console.log('Build concluído — dist/ pronto para publicação.');
