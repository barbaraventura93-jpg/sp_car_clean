'use strict';

// Ponto de entrada das funções no AWS Lambda. O mesmo código roda no Netlify e
// na AWS: este adaptador carrega os segredos do SSM Parameter Store para
// process.env (uma vez por container) e entrega ao handler original um evento
// no formato que o Netlify entregaria.
//
// Variáveis definidas pelo Terraform:
//   FN_NAME               → arquivo da função (ex.: "ai" → ../ai.js)
//   SSM_PARAM_PATH        → prefixo dos parâmetros (ex.: "/sp-car-clean/")
//   ORIGIN_VERIFY_SECRET  → segredo que só o CloudFront envia (bloqueia acesso
//                           direto ao endpoint do API Gateway)

const crypto = require('crypto');

let ready = null;

async function loadParams(path) {
  const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
  const ssm = new SSMClient({});
  let NextToken;
  do {
    const out = await ssm.send(new GetParametersByPathCommand({
      Path: path, WithDecryption: true, Recursive: false, NextToken
    }));
    for (const p of out.Parameters || []) {
      const key = p.Name.slice(path.length);
      // Variáveis do próprio Lambda/Terraform têm precedência.
      if (!(key in process.env)) process.env[key] = p.Value;
    }
    NextToken = out.NextToken;
  } while (NextToken);
}

async function init() {
  if (process.env.SSM_PARAM_PATH) await loadParams(process.env.SSM_PARAM_PATH);
  // Carregado só depois dos segredos: alguns módulos leem process.env ao carregar.
  return require(`../${process.env.FN_NAME}.js`).handler;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  if (!ready) ready = init().catch((err) => { ready = null; throw err; });
  const fn = await ready;

  // Invocação agendada (EventBridge Scheduler): não é HTTP.
  if (!event || !event.httpMethod) return fn(event);

  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;

  const secret = process.env.ORIGIN_VERIFY_SECRET;
  if (secret && !sameSecret(headers['x-origin-verify'], secret)) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  delete headers['x-origin-verify'];

  // IP real do visitante, gravado pela CloudFront Function (não falsificável
  // pelo cliente) — é o que o rate-limit das funções lê em x-forwarded-for.
  if (headers['x-viewer-ip']) headers['x-forwarded-for'] = headers['x-viewer-ip'];

  const body = event.body && event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  return fn({ ...event, headers, body, isBase64Encoded: false });
};
