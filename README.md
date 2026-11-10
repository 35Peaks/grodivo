# Grodivo Sales Dashboard

Internal sales dashboard for the Grodivo team.

- Frontend: React 19, TanStack Start, Tailwind, Vite (Cloudflare Workers)
- API: Hono on AWS Lambda behind API Gateway
- Data: PostgreSQL 16 (RDS), S3
- Auth: Amazon Cognito
- Jobs: EventBridge Scheduler, SQS, SES
- Infra: Terraform, deployed by GitHub Actions (OIDC)
