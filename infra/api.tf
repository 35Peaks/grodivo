resource "aws_apigatewayv2_api" "main" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = compact([var.app_domain != "" ? "https://${var.app_domain}" : "", var.app_url_fallback, "http://localhost:5173"])
    allow_methods = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    expose_headers = ["content-disposition"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = toset(["api", "admin"])
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "ANY /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.fn["api"].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "admin" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "ANY /admin/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.fn["admin"].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.fn["api"].id}"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.name}-api"
  retention_in_days = 30
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId = "$context.requestId", ip = "$context.identity.sourceIp", method = "$context.httpMethod",
      path = "$context.path", status = "$context.status", latency = "$context.responseLatency",
      user = "$context.authorizer.claims.email", error = "$context.authorizer.error"
    })
  }
}

resource "aws_lambda_permission" "apigw" {
  for_each      = toset(["api", "admin"])
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.main.id, Stage = "$default" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "API returned 5 or more server errors in 5 minutes"
}
