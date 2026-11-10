'use strict';

// Teste estático da infraestrutura (infra/*.tf) e do workflow de deploy.
//
// Por que existe: um erro de infra não quebra tela nenhuma — ele abre um bucket
// ou cria um recurso na região errada, e ninguém percebe até virar conta ou
// vazamento. Este teste lê os arquivos como texto e reprova o que nunca pode
// entrar. Não fala com a AWS e não precisa do Terraform instalado.
//
// O que ele trava:
//   1. Bucket S3 sem bloqueio de acesso público, ou com ACL pública
//   2. Permissão IAM com ação `*` ou `servico:*` liberada (Allow)
//   3. Recurso fora de sa-east-1 (us-east-1 só para o que é global:
//      certificado do CloudFront e WAF)
//   4. Serviços proibidos no projeto: Lambda@Edge, StackSets, replicação
//      entre regiões, chave KMS multi-região
//   5. Deploy que não depende dos testes, ou que publica fora da main

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const INFRA = path.join(RAIZ, 'infra');

/** Remove comentários de linha para que um exemplo comentado não acuse. */
function semComentarios(texto) {
  return texto.split('\n').map((l) => l.replace(/^\s*(#|\/\/).*$/, '')).join('\n');
}

/** Blocos `resource "tipo" "nome" { ... }` com o corpo, por contagem de chaves. */
function blocos(texto, palavra) {
  const achados = [];
  const re = new RegExp(`^${palavra}\\s+"([^"]+)"(?:\\s+"([^"]+)")?\\s*\\{`, 'gm');
  let m;
  while ((m = re.exec(texto))) {
    let i = m.index + m[0].length;
    let nivel = 1;
    while (i < texto.length && nivel > 0) {
      if (texto[i] === '{') nivel++;
      else if (texto[i] === '}') nivel--;
      i++;
    }
    achados.push({ tipo: m[1], nome: m[2] || '', corpo: texto.slice(m.index, i) });
  }
  return achados;
}

/**
 * Analisa um conjunto de arquivos { nome: conteúdo } e devolve a lista de
 * problemas. Função pura: é ela que o "teste do teste" lá embaixo exercita.
 */
function analisarInfra(arquivos) {
  const problemas = [];
  const tudo = Object.entries(arquivos).map(([nome, bruto]) => ({ nome, texto: semComentarios(bruto) }));
  const recursos = tudo.flatMap((a) => blocos(a.texto, 'resource').map((b) => ({ ...b, arquivo: a.nome })));
  const dados = tudo.flatMap((a) => blocos(a.texto, 'data').map((b) => ({ ...b, arquivo: a.nome })));

  // 1. Buckets
  const buckets = recursos.filter((r) => r.tipo === 'aws_s3_bucket');
  for (const b of buckets) {
    const bloqueio = recursos.find((r) => r.tipo === 'aws_s3_bucket_public_access_block'
      && new RegExp(`aws_s3_bucket\\.${b.nome}\\.id`).test(r.corpo));
    if (!bloqueio) {
      problemas.push(`${b.arquivo}: bucket "${b.nome}" sem aws_s3_bucket_public_access_block`);
      continue;
    }
    for (const chave of ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets']) {
      if (!new RegExp(`${chave}\\s*=\\s*true`).test(bloqueio.corpo)) {
        problemas.push(`${bloqueio.arquivo}: bucket "${b.nome}" com ${chave} diferente de true`);
      }
    }
  }
  for (const a of tudo) {
    if (/acl\s*=\s*"public-read(-write)?"/.test(a.texto)) problemas.push(`${a.nome}: ACL pública em bucket`);
  }

  // 2. IAM: ação curinga em statement que não é Deny
  for (const d of dados.filter((x) => x.tipo === 'aws_iam_policy_document')) {
    for (const st of blocos(d.corpo.replace(/^\s+statement\s*\{/gm, 'statement "s" {'), 'statement')) {
      if (/effect\s*=\s*"Deny"/.test(st.corpo)) continue;
      const acoes = (st.corpo.match(/actions\s*=\s*\[([^\]]*)\]/) || [, ''])[1];
      const curinga = (acoes.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1))
        .filter((acao) => acao === '*' || /^[a-z0-9-]+:\*$/i.test(acao));
      if (curinga.length) {
        problemas.push(`${d.arquivo}: policy "${d.nome}" libera ação curinga (${curinga.join(', ')})`);
      }
    }
  }
  for (const a of tudo) {
    if (/policy\/AdministratorAccess|policy\/PowerUserAccess/.test(a.texto)) {
      problemas.push(`${a.nome}: policy gerenciada de acesso amplo anexada`);
    }
  }

  // 3. Região
  const variaveis = tudo.flatMap((a) => blocos(a.texto, 'variable'));
  const regiao = variaveis.find((v) => v.tipo === 'aws_region');
  if (!regiao || !/default\s*=\s*"sa-east-1"/.test(regiao.corpo)) {
    problemas.push('variables.tf: aws_region precisa ter default "sa-east-1"');
  }
  const GLOBAIS = new Set(['aws_acm_certificate', 'aws_acm_certificate_validation', 'aws_wafv2_web_acl', 'aws_cloudwatch_log_group']);
  for (const r of recursos) {
    const m = r.corpo.match(/^\s*provider\s*=\s*aws\.([a-z0-9_]+)/m);
    if (!m) continue;
    if (m[1] !== 'us_east_1') problemas.push(`${r.arquivo}: ${r.tipo}.${r.nome} usa provider de região não permitida (${m[1]})`);
    else if (!GLOBAIS.has(r.tipo)) problemas.push(`${r.arquivo}: ${r.tipo}.${r.nome} em us-east-1 — só certificado do CloudFront, WAF global e os logs deles podem`);
  }
  for (const a of tudo) {
    const regioes = [...a.texto.matchAll(/region\s*=\s*"([a-z]{2}-[a-z]+-\d)"/g)].map((m) => m[1]);
    for (const rg of regioes) {
      if (rg !== 'sa-east-1' && rg !== 'us-east-1') problemas.push(`${a.nome}: região fixa não permitida (${rg})`);
    }
  }

  // 4. Serviços e recursos proibidos no projeto
  const PROIBIDOS = [
    [/lambda_function_association/, 'Lambda@Edge'],
    [/aws_cloudformation_stack_set/, 'CloudFormation StackSets'],
    [/aws_s3_bucket_replication_configuration/, 'replicação de S3 entre regiões'],
    [/\breplica\s*\{/, 'réplica de DynamoDB em outra região'],
    [/multi_region\s*=\s*true/, 'chave KMS multi-região'],
    [/aws_route53_record"[^}]*?(latency_routing_policy|geolocation_routing_policy|failover_routing_policy)/s, 'roteamento Route 53 entre regiões'],
  ];
  for (const a of tudo) {
    for (const [re, nome] of PROIBIDOS) if (re.test(a.texto)) problemas.push(`${a.nome}: ${nome} não é permitido neste projeto`);
  }

  return problemas;
}

/** O workflow de deploy só publica da main e só depois dos testes. */
function analisarWorkflow(yaml) {
  const problemas = [];
  const jobDeploy = (yaml.match(/^  deploy:\n([\s\S]*?)(?=^  [a-zA-Z_-]+:\n|(?![\s\S]))/m) || [, ''])[1];
  if (!jobDeploy) return ['workflow: job "deploy" não encontrado'];
  if (!/^\s+needs:\s*(\[?\s*testes\s*\]?)\s*$/m.test(jobDeploy)) problemas.push('workflow: o job deploy precisa de `needs: testes`');
  if (!/refs\/heads\/main/.test(jobDeploy)) problemas.push('workflow: o job deploy precisa da condição de branch main');
  if (!/^  testes:\n/m.test(yaml)) problemas.push('workflow: job "testes" não encontrado');
  if (!/^\s+run:\s*npm test\s*$/m.test(yaml)) problemas.push('workflow: o job de testes precisa rodar `npm test`');
  if (/continue-on-error:\s*true/.test(yaml)) problemas.push('workflow: continue-on-error esconderia teste vermelho');
  if (/permissions:\s*write-all/.test(yaml)) problemas.push('workflow: permissions write-all');
  return problemas;
}

// ── Os arquivos de verdade ────────────────────────────────────────────────
const arquivos = {};
for (const f of fs.readdirSync(INFRA).filter((n) => n.endsWith('.tf'))) {
  arquivos[f] = fs.readFileSync(path.join(INFRA, f), 'utf8');
}
assert.ok(Object.keys(arquivos).length >= 5, 'esperava encontrar os .tf em infra/');
assert.deepStrictEqual(analisarInfra(arquivos), [], 'a infra não pode ter nenhum dos problemas travados');

const workflow = fs.readFileSync(path.join(RAIZ, '.github/workflows/deploy-aws.yml'), 'utf8');
assert.deepStrictEqual(analisarWorkflow(workflow), [], 'o deploy tem que depender dos testes e publicar só da main');

// ── Teste do teste: cada regra tem que acusar quando é quebrada ───────────
// Um verificador que nunca reprova não protege nada. Aqui cada caso quebra a
// infra de propósito, em memória, e exige que o problema apareça.
const base = { ...arquivos };
const com = (nome, extra) => ({ ...base, [nome]: (base[nome] || '') + '\n' + extra });
const acusa = (conjunto, trecho, rotulo) => {
  const p = analisarInfra(conjunto);
  assert.ok(p.some((x) => x.includes(trecho)), `${rotulo}: deveria acusar "${trecho}", veio ${JSON.stringify(p)}`);
};

acusa(com('x.tf', 'resource "aws_s3_bucket" "aberto" {\n  bucket = "x"\n}'), 'sem aws_s3_bucket_public_access_block', 'bucket sem bloqueio');
acusa(com('x.tf', 'resource "aws_s3_bucket" "meio" {\n  bucket = "x"\n}\nresource "aws_s3_bucket_public_access_block" "meio" {\n  bucket = aws_s3_bucket.meio.id\n  block_public_acls = true\n  block_public_policy = false\n  ignore_public_acls = true\n  restrict_public_buckets = true\n}'), 'block_public_policy diferente de true', 'bloqueio pela metade');
acusa(com('x.tf', 'resource "aws_s3_bucket_acl" "a" {\n  acl = "public-read"\n}'), 'ACL pública', 'ACL pública');
acusa(com('x.tf', 'data "aws_iam_policy_document" "tudo" {\n  statement {\n    actions   = ["*"]\n    resources = ["*"]\n  }\n}'), 'ação curinga', 'IAM *');
acusa(com('x.tf', 'data "aws_iam_policy_document" "s3tudo" {\n  statement {\n    actions   = ["s3:*"]\n    resources = ["*"]\n  }\n}'), 'ação curinga (s3:*)', 'IAM s3:*');
acusa(com('x.tf', 'resource "aws_iam_role_policy_attachment" "adm" {\n  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"\n}'), 'acesso amplo', 'AdministratorAccess');
acusa(com('x.tf', 'resource "aws_lambda_function" "fora" {\n  provider = aws.us_east_1\n}'), 'em us-east-1', 'Lambda em us-east-1');
acusa(com('x.tf', 'provider "aws" {\n  alias  = "eua"\n  region = "us-west-2"\n}'), 'região fixa não permitida (us-west-2)', 'região estranha');
acusa(com('x.tf', 'resource "aws_kms_key" "k" {\n  multi_region = true\n}'), 'KMS multi-região', 'KMS multi-região');
acusa(com('x.tf', 'resource "aws_cloudfront_distribution" "e" {\n  lambda_function_association {\n  }\n}'), 'Lambda@Edge', 'Lambda@Edge');
// O Deny com s3:* do bucket de backup é proteção, não brecha: não pode acusar.
assert.ok(!analisarInfra(base).some((x) => x.includes('curinga')), 'statement Deny com curinga não é problema');

const quebra = (de, para, trecho) => {
  assert.ok(workflow.includes(de), `o workflow mudou e o teste precisa acompanhar: não achei "${de}"`);
  const p = analisarWorkflow(workflow.replace(de, para));
  assert.ok(p.some((x) => x.includes(trecho)), `workflow: deveria acusar "${trecho}", veio ${JSON.stringify(p)}`);
};
quebra('needs: testes', 'needs: []', 'needs: testes');
quebra('run: npm test', 'run: echo sem-teste', 'npm test');
quebra("github.ref == 'refs/heads/main'", 'true', 'branch main');

console.log('infra (estático): buckets, IAM, região, serviços proibidos e trava do deploy — todos passaram');

module.exports = { analisarInfra, analisarWorkflow };
