'use strict';

// Alarmes (infra/alarmes.tf): o que garante que uma falha silenciosa avisa.
//
// Por que existe: de 10/11/2026 em diante o banco ficou fora do ar por quatro
// dias sem ninguém saber. Este teste trava as decisões que fazem os alarmes
// pegarem esse tipo de falha, e principalmente a que quebra sem ninguém ver:
// o alarme do backup procura um TEXTO no log, e se a frase da função mudar,
// o alarme deixa de reconhecer o sucesso.
//
// Lê os arquivos como texto. Não fala com a AWS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ALARMES = fs.readFileSync(path.join(RAIZ, 'infra/alarmes.tf'), 'utf8');
const API = fs.readFileSync(path.join(RAIZ, 'infra/api.tf'), 'utf8');
const BACKUP = fs.readFileSync(path.join(RAIZ, 'functions/firebase-backup.js'), 'utf8');

/** Corpo de um bloco `resource "tipo" "nome" { ... }`, por contagem de chaves. */
function bloco(texto, tipo, nome) {
  const ini = texto.indexOf(`resource "${tipo}" "${nome}"`);
  if (ini < 0) return null;
  let i = texto.indexOf('{', ini) + 1;
  let nivel = 1;
  while (i < texto.length && nivel > 0) { if (texto[i] === '{') nivel++; else if (texto[i] === '}') nivel--; i++; }
  return texto.slice(ini, i);
}
// Valor de uma chave, sem o comentário do fim da linha (`# ...`) quando houver.
const valor = (corpo, chave) => {
  const m = corpo.match(new RegExp(`^\\s*${chave}\\s*=\\s*(.+)$`, 'm'));
  return m ? m[1].replace(/\s+#[^"]*$/, '').trim() : null;
};

function verificar(alarmes, backupJs) {
  const problemas = [];
  const exigir = (cond, msg) => { if (!cond) problemas.push(msg); };

  // 1. Erros: um filtro por grupo de log, cobrindo TODAS as funções.
  const filtro = bloco(alarmes, 'aws_cloudwatch_log_metric_filter', 'erros');
  exigir(filtro, 'falta o filtro de erros');
  if (filtro) {
    exigir(valor(filtro, 'for_each') === 'aws_cloudwatch_log_group.fn', 'o filtro de erros precisa cobrir todos os grupos de log (for_each = aws_cloudwatch_log_group.fn)');
    const padrao = valor(filtro, 'pattern') || '';
    exigir(/ERROR/.test(padrao), 'o filtro precisa pegar a linha ERROR (é como o Node marca console.error)');
    exigir(/Task timed out/.test(padrao), 'o filtro precisa pegar tempo esgotado ("Task timed out")');
  }
  const alErros = bloco(alarmes, 'aws_cloudwatch_metric_alarm', 'erros_nas_funcoes');
  exigir(alErros, 'falta o alarme de erros');
  if (alErros) {
    exigir(/alarm_actions\s*=\s*\[aws_sns_topic\.alertas\.arn\]/.test(alErros), 'o alarme de erros precisa avisar pelo tópico de alertas');
    exigir(valor(alErros, 'comparison_operator') === '"GreaterThanOrEqualToThreshold"' && valor(alErros, 'threshold') === '1', 'um erro já basta para disparar');
  }

  // 2. Backup: sem a linha de sucesso, dispara — inclusive se nem rodou.
  const fBackup = bloco(alarmes, 'aws_cloudwatch_log_metric_filter', 'backup_ok');
  exigir(fBackup, 'falta o filtro de backup concluído');
  if (fBackup) {
    exigir(/aws_cloudwatch_log_group\.fn\["firebase-backup"\]/.test(fBackup), 'o filtro de backup precisa olhar o log da função firebase-backup');
    const m = (valor(fBackup, 'pattern') || '').match(/^"\\"(.+)\\""$/);
    exigir(m, 'o padrão do backup precisa ser uma frase exata entre aspas');
    // O ponto que quebra calado: a frase tem que existir no log real.
    if (m) exigir(backupJs.includes(m[1]), `a função firebase-backup não escreve mais "${m[1]}" no log — o alarme não reconheceria o sucesso`);
  }
  const alBackup = bloco(alarmes, 'aws_cloudwatch_metric_alarm', 'backup_nao_feito');
  exigir(alBackup, 'falta o alarme de backup não feito');
  if (alBackup) {
    exigir(valor(alBackup, 'treat_missing_data') === '"breaching"', 'sem dado tem que contar como falha: backup que nem rodou também precisa avisar');
    exigir(valor(alBackup, 'comparison_operator') === '"LessThanThreshold"', 'dispara quando há MENOS de 1 backup no período');
    const horas = Number(valor(alBackup, 'evaluation_periods')) * Number(valor(alBackup, 'period')) / 3600;
    exigir(horas >= 24 && horas <= 30, `a janela do backup precisa ser de 24 a 30 horas (está em ${horas})`);
    exigir(/alarm_actions\s*=\s*\[aws_sns_topic\.alertas\.arn\]/.test(alBackup), 'o alarme de backup precisa avisar pelo tópico de alertas');
  }

  // 3. Alguém recebe o aviso.
  exigir(/resource "aws_sns_topic_subscription" "alertas_email"/.test(alarmes) && /protocol\s*=\s*"email"/.test(alarmes), 'falta a inscrição por e-mail no tópico de alertas');
  exigir(/var\.admin_emails/.test(alarmes), 'sem alert_emails configurado, os alertas vão para os e-mails de admin');
  return problemas;
}

// ── Os arquivos de verdade ────────────────────────────────────────────────
assert.deepStrictEqual(verificar(ALARMES, BACKUP), [], 'os alarmes têm que estar como descrito');
assert.ok(/"firebase-backup"\s*=/.test(API), 'firebase-backup é uma função agendada (api.tf), então tem grupo de log');

// ── Teste do teste: cada regra tem que acusar quando é quebrada ───────────
const acusa = (alarmes, backupJs, trecho, rotulo) => {
  const p = verificar(alarmes, backupJs);
  assert.ok(p.some((x) => x.includes(trecho)), `${rotulo}: deveria acusar "${trecho}", veio ${JSON.stringify(p)}`);
};
const troca = (de, para) => { assert.ok(ALARMES.includes(de), `o teste precisa acompanhar o arquivo: não achei ${de}`); return ALARMES.replace(de, para); };
acusa(ALARMES, BACKUP.split('firebase-backup: ok').join('backup feito'), 'não escreve mais', 'frase do log mudou na função');
acusa(troca('treat_missing_data  = "breaching"', 'treat_missing_data  = "notBreaching"'), BACKUP, 'sem dado tem que contar como falha', 'backup que não roda não avisaria');
acusa(troca('for_each       = aws_cloudwatch_log_group.fn', 'for_each       = { me = aws_cloudwatch_log_group.fn["me"] }'), BACKUP, 'cobrir todos os grupos', 'filtro só numa função');
acusa(troca('pattern        = "?ERROR ?\\"Task timed out\\""', 'pattern        = "?ERROR"'), BACKUP, 'Task timed out', 'sem tempo esgotado');
acusa(troca('evaluation_periods  = 26', 'evaluation_periods  = 72'), BACKUP, 'janela do backup', 'janela de 3 dias');

console.log('alarmes: erro em qualquer função e backup não feito — todos passaram');
