'use strict';

// Quem é o dono do token — functions/lib/admin-auth.js.
//
// Por que existe: tudo que separa "meus dados" de "dados de qualquer um", e
// "admin" de "cliente", passa por este arquivo, e ele não tinha teste. A
// revisão de 09/11/2026 (achado S-12, confirmado na AWS em 14/11) encontrou o
// servidor lendo o campo `username` do token como se fosse o e-mail. Neste
// pool o `username` é um identificador interno: o cliente logado nunca era
// reconhecido pelo e-mail, e o perfil era salvo com esse código no lugar.
//
// Sem rede: o teste gera o próprio par de chaves, assina os tokens e faz o
// papel do Cognito (chaves públicas e GetUser) com um dublê de `fetch`.

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const POOL = 'sa-east-1_TESTEPOOL';
const CLIENTE = 'cliente-web-de-teste';
const ISS = `https://cognito-idp.sa-east-1.amazonaws.com/${POOL}`;
process.env.COGNITO_USER_POOL_ID = POOL;
process.env.COGNITO_CLIENT_ID = CLIENTE;
process.env.ADMIN_EMAIL = 'admin@exemplo.invalid';
process.env.FIREBASE_API_KEY = 'chave-antiga'; // presente de propósito: o caminho antigo não pode mais ser usado

const par = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const outroPar = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = { keys: [{ ...par.publicKey.export({ format: 'jwk' }), kid: 'chave-1', alg: 'RS256', use: 'sig' }] };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const agora = () => Math.floor(Date.now() / 1000);
const UUID = '0f1e2d3c-aaaa-bbbb-cccc-1234567890ab';
function token(corpo = {}, { cabecalho = {}, chave = par.privateKey, assinatura } = {}) {
  const h = b64({ alg: 'RS256', kid: 'chave-1', ...cabecalho });
  const c = b64({ sub: UUID, username: UUID, iss: ISS, client_id: CLIENTE, token_use: 'access', iat: agora() - 10, exp: agora() + 3600, ...corpo });
  const s = assinatura !== undefined ? assinatura : crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), chave).toString('base64url');
  return `${h}.${c}.${s}`;
}

let cognito; // token -> resposta do GetUser
let chamadasGetUser, chamadasFirebase;
global.fetch = async (url, opt = {}) => {
  if (url === `${ISS}/.well-known/jwks.json`) return { ok: true, status: 200, json: async () => JWKS };
  if (url === 'https://cognito-idp.sa-east-1.amazonaws.com/') {
    assert.strictEqual(opt.headers['X-Amz-Target'], 'AWSCognitoIdentityProviderService.GetUser');
    chamadasGetUser++;
    const r = cognito(JSON.parse(opt.body).AccessToken);
    if (r === 'erro') throw new Error('rede fora');
    if (!r) return { ok: false, status: 400, json: async () => ({ __type: 'NotAuthorizedException' }) };
    return { ok: true, status: 200, json: async () => ({ Username: UUID, UserAttributes: r }) };
  }
  if (url.includes('identitytoolkit.googleapis.com')) { chamadasFirebase++; return { ok: true, status: 200, json: async () => ({ users: [{ localId: 'x', email: 'admin@exemplo.invalid' }] }) }; }
  throw new Error('o teste não pode sair para a rede: ' + url);
};
const attrs = (email, verificado = 'true') => [{ Name: 'sub', Value: UUID }, { Name: 'email', Value: email }, { Name: 'email_verified', Value: verificado }];

const auth = require(path.resolve(__dirname, '../functions/lib/admin-auth.js'));
const { ehDono } = require(path.resolve(__dirname, '../functions/me.js'))._interno;

