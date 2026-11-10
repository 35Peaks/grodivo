# M&A signals

Deals in the news that create a Grodivo selling moment, delivered to the dashboard each weekday
morning and turned into pipeline by a person, never automatically.

## How it works

Modeled on the MML intelligence spine: feeders gather and cite, one consolidation step dedupes into
a single database, and people decide what moves.

```
EventBridge Scheduler (weekdays 6:30 ET)
  -> news Lambda (outside VPC)
       FMP latest M&A filings  -+
       GDELT news headlines     +-> Claude classifies, scores fit 0-100, writes the "why Grodivo" angle
       Claude web research     -+   and the prospects to pitch (acquirer / sponsor / target / advisor)
  -> s3://grodivo-digests-<acct>/signals/inbox/<date>/<origin>.json
  -> ingest Lambda (inside VPC, via S3 gateway endpoint)
       validate -> dedupe (normalized acquirer|target, then fuzzy match within 30 days) -> upsert
  -> Postgres: signals, signal_sources, signal_links, signal_runs
  -> Dashboard: M&A signals page
```

Each source runs independently; one failing never blocks the others. Claude output is only accepted when
it maps back to a real candidate (FMP/GDELT) or carries the URL of the article it read (research pass).

## What gets stored

Everything the feed sees is kept in Postgres, so deal data accumulates over time.

| Table | Contents |
|---|---|
| `signals` | One row per deal: parties, tickers, HQs, status, type, value, target and buyer headcount, consideration, price per share, premium, announced / expected close / closed dates, financing, pending approvals, any other terms (`terms` JSON), fit score, Grodivo angle, prospects, and Claude's latest full extraction verbatim (`extracted`) |
| `signal_sources` | Every article or filing that reported the deal, with the provider's original record (`raw`: FMP filing row, GDELT article, research citation) and what Claude extracted from that source |
| `signal_events` | Deal history: each change to status, value, expected close, closed date, terms or headcount, with the source that reported it |
| `signal_candidates` | Every item the feed looked at, kept or dropped, with Claude's reason, raw record and the signal it became |
| `signal_links` | Which accounts and deals each signal fed |
| `signal_runs` | Each run: source, items in, created, merged, rejected |

The raw S3 batches are also retained for 365 days. `GET /signals/:id` returns the full record including raw sources;
`GET /signals/candidates/recent` lists everything the feed considered.

## What the sales team does with a signal

| Action | Effect |
|---|---|
| Add to pipeline | Creates the account (or reuses a matching one), a lead-stage $35K diagnostic deal (`land`, or `expand` if the account is already a customer), a note with the source link, and links the signal |
| Add other company | Same, for any party in the deal not suggested by Claude |
| Watch | Parks it; reopen anytime |
| Dismiss | Requires a reason, which we can use to tune the prompts |
| Add a deal you heard about | Manual entry, same dedupe |

## Fit score guide (from the Claude brief)

- 80+: pre-close deal with a clear buyer and 500+ employees involved, or PE platform/add-on with a named sponsor
- 50-79: relevant but closed, smaller, or missing a buyer
- under 50: weak (property, tiny tuck-ins, pure financing)

The brief lives in `services/api/src/lib/claude-signals.ts` (`GRODIVO_BRIEF`). Editing it is the main tuning lever.

## Setup after deploy

```bash
aws secretsmanager put-secret-value --secret-id grodivo/fmp-api-key --secret-string '<FMP key>'
aws secretsmanager put-secret-value --secret-id grodivo/anthropic-api-key --secret-string 'sk-ant-...'
# optional: run once now instead of waiting for 6:30 ET
aws lambda invoke --function-name grodivo-news --cli-read-timeout 900 /tmp/news.json && cat /tmp/news.json
```

- GDELT needs no key. Without an FMP key the FMP source is skipped; the other two still run.
- The Anthropic key needs web search enabled in the Claude Console for the research pass.

## Cost (approximate, weekdays)

Claude: about 3-6 calls per run (headline batches of 40 plus one research call with up to 10 searches),
roughly $15-40/month on Sonnet. Lambda, S3 and Scheduler are pennies. FMP depends on your existing plan.

## Not yet verified in production

These outside services were not reachable from the build environment, so they are tested with fixtures only:
FMP response shape (`symbol`, `companyName`, `targetedCompanyName`, `acceptedDate`, `link`), GDELT DOC 2.0
query syntax, and the Claude web search tool call. Watch the first runs in CloudWatch (`/aws/lambda/grodivo-news`)
and the "Feed health" line at the bottom of the Signals page.
