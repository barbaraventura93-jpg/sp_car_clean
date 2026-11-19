'use strict';

// Teste de navegador: a área do cliente pelo /api/me.
//
// Por que existe: as regras do banco liberam o dado do cliente por `auth.uid`,
// do Firebase Auth, que não existe mais desde a migração para o Cognito. Ler
// direto responde 401 e a tela "Minha Conta" abria vazia. O conserto foi mover
// essa leitura para o servidor — e o que mais importa verificar é que o cliente
// alcança SÓ o que é dele, e que o uid nunca sai do token.
//
// Verifica:
//   • "Minha Conta" abre com perfil e agendamentos vindos do /api/me, com token
//   • NENHUMA leitura direta de clientProfiles/bookingIndex no Firebase
//   • o uid NÃO vai no corpo de nenhuma chamada
//   • salvar o perfil não envia uid, email, points nem pointsHistory
//   • confirmar pagamento envia só o id — valor e pontos são do servidor
//
// Como rodar:
//   node build.js                      # gera dist/ (precisa das variáveis de ambiente)
//   npx serve dist -l 8099             # ou qualquer servidor estático na porta 8099
//   node scripts/test-me-browser.js

const { chromium } = require('playwright');
const assert = require('assert');
function jwt(c){const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({alg:'RS256',kid:'x'})}.${b(c)}.falsa`;}
const ag = Math.floor(Date.now()/1000);
const SESSAO = {
  accessToken: jwt({token_use:'access',username:'maria@ex.com',exp:ag+3600}),
  idToken: jwt({email:'maria@ex.com',sub:'uid-maria',exp:ag+3600}),
  refreshToken:'r', expiraEm: Date.now()+3600_000,
};

(async () => {
  const nav = await chromium.launch();
  const pg = await (await nav.newContext({viewport:{width:430,height:900},deviceScaleFactor:2})).newPage();
  const erros=[]; pg.on('pageerror', e=>erros.push(e.message));
  pg.on('console', m=>{ if(m.type()==='error') erros.push('console: '+m.text()); });

  const chamadas = [];
  const PERFIL = { uid:'uid-maria', email:'maria@ex.com', name:'Maria Alves', phone:'11999990000',
                   points: 380, address:{street:'Rua A',number:'10',bairro:'Centro'} };
  const MEUS = [
    { id:'SPC-A1', name:'Maria Alves', email:'maria@ex.com', clientUid:'uid-maria',
      status:'approved', date:'2026-11-25', startDate:'2026-11-25', endDate:'2026-11-26',
      price:380, finalPrice:380, service:'polimento-geral', car:'Civic', plate:'ABC1D23' },
  ];
  await pg.route('**/api/**', r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  // registrada DEPOIS: no Playwright a rota mais recente tem precedência
  await pg.route('**/api/me', async rota => {
    const c = JSON.parse(rota.request().postData()||'{}');
    const auth = rota.request().headers()['authorization']||'';
    chamadas.push({ op: c.op, dados: c.dados, temToken: auth.startsWith('Bearer ') });
    const resposta = c.op === 'perfil' ? PERFIL
                   : c.op === 'agendamentos' ? MEUS
                   : null;
    await rota.fulfill({status:200,contentType:'application/json',
      body: JSON.stringify({ ok:true, dados: resposta })});
  });
  // Qualquer leitura direta do Firebase a nó do cliente deve FALHAR o teste
  const diretoProibido = [];
  await pg.route('https://sp-car-clean-default-rtdb.firebaseio.com/**', async rota => {
    const u = rota.request().url();
    if (/clientProfiles|bookingIndex/.test(u)) diretoProibido.push(u.split('?')[0]);
    await rota.continue();
  });
  await pg.route('https://cognito-idp.*.amazonaws.com/**', r=>r.fulfill({status:200,contentType:'application/x-amz-json-1.1',body:'{}'}));

  await pg.addInitScript(({s})=>localStorage.setItem('spcc_auth',JSON.stringify(s)), {s:SESSAO});
  await pg.goto('http://localhost:8099/', { waitUntil:'load' });
  await pg.waitForTimeout(4000);
  await pg.evaluate('openClientAccount()');
  await pg.waitForTimeout(2500);

  const r = await pg.evaluate(() => ({
    contaAberta: getComputedStyle(document.getElementById('clientAccountModal')).display !== 'none',
    perfilCarregado: _clientProfile ? _clientProfile.name : null,
    pontos: _clientProfile ? _clientProfile.points : null,
    meusAgendamentos: typeof _getMyBookings === 'function' ? _getMyBookings().length : null,
    texto: (document.getElementById('clientAccountModal')||{}).innerText
      ? document.getElementById('clientAccountModal').innerText.slice(0, 300) : null,
  }));
  await pg.screenshot({ path: require('path').join(require('os').tmpdir(), 'spcc-minha-conta.png') });

  // ── salvar o perfil: o corpo não pode levar uid, email nem points ─────
  await pg.evaluate(() => {
    document.getElementById('cobName').value   = 'Maria Alves';
    document.getElementById('cobPhone').value  = '11999990000';
    document.getElementById('cobBairro').value = 'Centro';
    document.getElementById('cobStreet').value = 'Rua A';
  });
  const nSalvar = chamadas.length;
  await pg.evaluate(() => saveClientOnboarding());
  await pg.waitForTimeout(1500);
  const salvou = chamadas.slice(nSalvar).find(c => c.op === 'salvar-perfil');

  // ── confirmar pagamento: vai pelo servidor, com o id ──────────────────
  const nConf = chamadas.length;
  await pg.evaluate(() => customerConfirm('SPC-A1'));
  await pg.waitForTimeout(1500);
  const confirmou = chamadas.slice(nConf).find(c => c.op === 'confirmar-pagamento');

  console.log(JSON.stringify({ r, chamadas, diretoProibido, erros, salvou, confirmou }, null, 2));
  assert.ok(salvou, 'salvar-perfil chamado: ' + JSON.stringify(chamadas.slice(nSalvar)));
  assert.strictEqual(salvou.dados.name, 'Maria Alves');
  for (const proibido of ['uid', 'email', 'points', 'pointsHistory']) {
    assert.ok(!(proibido in salvou.dados), `"${proibido}" NÃO vai no corpo: ` + JSON.stringify(salvou.dados));
  }
  assert.ok(confirmou, 'confirmar-pagamento chamado pelo servidor');
  assert.deepStrictEqual(confirmou.dados, { id: 'SPC-A1' }, 'só o id — valor e pontos são do servidor');
  assert.strictEqual(confirmou.temToken, true);

  assert.strictEqual(r.contaAberta, true, '"Minha Conta" abre');
  assert.strictEqual(r.perfilCarregado, 'Maria Alves', 'perfil vindo do /api/me');
  assert.strictEqual(r.pontos, 380, 'pontos do servidor');
  assert.strictEqual(r.meusAgendamentos, 1, 'agendamento próprio na lista');
  assert.ok(chamadas.some(c => c.op === 'perfil' && c.temToken), 'perfil pedido com token');
  assert.ok(chamadas.some(c => c.op === 'agendamentos' && c.temToken), 'agendamentos pedidos com token');
  // o uid NUNCA vai no corpo
  assert.ok(chamadas.every(c => !c.dados || !('uid' in c.dados)), 'uid não vai no corpo: ' + JSON.stringify(chamadas));
  assert.deepStrictEqual(diretoProibido, [], 'nenhuma leitura direta de nó do cliente no Firebase');
  assert.deepStrictEqual(erros, [], erros.join(' | '));
  console.log('ÁREA DO CLIENTE PELO SERVIDOR: OK');
  await nav.close();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