(async () => {
  chamadasGetUser = 0; chamadasFirebase = 0;
  cognito = () => attrs('Cliente@Exemplo.invalid');

  // ── Token válido ────────────────────────────────────────────────────────
  const bom = token();
  const v = await auth.verificarTokenCognito(bom);
  assert.strictEqual(v.uid, UUID);
  assert.deepStrictEqual(v.grupos, []);

  // ── Tokens que não podem passar ─────────────────────────────────────────
  const recusados = {
    'vazio': '',
    'sem três partes': 'a.b',
    'lixo': 'isto.nao.e-um-token',
    'algoritmo "none"': token({}, { cabecalho: { alg: 'none' }, assinatura: '' }),
    'algoritmo HS256 assinado com a chave pública': (() => {
      const h = b64({ alg: 'HS256', kid: 'chave-1' }); const c = b64({ sub: UUID, iss: ISS, client_id: CLIENTE, token_use: 'access', exp: agora() + 3600 });
      return `${h}.${c}.${crypto.createHmac('sha256', par.publicKey.export({ type: 'spki', format: 'pem' })).update(`${h}.${c}`).digest('base64url')}`;
    })(),
    'assinado por outra chave': token({}, { chave: outroPar.privateKey }),
    'kid desconhecido': token({}, { cabecalho: { kid: 'outra' } }),
    'sem kid': token({}, { cabecalho: { kid: undefined } }),
    'vencido': token({ exp: agora() - 3600 }),
    'sem validade': token({ exp: undefined }),
    'emitido no futuro': token({ iat: agora() + 3600 }),
    'de outro pool': token({ iss: 'https://cognito-idp.sa-east-1.amazonaws.com/sa-east-1_OUTRO' }),
    'de outro aplicativo': token({ client_id: 'outro-app' }),
    'id token no lugar do access token': token({ token_use: 'id' }),
    'corpo adulterado depois de assinar': (() => { const [h, , s] = bom.split('.'); return `${h}.${b64({ sub: UUID, iss: ISS, client_id: CLIENTE, token_use: 'access', exp: agora() + 3600, 'cognito:groups': ['admin'] })}.${s}`; })(),
  };
  for (const [rotulo, t] of Object.entries(recusados)) {
    assert.strictEqual(await auth.verificarTokenCognito(t), null, `token recusado: ${rotulo}`);
    assert.strictEqual(await auth.identificar(t), null, `identificar recusa: ${rotulo}`);
    assert.strictEqual(await auth.verifyAdmin(t), false, `não é admin: ${rotulo}`);
  }

  // ── Admin é quem tem o grupo, e só ──────────────────────────────────────
  assert.strictEqual(await auth.verifyAdmin(token({ 'cognito:groups': ['admin'] })), true);
  assert.strictEqual(await auth.verifyAdmin(token()), false, 'sem grupo não é admin');
  assert.strictEqual(await auth.verifyAdmin(token({ 'cognito:groups': ['clientes'] })), false);
  assert.strictEqual(await auth.verifyAdmin(token({ 'cognito:groups': 'admin' })), false, 'grupo tem que ser lista');
  // Ter o e-mail do admin não basta (era a regra do login antigo).
  cognito = () => attrs('admin@exemplo.invalid');
  assert.strictEqual(await auth.verifyAdmin(token({ jti: 'a1' })), false, 'e-mail de admin sem o grupo não dá acesso');
  assert.strictEqual(chamadasFirebase, 0, 'o login antigo (Firebase) não é mais consultado');

  // ── REGRESSÃO S-12: o e-mail vem do Cognito, não do `username` ──────────
  cognito = () => attrs('Cliente@Exemplo.invalid');
  let quem = await auth.identificar(token({ jti: 'b1' }));
  assert.strictEqual(quem.uid, UUID);
  assert.strictEqual(quem.email, 'cliente@exemplo.invalid', 'e-mail verificado, em minúsculas');
  assert.notStrictEqual(quem.email, UUID, 'o identificador interno nunca é o e-mail');
  assert.strictEqual(quem.origem, 'cognito');
  // Com isso o cliente passa a ser reconhecido no agendamento feito antes de criar a conta.
  assert.strictEqual(ehDono({ email: 'CLIENTE@exemplo.invalid' }, quem), true, 'dono pelo e-mail do agendamento');
  assert.strictEqual(ehDono({ email: 'outra@exemplo.invalid' }, quem), false, 'agendamento de outra pessoa');

  // E-mail NÃO verificado não vale: o cliente pode trocar o próprio atributo.
  cognito = () => attrs('vitima@exemplo.invalid', 'false');
  quem = await auth.identificar(token({ jti: 'b2' }));
  assert.strictEqual(quem.email, '', 'e-mail não verificado é ignorado');
  assert.strictEqual(ehDono({ email: 'vitima@exemplo.invalid' }, quem), false, 'não vira dono do agendamento da vítima');
  assert.strictEqual(ehDono({ email: '' }, quem), false, 'e-mail vazio dos dois lados não casa');
  assert.strictEqual(ehDono({ clientUid: UUID }, quem), true, 'continua dono pelo uid');

  // Cognito fora do ar, ou recusando o token: sem e-mail, nunca um palpite.
  for (const resposta of ['erro', null]) {
    cognito = () => resposta;
    quem = await auth.identificar(token({ jti: 'c' + resposta }));
    assert.ok(quem, 'o token continua válido');
    assert.strictEqual(quem.email, '', 'sem resposta do Cognito não há e-mail');
  }

  // ── O e-mail é guardado por alguns minutos, por token ───────────────────
  cognito = () => attrs('cliente@exemplo.invalid');
  const t1 = token({ jti: 'd1' });
  const antes = chamadasGetUser;
  await auth.identificar(t1); await auth.identificar(t1); await auth.identificar(t1);
  assert.strictEqual(chamadasGetUser - antes, 1, 'três chamadas com o mesmo token consultam o Cognito uma vez');
  await auth.identificar(token({ jti: 'd2' }));
  assert.strictEqual(chamadasGetUser - antes, 2, 'outro token consulta de novo');
  // verifyAdmin não precisa de e-mail: não gasta consulta.
  const antes2 = chamadasGetUser;
  await auth.verifyAdmin(token({ jti: 'd3', 'cognito:groups': ['admin'] }));
  assert.strictEqual(chamadasGetUser, antes2, 'checar admin não consulta o e-mail');

  // ── Sem pool configurado, ninguém entra ─────────────────────────────────
  delete process.env.COGNITO_USER_POOL_ID;
  assert.strictEqual(await auth.verificarTokenCognito(bom), null);
  assert.strictEqual(await auth.verifyAdmin(token({ 'cognito:groups': ['admin'] })), false);
  process.env.COGNITO_USER_POOL_ID = POOL;

  assert.strictEqual(auth.bearerToken({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.strictEqual(auth.bearerToken({ headers: {} }), '');
  assert.strictEqual(auth.lookupUser, undefined, 'a consulta ao login antigo foi removida');

  console.log('identidade: assinatura, admin pelo grupo e e-mail verificado — todos passaram');
})().catch((err) => { console.error(err); process.exit(1); });
