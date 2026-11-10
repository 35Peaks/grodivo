locals {
  vpc_functions    = toset(["api", "migrate", "digest", "ingest"])
  public_functions = toset(["admin", "notify", "news"])
  functions = {
    api     = { timeout = 29, memory = 512 }
    migrate = { timeout = 120, memory = 256 }
    digest  = { timeout = 60, memory = 256 }
    admin   = { timeout = 15, memory = 256 }
    notify  = { timeout = 120, memory = 256 }
    news    = { timeout = 900, memory = 512 }
    ingest  = { timeout = 120, memory = 256 }
  }
  common_env = { NODE_OPTIONS = "--enable-source-maps" }
  function_env = {
    api     = { DATABASE_URL = local.database_url }
    migrate = { DATABASE_URL = local.database_url }
    digest  = { DATABASE_URL = local.database_url, DIGEST_BUCKET = aws_s3_bucket.digests.bucket }
    admin   = { USER_POOL_ID = aws_cognito_user_pool.main.id }
    ingest  = { DATABASE_URL = local.database_url }
    news = {
      DIGEST_BUCKET        = aws_s3_bucket.digests.bucket
      ANTHROPIC_SECRET_ARN = aws_secretsmanager_secret.anthropic.arn
      FMP_SECRET_ARN       = aws_secretsmanager_secret.fmp.arn
      CLAUDE_MODEL         = var.claude_model
    }
    notify = {
      ANTHROPIC_SECRET_ARN = aws_secretsmanager_secret.anthropic.arn
      CLAUDE_MODEL         = var.claude_model
      FROM_ADDRESS         = var.digest_from_address
      APP_URL              = local.app_url
    }
  }
}

data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = "${local.dist}/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "basic" {
  for_each   = local.public_functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "vpc" {
  for_each   = local.vpc_functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "digest" {
  role = aws_iam_role.fn["digest"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.digests.arn}/digests/*" },
      { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Encrypt"], Resource = aws_kms_key.main.arn },
    ]
  })
}

resource "aws_iam_role_policy" "notify" {
  role = aws_iam_role.fn["notify"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.digests.arn}/digests/*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.main.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.anthropic.arn },
      { Effect = "Allow", Action = ["ses:SendEmail", "ses:SendRawEmail"], Resource = "*",
        Condition = { StringEquals = { "ses:FromAddress" = var.digest_from_address } } },
    ]
  })
}

resource "aws_iam_role_policy" "admin" {
  role = aws_iam_role.fn["admin"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cognito-idp:ListUsers", "cognito-idp:AdminListGroupsForUser", "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:AdminEnableUser", "cognito-idp:AdminDisableUser",
      ]
      Resource = aws_cognito_user_pool.main.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 30
}

resource "aws_lambda_function" "fn" {
  for_each         = local.functions
  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  timeout          = each.value.timeout
  memory_size      = each.value.memory
  kms_key_arn      = aws_kms_key.main.arn

  environment {
    variables = merge(local.common_env, local.function_env[each.key])
  }

  dynamic "vpc_config" {
    for_each = contains(local.vpc_functions, each.key) ? [1] : []
    content {
      subnet_ids         = aws_subnet.private[*].id
      security_group_ids = [aws_security_group.lambda.id]
    }
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.basic, aws_iam_role_policy_attachment.vpc]
}

# Lambda needs to decrypt its own env vars with the customer-managed key
resource "aws_iam_role_policy" "kms_env" {
  for_each = local.functions
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.main.arn }]
  })
}
