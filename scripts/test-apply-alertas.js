'use strict';
// scripts/aws-apply.sh: quem recebe os avisos dos alarmes.
//
// Regra (decisão da Bárbara, 18/11/2026): os avisos vão só para quem
// confirmou a inscrição no tópico sp-car-clean-alertas. Um apply futuro não
// pode voltar aos dois e-mails de admin e reenviar o pedido de confirmação.
// Na primeira vez (sem tópico ou sem ninguém confirmado), vai `[]` e o
// Terraform usa os e-mails de admin.
//
// Roda o script de verdade com `aws` e `terraform` de mentira no PATH: nada
// fala com a AWS, e os e-mails são inventados.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

function rodar({ topico, inscricoes }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-alertas-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const registro = path.join(dir, 'terraform-args.txt');

  // `aws` de mentira: responde só o que o script pergunta.
  fs.writeFileSync(path.join(bin, 'aws'), `#!/usr/bin/env bash
case "$*" in
  *"get-caller-identity --query Account"*) echo 111122223333 ;;
  *get-caller-identity*) echo "111122223333 arn:aws:iam::111122223333:user/teste" ;;
  *list-user-pools*) echo sa-east-1_TESTE ;;
  *list-users-in-group*) printf 'admin1@exemplo.test\\tadmin2@exemplo.test\\n' ;;
  *list-topics*) echo ${JSON.stringify(topico)} ;;
  *list-subscriptions-by-topic*) printf ${JSON.stringify(inscricoes)} ;;
  *) echo "aws de mentira: comando inesperado: $*" >&2; exit 9 ;;
esac
`, { mode: 0o755 });

  // `terraform` de mentira: anota os argumentos do plan.
  fs.writeFileSync(path.join(bin, 'terraform'), `#!/usr/bin/env bash
[ "$1" = version ] && { echo "Terraform v0.0.0-teste"; exit 0; }
[ "$1" = plan ] && printf '%s\\n' "$@" >> ${JSON.stringify(registro)}
exit 0
`, { mode: 0o755 });

  // Cópia do repositório só com o necessário: a trava confere infra/.
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.cpSync(path.join(RAIZ, 'infra'), path.join(dir, 'infra'), {
    recursive: true,
    filter: (src) => !/\.terraform|backend\.hcl|tfplan/.test(src),
  });
  fs.copyFileSync(path.join(RAIZ, 'scripts/aws-apply.sh'), path.join(dir, 'scripts/aws-apply.sh'));

  const r = spawnSync('bash', [path.join(dir, 'scripts/aws-apply.sh')], {
    input: 'nao\n', // responde "não" na hora de aplicar
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const args = fs.existsSync(registro) ? fs.readFileSync(registro, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r.status, 0, `o script tem que terminar sem erro\n${r.stdout}\n${r.stderr}`);
  const alerta = args.split('\n').find((l) => l.startsWith('-var=alert_emails='));
  assert.ok(alerta, `o plan tem que receber -var alert_emails\n${args}`);
  return JSON.parse(alerta.slice('-var=alert_emails='.length));
}

const TOPICO = 'arn:aws:sns:sa-east-1:111122223333:sp-car-clean-alertas';

// 1. Um confirmado e um pendente: vai só o confirmado.
assert.deepStrictEqual(
  rodar({ topico: TOPICO, inscricoes: 'escolhido@exemplo.test\\n' }),
  ['escolhido@exemplo.test'],
  'só quem confirmou continua recebendo; o pendente não volta a ser inscrito',
);

// 2. Dois confirmados: os dois continuam.
assert.deepStrictEqual(
  rodar({ topico: TOPICO, inscricoes: 'b@exemplo.test\\ta@exemplo.test\\n' }),
  ['a@exemplo.test', 'b@exemplo.test'],
  'todos os confirmados continuam recebendo',
);

// 3. Tópico existe mas ninguém confirmou: [] (o Terraform usa os admins).
assert.deepStrictEqual(
  rodar({ topico: TOPICO, inscricoes: 'None\\n' }),
  [],
  'sem confirmados, alert_emails fica vazio e o padrão (admins) vale',
);

// 4. Primeira vez, sem tópico: [].
assert.deepStrictEqual(
  rodar({ topico: 'None', inscricoes: '' }),
  [],
  'sem tópico, alert_emails fica vazio e o padrão (admins) vale',
);

// 5. O filtro de "confirmado" é feito pela consulta da AWS CLI (o `aws` de
//    mentira acima já responde filtrado). Trava a consulta em si.
const script = fs.readFileSync(path.join(RAIZ, 'scripts/aws-apply.sh'), 'utf8');
assert.ok(
  /list-subscriptions-by-topic[\s\S]{0,200}SubscriptionArn!='PendingConfirmation'/.test(script),
  'a consulta das inscrições tem que excluir as pendentes (PendingConfirmation)',
);

console.log('aws-apply.sh: avisos dos alarmes só para quem confirmou — todos passaram');
