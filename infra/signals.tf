# M&A signals feed (weekdays):
#   Scheduler -> news Lambda (outside VPC: FMP + GDELT + Claude) -> s3://<digests bucket>/signals/inbox/*.json
#   -> ingest Lambda (inside VPC) -> Postgres signals tables -> Signals page in the dashboard.
# Reuses the digests bucket, KMS key, Anthropic secret and S3 gateway endpoint. No NAT, no new public endpoints.

resource "aws_secretsmanager_secret" "fmp" {
  name       = "${local.name}/fmp-api-key"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "fmp" {
  secret_id     = aws_secretsmanager_secret.fmp.id
  secret_string = "REPLACE_ME"
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_iam_role_policy" "news" {
  role = aws_iam_role.fn["news"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.digests.arn}/signals/inbox/*" },
      { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Encrypt", "kms:Decrypt"], Resource = aws_kms_key.main.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.anthropic.arn, aws_secretsmanager_secret.fmp.arn] },
    ]
  })
}

resource "aws_iam_role_policy" "ingest" {
  role = aws_iam_role.fn["ingest"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.digests.arn}/signals/inbox/*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.main.arn },
    ]
  })
}

resource "aws_lambda_permission" "s3_ingest" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["ingest"].function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.digests.arn
}

resource "aws_iam_role_policy" "scheduler_news" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.fn["news"].arn }]
  })
}

resource "aws_scheduler_schedule" "signals" {
  name                         = "${local.name}-ma-signals"
  schedule_expression          = var.signals_schedule
  schedule_expression_timezone = "America/New_York"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.fn["news"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ sources = ["fmp", "gdelt", "claude_research"] })
    retry_policy { maximum_retry_attempts = 1 }
  }
}

resource "aws_cloudwatch_metric_alarm" "news_errors" {
  alarm_name          = "${local.name}-news-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.fn["news"].function_name }
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "The M&A signals news run failed today"
}
