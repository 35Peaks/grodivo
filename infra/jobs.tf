# Weekly digest: Scheduler -> digest Lambda (VPC, reads Postgres) -> S3 snapshot -> notify Lambda (Claude + SES)

resource "aws_s3_bucket" "digests" {
  bucket = "${local.name}-digests-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "digests" {
  bucket                  = aws_s3_bucket.digests.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "digests" {
  bucket = aws_s3_bucket.digests.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "digests" {
  bucket = aws_s3_bucket.digests.id
  rule {
    id     = "expire-snapshots"
    status = "Enabled"
    filter { prefix = "digests/" }
    expiration { days = 90 }
  }
  rule {
    id     = "expire-signal-batches"
    status = "Enabled"
    filter { prefix = "signals/" }
    expiration { days = 30 }
  }
}

resource "aws_lambda_permission" "s3_notify" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["notify"].function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.digests.arn
}

resource "aws_s3_bucket_notification" "digests" {
  bucket = aws_s3_bucket.digests.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.fn["notify"].arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "digests/"
    filter_suffix       = ".json"
  }
  # M&A signal batches (see signals.tf)
  lambda_function {
    lambda_function_arn = aws_lambda_function.fn["ingest"].arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "signals/inbox/"
    filter_suffix       = ".json"
  }
  depends_on = [aws_lambda_permission.s3_notify, aws_lambda_permission.s3_ingest]
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.fn["digest"].arn }]
  })
}

resource "aws_scheduler_schedule" "weekly_digest" {
  name                         = "${local.name}-weekly-digest"
  schedule_expression          = var.digest_schedule
  schedule_expression_timezone = "America/New_York"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.fn["digest"].arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy { maximum_retry_attempts = 2 }
  }
}

# Claude API key for the digest commentary. Terraform creates it with a placeholder;
# set the real value once in the console or CLI (see README). Terraform won't overwrite it.
resource "aws_secretsmanager_secret" "anthropic" {
  name       = "${local.name}/anthropic-api-key"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "anthropic" {
  secret_id     = aws_secretsmanager_secret.anthropic.id
  secret_string = "REPLACE_ME"
  lifecycle { ignore_changes = [secret_string] }
}

# Sender address for the digest. Leave off if the sender's domain is already verified in SES;
# turn on to have SES email a one-time verification link to the address.
resource "aws_sesv2_email_identity" "digest_from" {
  count          = var.create_sender_identity ? 1 : 0
  email_identity = var.digest_from_address
}
