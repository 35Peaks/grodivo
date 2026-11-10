variable "region" {
  type    = string
  default = "us-east-1"
}

variable "app_domain" {
  description = "Custom domain for the dashboard on Cloudflare, e.g. grodivo.35peaks.co"
  type        = string
}

variable "app_url_fallback" {
  description = "Used when app_domain is empty (e.g. the workers.dev URL)"
  type        = string
  default     = ""
}

variable "admin_email" {
  description = "First admin user; receives a Cognito invitation with a temporary password"
  type        = string
}

variable "admin_name" {
  type    = string
  default = "Admin"
}

variable "digest_from_address" {
  description = "Sender for the weekly digest. Must be on an SES-verified domain or address."
  type        = string
}

variable "digest_schedule" {
  description = "EventBridge Scheduler cron for the weekly digest (America/New_York)"
  type        = string
  default     = "cron(0 7 ? * MON *)"
}

variable "claude_model" {
  type    = string
  default = "claude-sonnet-5-5"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "create_sender_identity" {
  description = "Create an SES identity for digest_from_address (only needed if its domain isn't verified in SES)"
  type        = bool
  default     = false
}
