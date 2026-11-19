# =====================================================================
# Alarmes: avisar por e-mail quando algo para de funcionar em silêncio.
#
# Por que existe: de 10/11/2026 em diante o banco ficou fora do ar por quatro
# dias sem ninguém saber. As funções registravam o erro no log, mas nenhum
# alarme olhava para isso. Pior: elas terminam normalmente (devolvem
# { ok: false }), então a métrica padrão de erros do Lambda ficou em zero o
# tempo todo. Um alarme em "Errors" do Lambda NÃO teria pegado o incidente.
#
# Por isso os dois alarmes daqui olham o LOG:
#   1. erro em qualquer função: linha "ERROR" (é como o Node marca o
#      console.error) ou "Task timed out", em qualquer uma delas;
#   2. backup não feito: 26 horas sem a linha "firebase-backup: ok", que só
#      é escrita depois que o arquivo foi gravado no S3. Sem dado conta como
#      falha — backup que nem rodou também dispara.
#
# Custo: 2 alarmes e 2 métricas próprias, dentro da faixa gratuita do
# CloudWatch (10 de cada). Fora dela, cerca de US$ 0,80 por mês. Os filtros
# de log e o e-mail do SNS não têm custo neste volume.
#
# Depois do apply, cada destinatário recebe um e-mail da AWS ("Subscription
# Confirmation") e precisa clicar no link para passar a receber os alertas.
# =====================================================================

locals {
  # Quem recebe: var.alert_emails, ou, se vazio, os mesmos e-mails de admin.
  destinatarios_alerta = length(var.alert_emails) > 0 ? var.alert_emails : var.admin_emails
  namespace_alarmes    = "SPCarClean"
}

resource "aws_sns_topic" "alertas" {
  name = "sp-car-clean-alertas"
}

resource "aws_sns_topic_subscription" "alertas_email" {
  for_each  = toset(local.destinatarios_alerta)
  topic_arn = aws_sns_topic.alertas.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------
# 1. Erro em qualquer função
# ---------------------------------------------------------------------
# Um filtro por grupo de log, todos alimentando a MESMA métrica: uma métrica
# e um alarme cobrem todas as funções, inclusive as que forem criadas depois
# (o for_each acompanha aws_cloudwatch_log_group.fn, em api.tf).
resource "aws_cloudwatch_log_metric_filter" "erros" {
  for_each       = aws_cloudwatch_log_group.fn
  name           = "erros-${each.key}"
  log_group_name = each.value.name
  pattern        = "?ERROR ?\"Task timed out\""

  metric_transformation {
    name      = "ErrosNasFuncoes"
    namespace = local.namespace_alarmes
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "erros_nas_funcoes" {
  alarm_name          = "sp-car-clean-erros-nas-funcoes"
  alarm_description   = "Alguma função do site registrou erro na última hora. Ver docs/operacao.md, item 2 (onde ver os registros)."
  namespace           = local.namespace_alarmes
  metric_name         = "ErrosNasFuncoes"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching" # hora sem log de erro é hora boa
  alarm_actions       = [aws_sns_topic.alertas.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.erros]
}

# ---------------------------------------------------------------------
# 2. Backup diário não concluído
# ---------------------------------------------------------------------
resource "aws_cloudwatch_log_metric_filter" "backup_ok" {
  name           = "backup-concluido"
  log_group_name = aws_cloudwatch_log_group.fn["firebase-backup"].name
  pattern        = "\"firebase-backup: ok\""

  metric_transformation {
    name      = "BackupsConcluidos"
    namespace = local.namespace_alarmes
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "backup_nao_feito" {
  alarm_name          = "sp-car-clean-backup-nao-feito"
  alarm_description   = "Passaram 26 horas sem backup diário concluído. Ver o log sp-car-clean-firebase-backup e docs/operacao.md, item 3."
  namespace           = local.namespace_alarmes
  metric_name         = "BackupsConcluidos"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 26
  datapoints_to_alarm = 26
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching" # sem a linha de sucesso = sem backup
  alarm_actions       = [aws_sns_topic.alertas.arn]
  ok_actions          = [aws_sns_topic.alertas.arn] # avisa também quando voltar

  depends_on = [aws_cloudwatch_log_metric_filter.backup_ok]
}
