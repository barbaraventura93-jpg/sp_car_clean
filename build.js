const fs = require('fs');
const path = require('path');

const key           = process.env.FIREBASE_API_KEY;
const ejsService    = process.env.EMAILJS_SERVICE_ID  || '';
const ejsPublicKey  = process.env.EMAILJS_PUBLIC_KEY  || '';
const vapidKey      = process.env.FIREBASE_VAPID_KEY  || '';   // chave pública Web Push (não secreta)

if (!key) {
  console.error('Erro: variável FIREBASE_API_KEY não configurada no Netlify.');
  process.exit(1);
}

fs.mkdirSync('dist', { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('%%FIREBASE_API_KEY%%',   key);
html = html.replace('%%EMAILJS_SERVICE_ID%%', ejsService);
html = html.replace('%%EMAILJS_PUBLIC_KEY%%', ejsPublicKey);
html = html.replace('%%FIREBASE_VAPID_KEY%%', vapidKey);
fs.writeFileSync(path.join('dist', 'index.html'), html);

// PWA: service worker do FCM recebe a apiKey injetada; manifest e sw.js vão como estão.
let fcmSw = fs.readFileSync('firebase-messaging-sw.js', 'utf8');
fcmSw = fcmSw.replace('%%FIREBASE_API_KEY%%', key);
fs.writeFileSync(path.join('dist', 'firebase-messaging-sw.js'), fcmSw);

for (const f of ['sw.js', 'manifest.webmanifest']) {
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

console.log('Build concluído — dist/ pronto para publicação.');
