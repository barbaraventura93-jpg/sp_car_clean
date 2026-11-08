'use strict';

// =====================================================================
// AUTH — autenticação pelo Amazon Cognito, com a MESMA interface que o
// app.js já usava do Firebase Auth.
//
// Por que existe: em 08/11/2026 a chave de API do projeto Firebase foi
// apagada e o login quebrou para todos — `signInWithEmailAndPassword` passou
// a responder `auth/api-key-not-valid`. Sem console do projeto Google, não há
// como emitir chave nova. Ver docs/migracao-aws.md.
//
// A interface é deliberadamente igual à do Firebase:
//
//     AUTH.signInWithEmailAndPassword(email, senha)   -> { user }
//     AUTH.createUserWithEmailAndPassword(email, senha) -> { user }
//     AUTH.sendPasswordResetEmail(email)
//     AUTH.signOut()
//     AUTH.onAuthStateChanged(cb)
//     AUTH.currentUser        // { uid, email, displayName, getIdToken() }
//
// Assim a troca no app.js é `firebase.auth()` -> `AUTH`, e as 21 chamadas
// existentes continuam valendo. Os códigos de erro também são traduzidos para
// os do Firebase (`auth/email-already-in-use`, `auth/wrong-password`...),
// porque o app já ramifica em cima deles.
//
// Dois fluxos que o Cognito tem e o Firebase não tinha, e que exigem uma etapa
// a mais na interface (ver AUTH.confirmarCadastro e AUTH.confirmarNovaSenha):
//
//   - cadastro: o Cognito manda um CÓDIGO por e-mail e a conta só vale depois
//     de confirmada;
//   - redefinição de senha: o Cognito manda um CÓDIGO, não um link. Quem
//     recebe digita o código junto da senha nova.
//
// Sobre o protocolo: usa a API REST pública do Cognito, sem SDK e sem
// dependência nova. O fluxo USER_AUTH com desafio PASSWORD manda a senha para
// a AWS sobre HTTPS — é o que o SDK oficial faz em USER_PASSWORD_AUTH. O SRP
// seria melhor (a senha nunca sai do navegador), mas exige aritmética de
// inteiro grande e uma biblioteca; o projeto não tem bundler, e trazer um
// pacote por CDN para o caminho de login é troca de um risco por outro.
// =====================================================================

