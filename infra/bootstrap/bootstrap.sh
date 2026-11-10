#!/usr/bin/env bash
# One-time setup, run in AWS CloudShell (browser terminal in the AWS console).
# Creates the Terraform state bucket and the role GitHub Actions uses to deploy.
# Safe to re-run.
set -euo pipefail

REPO="${REPO:-35Peaks/grodivo}"
REGION="${REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="grodivo-tf-state-${ACCOUNT_ID}"
ROLE="grodivo-github-deploy"
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

echo "Account ${ACCOUNT_ID}, region ${REGION}, repo ${REPO}"

# 1. Terraform state bucket (versioned, encrypted, private)
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  echo "Created bucket $BUCKET"
fi
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 2. GitHub OIDC provider (shared by every repo in the account; may already exist from TVI)
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
  echo "Created GitHub OIDC provider"
fi

# 3. Deploy role: only the main branch / production environment of this repo can assume it
cat > /tmp/grodivo-trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": [
        "repo:${REPO}:ref:refs/heads/main",
        "repo:${REPO}:environment:production"
      ] }
    }
  }]
}
JSON
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document file:///tmp/grodivo-trust.json
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document file:///tmp/grodivo-trust.json \
    --description "GitHub Actions deploys for ${REPO}" --max-session-duration 3600 >/dev/null
  echo "Created role $ROLE"
fi
# Broad permissions so Terraform can manage VPC, RDS, Lambda, Cognito, IAM, etc.
# The trust policy above is what keeps this narrow: only this repo's main branch can use it.
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

echo
echo "Done. Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
echo "  AWS_DEPLOY_ROLE_ARN = arn:aws:iam::${ACCOUNT_ID}:role/${ROLE}"
echo "  TF_STATE_BUCKET     = ${BUCKET}"
