# LP commitments (public pension board actions)

Source: the 35 Peaks **Pension Signal Monitor** (`Pension Signal Monitor/database/public_plans.db` in the 35 Peaks
project folder). It tracks U.S. public pension board actions: fund commitments, manager hires and terminations,
consultant changes, allocation changes and leadership moves. Most records come from the plans' own minutes and
board books (primary-source onboarding); the rest from secondary briefs.

**Why it matters for Grodivo:** a GP that just won pension commitments is about to deploy that capital into new
platforms and add-ons. That is the moment to offer diligence and integration support.

## What gets stored

`lp_signals`: all records, every asset class and action type, with plan, fund/counterparty, reconciled GP
(`manager_entity`), amount, the document (title, URL, type, date, primary/secondary) and the verbatim snippet.
The full original record is kept in `raw`. Upserts on the monitor's `signal_key`, so re-imports refresh in place.

As of the Nov 10, 2026 export: 1,958 records (1,222 from primary documents), 243 plans.

## In the dashboard

**LP commitments** page: GPs ranked by private-markets commitments and hires in the chosen window (6, 12 or
24 months; PE, venture, private credit, infrastructure), with plans, latest month, recent funds and an "In CRM" match.
Expand a GP to see every board action on file with links to the source documents. **Add to pipeline** creates or
reuses a PE account, opens a lead-stage deal (`New fund deployment: <GP>`, source `lp_signal`) and logs a note
listing the recent commitments with source links.

## Loading

```bash
cd services/api
# 1. Export (joins plans, counterparties, documents and reconciled entities)
npx tsx scripts/import-lp-signals.ts --export \
  ~/Documents/Claude/Projects/"35 Peaks"/"Pension Signal Monitor"/database/public_plans.db ./lp-export.json
# 2. Batches for the ingest Lambda (same S3 path as the other feeds)
npx tsx scripts/import-lp-signals.ts --out ./lp-batches ./lp-export.json
aws s3 cp ./lp-batches s3://grodivo-digests-<account-id>/signals/inbox/lp/ --recursive
```

The monitor refreshes monthly (3rd of the month), so re-running the three commands after that job keeps the
dashboard current.