const AUTH = (function () {
  // Identificadores públicos, não segredos: vão no JS do navegador de
  // qualquer forma. Ficam fixos aqui pela mesma razão que `projectId` e
  // `appId` do Firebase estão fixos no app.js — só a chave de API vinha de
  // fora. `window.__ENV` sobrescreve, para apontar a outro pool sem editar
  // código (teste, ambiente novo).
  const PADRAO = {
    COGNITO_USER_POOL_ID: 'sa-east-1_HTZb1VsE9',
    COGNITO_CLIENT_ID: '60j21a5bpmd9jkt2dvakvd0o',
  };
  const env = (typeof window !== 'undefined' && window.__ENV) || {};
  const CLIENT_ID = env.COGNITO_CLIENT_ID || PADRAO.COGNITO_CLIENT_ID;
  const POOL_ID = env.COGNITO_USER_POOL_ID || PADRAO.COGNITO_USER_POOL_ID;
  const REGIAO = POOL_ID.split('_')[0] || 'sa-east-1';
  const ENDPOINT = `https://cognito-idp.${REGIAO}.amazonaws.com/`;
  const CHAVE_LOCAL = 'spcc_auth';

  let _sessao = null; // { accessToken, idToken, refreshToken, expiraEm }
  let _usuario = null;
  const _ouvintes = [];

  // --- erros: Cognito -> códigos do Firebase, que o app.js já trata ------
  const MAPA_ERRO = {
    UsernameExistsException: 'auth/email-already-in-use',
    NotAuthorizedException: 'auth/wrong-password',
    UserNotFoundException: 'auth/user-not-found',
    InvalidPasswordException: 'auth/weak-password',
    InvalidParameterException: 'auth/invalid-email',
    CodeMismatchException: 'auth/invalid-verification-code',
    ExpiredCodeException: 'auth/code-expired',
    LimitExceededException: 'auth/too-many-requests',
    TooManyRequestsException: 'auth/too-many-requests',
    TooManyFailedAttemptsException: 'auth/too-many-requests',
    PasswordResetRequiredException: 'auth/password-reset-required',
    UserNotConfirmedException: 'auth/user-not-confirmed',
  };

  const MENSAGEM = {
    'auth/email-already-in-use': 'Este e-mail já tem conta. Entre com sua senha.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/weak-password': 'Senha fraca: use ao menos 10 caracteres, com maiúscula, minúscula e número.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/invalid-verification-code': 'Código incorreto. Confira o e-mail e tente de novo.',
    'auth/code-expired': 'O código expirou. Peça um novo.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    'auth/password-reset-required': 'É preciso definir uma senha nova. Use "Esqueci minha senha".',
    'auth/user-not-confirmed': 'Confirme seu e-mail com o código que enviamos.',
  };

  function erro(nomeCognito, mensagemOriginal) {
    const code = MAPA_ERRO[nomeCognito] || 'auth/internal-error';
    const e = new Error(MENSAGEM[code] || mensagemOriginal || 'Falha na autenticação.');
    e.code = code;
    e.cognito = nomeCognito;
    return e;
  }

  async function chamar(operacao, corpo) {
    if (!CLIENT_ID) throw erro('InvalidParameterException', 'Cognito não configurado.');
    let resp;
    try {
      resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${operacao}`,
        },
        body: JSON.stringify(corpo),
      });
    } catch {
      const e = new Error('Sem conexão. Verifique a internet e tente de novo.');
      e.code = 'auth/network-request-failed';
      throw e;
    }
    const texto = await resp.text();
    const dados = texto ? JSON.parse(texto) : {};
    if (!resp.ok) {
      const nome = String(dados.__type || '').split('#').pop();
      throw erro(nome, dados.message);
    }
    return dados;
  }

  // --- sessão -----------------------------------------------------------
  function claims(idToken) {
    try {
      const p = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4)));
    } catch {
      return {};
    }
  }

  function montarUsuario() {
    if (!_sessao || !_sessao.idToken) return null;
    const c = claims(_sessao.idToken);
    return {
      uid: c.sub,
      email: String(c.email || '').toLowerCase(),
      displayName: c.name || '',
      emailVerified: c.email_verified === true,
      grupos: Array.isArray(c['cognito:groups']) ? c['cognito:groups'] : [],
      // Mesma assinatura do Firebase. Devolve o ACCESS token: é o que leva
      // `cognito:groups` e o que o admin-auth.js do servidor valida.
      getIdToken: async () => {
        await garantirValida();
        return _sessao ? _sessao.accessToken : null;
      },
    };
  }

  function salvar(resultado) {
    if (!resultado) {
      _sessao = null;
      _usuario = null;
      try { localStorage.removeItem(CHAVE_LOCAL); } catch {}
      notificar();
      return;
    }
    _sessao = {
      accessToken: resultado.AccessToken,
      idToken: resultado.IdToken,
      // Em refresh, o Cognito não devolve novo refresh token: mantém o atual.
      refreshToken: resultado.RefreshToken || (_sessao && _sessao.refreshToken) || '',
      expiraEm: Date.now() + (resultado.ExpiresIn || 3600) * 1000,
    };
    _usuario = montarUsuario();
    try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(_sessao)); } catch {}
    notificar();
  }

  function restaurar() {
    try {
      const bruto = localStorage.getItem(CHAVE_LOCAL);
      if (!bruto) return;
      const s = JSON.parse(bruto);
      if (s && s.idToken && s.refreshToken) {
        _sessao = s;
        _usuario = montarUsuario();
      }
    } catch {}
  }

  async function renovar() {
    if (!_sessao || !_sessao.refreshToken) {
      salvar(null);
      return false;
    }
    try {
      const r = await chamar('InitiateAuth', {
        ClientId: CLIENT_ID,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: _sessao.refreshToken },
      });
      if (r.AuthenticationResult) {
        salvar(r.AuthenticationResult);
        return true;
      }
    } catch {
      // refresh token revogado ou expirado: a sessão acabou.
    }
    salvar(null);
    return false;
  }

  // Renova com 5 min de folga: assim nenhuma chamada sai com token vencendo.
  async function garantirValida() {
    if (!_sessao) return false;
    if (Date.now() < _sessao.expiraEm - 300_000) return true;
    return renovar();
  }

  function notificar() {
    _ouvintes.forEach((cb) => {
      try { cb(_usuario); } catch (e) { console.error('onAuthStateChanged:', e); }
    });
  }

  // --- interface compatível com o Firebase Auth -------------------------

  async function signInWithEmailAndPassword(email, senha) {
    const r = await chamar('InitiateAuth', {
      ClientId: CLIENT_ID,
      AuthFlow: 'USER_AUTH',
      AuthParameters: {
        USERNAME: String(email).trim().toLowerCase(),
        PREFERRED_CHALLENGE: 'PASSWORD',
        PASSWORD: senha,
      },
    });

    // Conta criada pelo administrador, ou senha redefinida por ele: o Cognito
    // exige definir a senha antes de liberar a sessão.
    if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      const e = new Error('Defina uma senha nova para continuar.');
      e.code = 'auth/new-password-required';
      e.sessaoDesafio = r.Session;
      e.email = String(email).trim().toLowerCase();
      throw e;
    }
    if (!r.AuthenticationResult) {
      const e = new Error('Não foi possível entrar. Tente de novo.');
      e.code = 'auth/internal-error';
      e.desafio = r.ChallengeName || null;
      throw e;
    }
    salvar(r.AuthenticationResult);
    return { user: _usuario };
  }

  async function createUserWithEmailAndPassword(email, senha) {
    const mail = String(email).trim().toLowerCase();
    const r = await chamar('SignUp', {
      ClientId: CLIENT_ID,
      Username: mail,
      Password: senha,
      UserAttributes: [{ Name: 'email', Value: mail }],
    });
    // Diferente do Firebase: a conta nasce pendente de confirmação por código.
    // Quem chamou precisa pedir o código e passar por confirmarCadastro().
    if (!r.UserConfirmed) {
      const e = new Error('Enviamos um código para seu e-mail. Confirme para ativar a conta.');
      e.code = 'auth/confirmation-required';
      e.email = mail;
      throw e;
    }
    return signInWithEmailAndPassword(mail, senha);
  }

  async function sendPasswordResetEmail(email) {
    await chamar('ForgotPassword', {
      ClientId: CLIENT_ID,
      Username: String(email).trim().toLowerCase(),
    });
    // O Cognito manda um CÓDIGO, não um link: completa em confirmarNovaSenha().
    return true;
  }

  async function signOut() {
    const token = _sessao && _sessao.accessToken;
    salvar(null); // limpa primeiro: a sessão local acaba mesmo se a rede falhar
    if (token) {
      try { await chamar('GlobalSignOut', { AccessToken: token }); } catch {}
    }
    return true;
  }

  function onAuthStateChanged(cb) {
    if (typeof cb !== 'function') return () => {};
    _ouvintes.push(cb);
    // Mesma semântica do Firebase: chama já com o estado atual.
    try { cb(_usuario); } catch (e) { console.error('onAuthStateChanged:', e); }
    return () => {
      const i = _ouvintes.indexOf(cb);
      if (i >= 0) _ouvintes.splice(i, 1);
    };
  }

  // --- etapas que o Cognito exige e o Firebase não tinha ---------------

  /** Confirma o cadastro com o código recebido por e-mail. */
  async function confirmarCadastro(email, codigo, senha) {
    const mail = String(email).trim().toLowerCase();
    await chamar('ConfirmSignUp', {
      ClientId: CLIENT_ID,
      Username: mail,
      ConfirmationCode: String(codigo).trim(),
    });
    if (senha) return signInWithEmailAndPassword(mail, senha);
    return true;
  }

  async function reenviarCodigo(email) {
    await chamar('ResendConfirmationCode', {
      ClientId: CLIENT_ID,
      Username: String(email).trim().toLowerCase(),
    });
    return true;
  }

  /** Conclui a redefinição: código do e-mail + senha nova. */
  async function confirmarNovaSenha(email, codigo, novaSenha) {
    const mail = String(email).trim().toLowerCase();
    await chamar('ConfirmForgotPassword', {
      ClientId: CLIENT_ID,
      Username: mail,
      ConfirmationCode: String(codigo).trim(),
      Password: novaSenha,
    });
    return signInWithEmailAndPassword(mail, novaSenha);
  }

  /** Responde ao NEW_PASSWORD_REQUIRED (conta criada pelo admin). */
  async function definirSenhaInicial(email, novaSenha, sessaoDesafio) {
    const r = await chamar('RespondToAuthChallenge', {
      ClientId: CLIENT_ID,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: sessaoDesafio,
      ChallengeResponses: {
        USERNAME: String(email).trim().toLowerCase(),
        NEW_PASSWORD: novaSenha,
      },
    });
    if (!r.AuthenticationResult) {
      const e = new Error('Não foi possível definir a senha.');
      e.code = 'auth/internal-error';
      throw e;
    }
    salvar(r.AuthenticationResult);
    return { user: _usuario };
  }

  restaurar();
  // Sessão restaurada do localStorage pode estar vencida: renova em segundo
  // plano e avisa os ouvintes com o resultado.
  if (_sessao) garantirValida().then((ok) => { if (ok) notificar(); });

  return {
    get currentUser() { return _usuario; },
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged,
    confirmarCadastro,
    reenviarCodigo,
    confirmarNovaSenha,
    definirSenhaInicial,
    // Expostos para teste e diagnóstico.
    _interno: { chamar, claims, MAPA_ERRO, MENSAGEM, ENDPOINT, CLIENT_ID, POOL_ID },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { AUTH };
