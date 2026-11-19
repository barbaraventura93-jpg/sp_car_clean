'use strict';

// Trava do scripts/aws-apply.sh: ele recusa rodar numa cópia do repositório que
// não tenha a configuração da migração.
//
// Rodar: node scripts/test-apply-ramo.js
//
// POR QUE EXISTE: eu (Claude) escrevi o script dizendo "git clone" e só depois
// percebi que um clone sem `-b` entrega a `main` — onde a política de acesso das
// funções à tabela do DynamoDB ainda não existe. Aplicar dali faria o Terraform
// APAGAR essa política, porque ela está no estado e não na configuração. O site
// voltaria a ficar sem banco, por causa de uma instrução minha.
//
// A trava é o conserto; este teste é o que impede alguém de removê-la achando
// que é verificação supérflua. Não fala com a AWS (`SOMENTE_CONFERIR=1`).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');

function rodar(dir) {
  return spawnSync('bash', [path.join(dir, 'scripts/aws-apply.sh')], {
    encoding: 'utf8',
    env: { ...process.env, SOMENTE_CONFERIR: '1' },
  });
}

/** Cópia mínima do repositório, com os três arquivos que a trava olha. */
function copia({ dataTf, apiTf }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-ramo-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'infra'));
  fs.copyFileSync(path.join(RAIZ, 'scripts/aws-apply.sh'), path.join(dir, 'scripts/aws-apply.sh'));
  fs.writeFileSync(path.join(dir, 'infra/data.tf'), dataTf);
  fs.writeFileSync(path.join(dir, 'infra/api.tf'), apiTf);
  return dir;
}

const DATA_OK = 'resource "aws_iam_role_policy" "lambda_data" {\n  role = x\n}\n';
const API_OK  = 'http_functions = ["unsubscribe"]\nDATA_TABLE = x\n';

// ── a configuração completa passa ─────────────────────────────────────
let r = rodar(copia({ dataTf: DATA_OK, apiTf: API_OK }));
assert.strictEqual(r.status, 0, 'configuração da migração tem que passar: ' + r.stderr);
assert.match(r.stdout, /configuração conferida/);

// ── cada peça ausente tem que BARRAR ──────────────────────────────────
const casos = [
  ['sem a política de acesso à tabela', { dataTf: '# vazio\n', apiTf: API_OK }, /lambda_data/],
  ['sem a variável DATA_TABLE', { dataTf: DATA_OK, apiTf: 'http_functions = ["unsubscribe"]\n' }, /DATA_TABLE/],
  ['sem a função unsubscribe', { dataTf: DATA_OK, apiTf: 'DATA_TABLE = x\n' }, /unsubscribe/],
];
for (const [nome, arquivos, esperado] of casos) {
  const res = rodar(copia(arquivos));
  assert.notStrictEqual(res.status, 0, `${nome}: tinha que barrar`);
  assert.match(res.stderr, /PARE/, `${nome}: tem que dizer para parar`);
  assert.match(res.stderr, esperado, `${nome}: tem que dizer o que falta`);
  // E tem que explicar o PERIGO, não só que falta algo: quem lê precisa
  // entender que aplicar assim apaga recurso que existe.
  assert.match(res.stderr, /APAGARIA/, `${nome}: tem que explicar o risco`);
  assert.match(res.stderr, /ccr-d3d7761c-vw5yj5|main/, `${nome}: tem que dizer qual ramo usar`);
}

// ── e a cópia de verdade deste repositório passa ──────────────────────
// Se alguém mexer no infra/ e tirar uma dessas peças, este teste acusa aqui,
// não no CloudShell.
r = rodar(RAIZ);
assert.strictEqual(r.status, 0, 'o próprio repositório tem que passar na trava: ' + r.stderr);

console.log('trava do aws-apply.sh: barra ramo sem a migração, explica o risco e aponta o ramo certo — todos passaram');
