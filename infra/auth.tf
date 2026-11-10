resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  # Invite-only: admins create users from the dashboard
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Your Grodivo Sales dashboard invitation"
      email_message = "You've been invited to the Grodivo Sales dashboard at ${local.app_url}. Sign in with {username} and temporary password {####}. You'll set your own password on first sign-in."
      sms_message   = "Grodivo Sales: username {username}, temporary password {####}"
    }
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 1
      max_length = 200
    }
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${local.name}-sales-${local.account_id}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${local.name}-web"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = compact([var.app_domain != "" ? "https://${var.app_domain}/auth/callback" : "", var.app_url_fallback != "" ? "${var.app_url_fallback}/auth/callback" : "", "http://localhost:5173/auth/callback"])
  logout_urls                          = compact([var.app_domain != "" ? "https://${var.app_domain}" : "", var.app_url_fallback, "http://localhost:5173"])
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  id_token_validity                    = 60
  access_token_validity                = 60
  refresh_token_validity               = 30
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "roles" {
  for_each     = toset(["admin", "manager", "rep"])
  name         = each.key
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user" "first_admin" {
  user_pool_id             = aws_cognito_user_pool.main.id
  username                 = lower(var.admin_email)
  desired_delivery_mediums = ["EMAIL"]
  attributes = {
    email          = lower(var.admin_email)
    email_verified = true
    name           = var.admin_name
  }
  lifecycle {
    ignore_changes = [attributes, desired_delivery_mediums]
  }
}

resource "aws_cognito_user_in_group" "first_admin" {
  user_pool_id = aws_cognito_user_pool.main.id
  group_name   = aws_cognito_user_group.roles["admin"].name
  username     = aws_cognito_user.first_admin.username
}
