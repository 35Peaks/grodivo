# Grodivo Sales Dashboard

Internal pipeline and revenue dashboard for the Grodivo sales team. The dashboard is the system of
record for deals: reps create accounts, deals, contacts and activity here, and everyone on the team
sees the full pipeline.

## What it does

- **Overview**: contracted ARR vs. the company target, open and weighted pipeline, win rate,
  pipeline by segment (PE firms, Corporate M&A, Consulting/Advisory, CXOs & Boards) and by stage,
  a six-month weighted forecast, revenue mix (recurring kAI seats vs. one-time fees),
  land vs. expand, paid-pilot conversion, and deals needing attention.
- **Pipeline**: filterable deal table with inline stage changes and CSV export.
- **Deals**: value modeled as one-time fee + PEPY rate × seats, stage history, activity log.
- **Accounts**: parent/child links (PE firm → portfolio companies), land-and-expand timeline,
  contacts, seat potential.
- **Team**: rep scorecards for the quarter with quota attainment.
- **Admin**: invite users and set roles (admin / manager / rep), targets and quotas,
  stage probabilities.
- **Weekly digest**: Monday 7am ET email with pipeline totals, stage changes, new deals,
  overdue deals, and a short Claude-written commentary.

## Architecture

| Layer | Service |
|---|---|
| Frontend | React 19, TanStack Router + Query, Tailwind 4, Vite, served from Cloudflare Workers |
| Auth | Amazon Cognito (invite-only, optional TOTP MFA), JWT-validated at API Gateway |
| API | API Gateway HTTP API → Lambda (Node 22, Hono) |
| Database | RDS PostgreSQL 16 in private subnets, KMS-encrypted, 14-day backups |
| Jobs | EventBridge Scheduler → digest Lambda → S3 → notify Lambda → Claude + SES |
| Secrets | KMS, Secrets Manager |
| Delivery | GitHub Actions (OIDC to AWS, no stored keys), Terraform, Wrangler |

There is no NAT gateway. Lambdas that need the database run in the VPC and reach S3 through a free
gateway endpoint; Lambdas that need the internet (Cognito admin, Claude, SES) run outside the VPC.

```
apps/web          Dashboard (Cloudflare Workers static assets)
services/api      Lambda handlers: api, admin, migrate, digest, notify
db/migrations     SQL migrations, applied by the migrate Lambda on every deploy
infra             Terraform (state in S3: grodivo-tf-state-<account-id>)
infra/bootstrap   One-time CloudShell script: state bucket + GitHub deploy role
```

## First-time setup

1. **Bootstrap AWS (once).** In the AWS console, open CloudShell and run:
   ```bash
   git clone https://github.com/35Peaks/grodivo.git && bash grodivo/infra/bootstrap/bootstrap.sh
   ```
   If the repo is private, upload `infra/bootstrap/bootstrap.sh` through CloudShell's
   Actions → Upload file instead and run `bash bootstrap.sh`.
2. **GitHub repository variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable | Example |
   |---|---|
   | `AWS_DEPLOY_ROLE_ARN` | printed by the bootstrap script |
   | `TF_STATE_BUCKET` | printed by the bootstrap script |
   | `APP_DOMAIN` | `grodivo.35peaks.co` |
   | `ADMIN_EMAIL` | optional; defaults to `info@35peaks.co` |
   | `ADMIN_NAME` | optional |
   | `DIGEST_FROM_ADDRESS` | e.g. `sales@35peaks.co` (domain verified in SES) |
   | `CREATE_SENDER_IDENTITY` | `true` only if that domain is *not* verified in SES |

3. **GitHub secrets**: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", scoped to the
   account and the `35peaks.co` zone) and `CLOUDFLARE_ACCOUNT_ID`.
4. **Deploy**: Actions → Deploy → Run workflow (or push to `main`). The first run takes about
   15 minutes, mostly creating the database.
5. **Claude key for the digest** (optional; the digest sends without commentary until set):
   ```bash
   aws secretsmanager put-secret-value --secret-id grodivo/anthropic-api-key --secret-string 'sk-ant-...'
   ```
6. **Sign in**: the admin receives a Cognito email with a temporary password. Invite the rest of
   the team from Admin.

## Everyday changes

Every merge to `main` runs Terraform, applies new migrations, and redeploys the dashboard.
Pull requests run typecheck, build, a migration test against Postgres 16, and `terraform validate`.

To add a column or table, add `db/migrations/00N_description.sql`. Migrations run once, in order,
inside a transaction.

## Local development

```bash
npm install
# API against a local Postgres
DATABASE_URL=postgres://localhost/grodivo DATABASE_SSL=false \
LOCAL_DEV_USER='{"sub":"11111111-1111-1111-1111-111111111111","email":"you@example.com","name":"You","cognito:groups":"[admin]"}' \
npm run dev -w services/api
# Dashboard without Cognito
VITE_AUTH_DISABLED=true VITE_API_URL=http://localhost:8787 npm run dev -w apps/web
```

## Costs (approximate, monthly)

RDS db.t4g.micro + 20 GB gp3 ≈ $15, KMS ≈ $1, Secrets Manager ≈ $1, Lambda/API Gateway/S3/
Scheduler/SES at this volume ≈ $0–2. Cloudflare Workers static assets are free.

## Known trade-offs (v1)

- Lambdas get the database URL through KMS-encrypted environment variables instead of reading
  Secrets Manager at runtime, which would need a ~$15/month VPC interface endpoint.
- The GitHub deploy role has AdministratorAccess, limited by its trust policy to this repo's
  `main` branch. Scope it down once the infrastructure settles.
- Single-AZ database. Turn on `multi_az` in `infra/database.tf` when the team depends on it daily.
