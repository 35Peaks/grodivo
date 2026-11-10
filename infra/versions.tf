terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
  }

  # Bucket is passed at init time: terraform init -backend-config="bucket=grodivo-tf-state-<account-id>"
  backend "s3" {
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "grodivo-sales", ManagedBy = "terraform", Repo = "35Peaks/grodivo" }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  name       = "grodivo"
  account_id = data.aws_caller_identity.current.account_id
  app_url    = var.app_domain != "" ? "https://${var.app_domain}" : var.app_url_fallback
  dist       = "${path.module}/../services/api/dist"
}
