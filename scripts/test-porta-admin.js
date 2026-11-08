'use strict';

// Teste de navegador: a Área Restrita é a ÚNICA porta do painel.
//
// Por que existe: painel e área do cliente são a mesma página. O formulário de
// login do cliente já recusava o e-mail administrativo, mas o "Esqueci minha
// senha" de lá não — ele redefinia, logava e abria a gestão. Era uma segunda
// porta, aberta por descuido, e por um caminho que ninguém olha.
//
// Quatro casos:
//   1. Minha Conta + e-mail do admin   -> recusa, manda usar a Área Restrita,
//                                         não abre redefinição, não envia código
//   2. Minha Conta + e-mail de cliente -> funciona normalmente
//   3. Área Restrita                   -> funciona, origem marcada como 'admin'
//   4. fluxo de origem CLIENTE que termina com conta de admin
//                                      -> painel NÃO abre e a sessão é encerrada
//
// O caso 4 é a defesa em profundidade: o 1 barra na entrada, o 4 barra na saída.
//
// Como rodar:
//   node build.js                      # gera dist/ (precisa das variáveis de ambiente)
//   npx serve dist -l 8099             # ou qualquer servidor estático na porta 8099
//   node scripts/test-porta-admin.js

const { chromium } = require('playwright');
const assert = require('assert');
function jwt(c){const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({alg:'RS256',kid:'x'})}.${b(c)}.falsa`;}
const ag = Math.floor(Date.now()/1000);
const SESSAO_ADMIN = {
  accessToken: jwt({token_use:'access',username:'spcarclean0@gmail.com',exp:ag+3600}),
  idToken: jwt({email:'spcarclean0@gmail.com',sub:'uid-admin','cognito:groups':['admin'],exp:ag+3600}),
  refreshToken:'r', expiraEm: Date.now()+3600_000,
};

async function pagina(nav, sessao) {
  const pg = await (await nav.newContext()).newPage();
  const estado = { erros: [], cognito: [] };
  pg.on('pageerror', e => estado.erros.push(e.message));
  await pg.route('**/api/**', r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  await pg.route('https://cognito-idp.*.amazonaws.com/**', async rota => {
    const op = (rota.request().headers()['x-amz-target']||'').split('.').pop();
    estado.cognito.push(op);
    // InitiateAuth tem que devolver tokens de verdade: confirmarNovaSenha termina
    // fazendo login, e um corpo vazio aqui faz o fluxo cair no catch antes da
    // guarda que o teste quer exercitar.
    const corpo = op === 'InitiateAuth'
      ? JSON.stringify({ AuthenticationResult: {
            AccessToken: jwt({token_use:'access',username:'spcarclean0@gmail.com',exp:ag+3600}),
            IdToken:     jwt({email:'spcarclean0@gmail.com',sub:'uid-admin','cognito:groups':['admin'],exp:ag+3600}),
            RefreshToken:'r', ExpiresIn: 3600 } })
      : '{}';
    await rota.fulfill({status:200,contentType:'application/x-amz-json-1.1',body:corpo});
  });
  if (sessao) await pg.addInitScript(({s})=>localStorage.setItem('spcc_auth',JSON.stringify(s)), {s:sessao});
  await pg.goto('http://localhost:8099/', { waitUntil:'load' });
  await pg.waitForTimeout(2500);
  return { pg, estado };
}

(async () => {
  const nav = await chromium.launch();

  // ── 1. Pela Minha Conta, com o e-mail do admin: deve RECUSAR ──────────
  {
    const { pg, estado } = await pagina(nav, null);
    await pg.evaluate("document.getElementById('clientLoginModal').style.display='flex'");
    await pg.fill('#clEmail', 'spcarclean0@gmail.com');
    await pg.click('.client-forgot-link');
    await pg.waitForTimeout(1000);
    const r = await pg.evaluate(() => ({
      mensagem: document.getElementById('clLoginError').textContent,
      mensagemVisivel: getComputedStyle(document.getElementById('clLoginError')).display !== 'none',
      modalResetAberto: getComputedStyle(document.getElementById('pwResetModal')).display !== 'none',
      painelAberto: document.getElementById('adminPanel').style.display !== 'none',
    }));
    console.log('1) Minha Conta + e-mail do admin:', JSON.stringify(r), 'cognito:', estado.cognito);
    assert.ok(/Área Restrita/i.test(r.mensagem) && r.mensagemVisivel, 'manda usar a Área Restrita');
    assert.strictEqual(r.modalResetAberto, false, 'NÃO abre a redefinição');
    assert.strictEqual(r.painelAberto, false, 'NÃO abre o painel');
    assert.ok(!estado.cognito.includes('ForgotPassword'), 'não envia código: ' + estado.cognito);
    assert.deepStrictEqual(estado.erros, []);
    await pg.close();
  }

  // ── 2. Pela Minha Conta, com e-mail de cliente: deve FUNCIONAR ────────
  {
    const { pg, estado } = await pagina(nav, null);
    await pg.evaluate("document.getElementById('clientLoginModal').style.display='flex'");
    await pg.fill('#clEmail', 'joao.cliente@gmail.com');
    await pg.click('.client-forgot-link');
    await pg.waitForTimeout(1000);
    const r = await pg.evaluate(() => ({
      modalResetAberto: getComputedStyle(document.getElementById('pwResetModal')).display !== 'none',
      email: document.getElementById('prEmail').value,
    }));
    console.log('2) Minha Conta + e-mail de cliente:', JSON.stringify(r), 'cognito:', estado.cognito);
    assert.strictEqual(r.modalResetAberto, true, 'cliente comum continua recuperando senha');
    assert.strictEqual(r.email, 'joao.cliente@gmail.com');
    assert.ok(estado.cognito.includes('ForgotPassword'), 'envia o código');
    await pg.close();
  }

  // ── 3. Pela Área Restrita: deve FUNCIONAR (origem admin) ──────────────
  {
    const { pg, estado } = await pagina(nav, null);
    await pg.evaluate('openAdminLogin()');
    await pg.waitForTimeout(400);
    await pg.locator('#adminLoginModal a', { hasText:'Esqueci minha senha' }).click();
    await pg.waitForTimeout(1000);
    const r = await pg.evaluate(() => ({
      modalResetAberto: getComputedStyle(document.getElementById('pwResetModal')).display !== 'none',
      email: document.getElementById('prEmail').value,
      origem: _pwOrigem,
    }));
    console.log('3) Área Restrita:', JSON.stringify(r), 'cognito:', estado.cognito);
    assert.strictEqual(r.modalResetAberto, true);
    assert.strictEqual(r.email, 'spcarclean0@gmail.com');
    assert.strictEqual(r.origem, 'admin', 'origem marcada como admin');
    assert.ok(estado.cognito.includes('ForgotPassword'));
    await pg.close();
  }

  // ── 4. Defesa em profundidade: fluxo de origem CLIENTE que termina com
  //       conta de admin não pode abrir o painel ────────────────────────
  {
    const { pg, estado } = await pagina(nav, SESSAO_ADMIN);
    const antes = await pg.evaluate(() => isAdmin());
    await pg.evaluate("closeModal('adminPanel'); document.getElementById('adminPanel').style.display='none'; openPasswordReset('spcarclean0@gmail.com')"); // sem origem = cliente
    await pg.waitForTimeout(600);
    await pg.fill('#prCode', '123456');
    await pg.fill('#prPass', 'SenhaNova123');
    await pg.fill('#prPass2', 'SenhaNova123');
    await pg.click('#prSubmit');
    await pg.waitForTimeout(1500);
    const r = await pg.evaluate(() => ({
      origem: _pwOrigem,
      painelAberto: document.getElementById('adminPanel').style.display !== 'none',
      aindaLogado: AUTH.currentUser !== null,
      mensagem: document.getElementById('prOk').textContent,
      erro: document.getElementById('prError').textContent,
    }));
    console.log('4) origem cliente + conta admin:', JSON.stringify({ eraAdmin: antes, ...r }));
    assert.strictEqual(antes, true, 'a sessão começou como admin');
    assert.strictEqual(r.origem, 'cliente');
    assert.strictEqual(r.painelAberto, false, 'painel NÃO abre por fluxo de cliente');
    assert.strictEqual(r.aindaLogado, false, 'a sessão é encerrada');
    assert.ok(/Área Restrita/i.test(r.mensagem), 'explica onde entrar: ' + r.mensagem);
    await pg.close();
  }

  console.log('\nÁREA RESTRITA: PORTA ÚNICA OK');
  await nav.close();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
