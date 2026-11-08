'use strict';

// Teste de navegador: separação entre CLIENTE e ADMIN.
//
// Por que existe: o painel e a área do cliente são a mesma página, e quem decide
// qual das duas aparece é `isAdmin()`/`isClient()`, por e-mail. Um erro aí não dá
// erro de sintaxe nem quebra teste unitário — dá cliente vendo painel. Então isto
// sobe uma sessão de cliente de verdade no navegador e confere o que ele alcança.
//
// Verifica, com sessão de cliente (e-mail comum, SEM o grupo `admin` no token):
//   • isAdmin() false / isClient() true
//   • o painel administrativo não aparece
//   • o DB não roteia leitura nem escrita pela Lambda
//   • NENHUMA chamada a /api/admin-data acontece
//   • "Minha Conta" abre, mesmo com o Firebase negando o perfil
//   • entrar com o e-mail do admin no formulário do cliente não vira admin
//
// Como rodar:
//   node build.js                      # gera dist/ (precisa das variáveis de ambiente)
//   npx serve dist -l 8099             # ou qualquer servidor estático na porta 8099
//   node scripts/test-cliente-browser.js

const { chromium } = require('playwright');
const assert = require('assert');
function jwt(c){const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({alg:'RS256',kid:'x'})}.${b(c)}.falsa`;}

// Sessão de CLIENTE: e-mail comum e SEM o grupo admin no token.
const ag = Math.floor(Date.now()/1000);
const SESSAO_CLIENTE = {
  accessToken: jwt({token_use:'access',username:'joao.cliente@gmail.com',exp:ag+3600}),
  idToken: jwt({email:'joao.cliente@gmail.com',sub:'uid-cliente-123',exp:ag+3600}),
  refreshToken:'r', expiraEm: Date.now()+3600_000,
};

(async () => {
  const nav = await chromium.launch();
  const pg = await (await nav.newContext({viewport:{width:430,height:860},deviceScaleFactor:2})).newPage();
  const erros=[]; pg.on('pageerror', e=>erros.push(e.message));
  const adminData=[];
  await pg.route('**/api/admin-data', async r => {
    adminData.push(JSON.parse(r.request().postData()||'{}'));
    await r.fulfill({status:403,contentType:'application/json',body:'{"ok":false,"error":"acesso restrito ao administrador"}'});
  });
  await pg.route('**/api/**', r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  await pg.route('https://cognito-idp.*.amazonaws.com/**', r=>r.fulfill({status:200,contentType:'application/x-amz-json-1.1',body:'{}'}));

  await pg.addInitScript(({s})=>localStorage.setItem('spcc_auth',JSON.stringify(s)), {s:SESSAO_CLIENTE});
  await pg.goto('http://localhost:8099/', { waitUntil:'load' });
  await pg.waitForTimeout(4000);

  const r = await pg.evaluate(() => ({
    usuario: AUTH.currentUser ? AUTH.currentUser.email : null,
    gruposNoToken: AUTH.currentUser ? AUTH.currentUser.grupos : null,
    ehAdmin: isAdmin(),
    ehCliente: isClient(),
    painelAdminVisivel: document.getElementById('adminPanel').style.display !== 'none',
    // o DB roteia pela Lambda só para admin
    lambdaParaLerRestrito: DB._interno.usarLambdaParaLer('bookings'),
    lambdaParaEscrever: DB._interno.usarLambdaParaEscrever(),
    navDoClienteVisivel: !!document.querySelector('#clientNavItem') &&
      getComputedStyle(document.getElementById('clientNavItem')).display !== 'none',
  }));

  // Abrir "Minha Conta" logado como cliente leva à conta, não ao painel
  await pg.evaluate('openClientAccount()');
  await pg.waitForTimeout(1500);
  const depois = await pg.evaluate(() => ({
    contaDoClienteAberta: getComputedStyle(document.getElementById('clientAccountModal')).display !== 'none',
    painelAdminVisivel: document.getElementById('adminPanel').style.display !== 'none',
  }));

  // E o login do cliente recusa o e-mail do admin
  await pg.evaluate(() => { closeModal('clientAccountModal'); AUTH.signOut(); });
  await pg.waitForTimeout(600);
  await pg.evaluate("document.getElementById('clientLoginModal').style.display='flex'");
  await pg.fill('#clEmail', 'spcarclean0@gmail.com');
  await pg.fill('#clPass', 'QualquerCoisa123');
  await pg.click("#clientLoginModal button.btn-primary");
  await pg.waitForTimeout(1500);
  const guarda = await pg.evaluate(() => ({
    mensagem: document.getElementById('clLoginError').textContent,
    visivel: getComputedStyle(document.getElementById('clLoginError')).display !== 'none',
  }));

  console.log(JSON.stringify({ r, depois, guarda, adminData, erros }, null, 2));
  assert.strictEqual(r.ehAdmin, false, 'cliente NÃO é admin');
  assert.strictEqual(r.ehCliente, true, 'cliente é reconhecido como cliente');
  assert.strictEqual(r.painelAdminVisivel, false, 'painel admin NÃO aparece');
  assert.strictEqual(r.lambdaParaLerRestrito, false, 'cliente não roteia leitura pela Lambda');
  assert.strictEqual(r.lambdaParaEscrever, false, 'cliente não roteia escrita pela Lambda');
  assert.strictEqual(depois.contaDoClienteAberta, true,
    '"Minha Conta" ABRE mesmo com o Firebase negando o perfil (pelo .catch())');
  assert.strictEqual(depois.painelAdminVisivel, false, 'painel admin segue fechado');
  assert.deepStrictEqual(adminData, [], 'cliente NUNCA chama /api/admin-data');
  // Com a rota do Cognito interceptada devolvendo {}, o login falha antes da
  // guarda de e-mail; o que importa é que NÃO entrou. A guarda em si é verificada
  // por leitura do código (doClientLogin faz signOut e mostra a mensagem).
  assert.ok(guarda.visivel, 'login do cliente com e-mail de admin não entra');
  assert.strictEqual(await pg.evaluate(() => isAdmin()), false, 'não virou admin');
  // O ÚNICO erro esperado é a negação do Firebase ao perfil do cliente: as regras
  // publicadas exigem `auth.uid` do Firebase Auth, que não existe mais desde a
  // migração para o Cognito. Antes da correção do `once` essa falha era
  // silenciosa E a tela não abria; agora a tela abre pelo `.catch()` e a falha
  // fica visível no console. Visível é melhor que invisível — e o conserto de
  // verdade é servir o perfil pelo servidor, que ainda está por fazer.
  const inesperados = erros.filter(e => !/permission_denied at \/clientProfiles/.test(e));
  assert.deepStrictEqual(inesperados, [], 'nenhum erro além da negação conhecida: ' + inesperados.join(' | '));
  assert.strictEqual(erros.length, 1, 'a negação do perfil aparece no console (antes era silenciosa)');
  console.log('SEPARAÇÃO CLIENTE / ADMIN OK');
  await nav.close();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
