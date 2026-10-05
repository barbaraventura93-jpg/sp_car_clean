#!/usr/bin/env node
// Autoriza (uma vez) o acesso do backend ao Google Agenda do admin e grava as
// credenciais no SSM. Passo a passo completo: README → "Google Agenda".
//
// Uso:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-calendar-auth.js
//
// Abre o link no navegador, entre com spcarclean0@gmail.com e aceite. O script
// recebe o código em http://127.0.0.1:53682, troca pelo refresh token e mostra
// os comandos para gravar no SSM (ou grava direto, se o AWS CLI estiver logado).

'use strict';

const http = require('http');
const { execFileSync } = require('child_process');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SSM_PATH = process.env.SSM_PARAM_PATH || '/sp-car-clean/';
const REGION = process.env.AWS_REGION || 'sa-east-1';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (credencial OAuth do tipo "App para computador").');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  login_hint: 'spcarclean0@gmail.com'
});

function putParam(name, value) {
  execFileSync('aws', ['ssm', 'put-parameter', '--region', REGION, '--name', SSM_PATH + name,
    '--type', 'SecureString', '--overwrite', '--value', value], { stdio: 'ignore' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(url.searchParams.get('error') || 'sem código');
    return;
  }
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT, grant_type: 'authorization_code'
      })
    });
    const data = await resp.json();
    if (!data.refresh_token) throw new Error(JSON.stringify(data));

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h2>Pronto! Pode fechar esta aba e voltar ao terminal.</h2>');

    const params = {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN: data.refresh_token
    };
    try {
      for (const [k, v] of Object.entries(params)) putParam(k, v);
      console.log(`\n✅ Credenciais gravadas no SSM (${SSM_PATH}GOOGLE_*, região ${REGION}).`);
      console.log('   A sincronização começa sozinha em até 15 minutos.');
    } catch (_) {
      console.log('\n⚠️  Não consegui gravar no SSM com o AWS CLI. Rode estes comandos:\n');
      for (const [k, v] of Object.entries(params)) {
        console.log(`aws ssm put-parameter --region ${REGION} --name "${SSM_PATH}${k}" --type SecureString --overwrite --value '${v}'`);
      }
    }
  } catch (err) {
    res.writeHead(500).end('Falhou: ' + err.message);
    console.error('Falhou ao trocar o código pelo token:', err.message);
    process.exitCode = 1;
  }
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Abra este link no navegador e entre com a conta do Google do admin:\n');
  console.log(authUrl + '\n');
});
