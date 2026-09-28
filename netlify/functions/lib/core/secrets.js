'use strict';

// Carrega os parâmetros do AWS SSM Parameter Store (prefixo /sp-car-clean/)
// para process.env no cold start da Lambda. Memoizado: busca só uma vez por
// instância. Usa o AWS SDK v3, que já vem embutido no runtime Node da Lambda
// (não precisa empacotar nada).
//
// No Netlify este arquivo não é usado (lá as variáveis já vêm do painel),
// então ele é inofensivo enquanto os dois ambientes coexistirem.

const PREFIX = process.env.SECRETS_PREFIX || '/sp-car-clean/';

let loaded = false;

async function loadSecrets() {
  if (loaded) return;
  // Sem prefixo configurado ou fora da AWS: não faz nada (usa env já presente).
  if (!process.env.AWS_REGION) { loaded = true; return; }

  const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
  const client = new SSMClient({});

  let nextToken;
  do {
    const out = await client.send(new GetParametersByPathCommand({
      Path: PREFIX,
      Recursive: true,
      WithDecryption: true,
      NextToken: nextToken,
      MaxResults: 10
    }));
    for (const p of out.Parameters || []) {
      const key = p.Name.slice(PREFIX.length);
      // Não sobrescreve o que já veio do ambiente (permite override pontual).
      if (key && process.env[key] === undefined) process.env[key] = p.Value;
    }
    nextToken = out.NextToken;
  } while (nextToken);

  loaded = true;
}

module.exports = { loadSecrets };
