-- M&A news signals: deals in the news that create a Grodivo selling moment.
-- Fed daily (weekdays) by the news Lambda from FMP, GDELT and a Claude research pass.
-- Nothing enters the sales funnel automatically: a person actions each signal.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TYPE deal_source ADD VALUE IF NOT EXISTS 'news_signal';

CREATE TYPE signal_deal_status AS ENUM ('rumored', 'announced', 'pending', 'closed', 'terminated', 'unknown');
CREATE TYPE signal_deal_type AS ENUM (
  'pe_platform', 'pe_add_on', 'corporate_acquisition', 'merger', 'take_private', 'carve_out', 'other'
);
CREATE TYPE signal_status AS ENUM ('new', 'watching', 'actioned', 'dismissed', 'archived');
CREATE TYPE signal_origin AS ENUM ('fmp', 'gdelt', 'claude_research', 'manual', 'digest');

CREATE TABLE signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key       text NOT NULL UNIQUE,          -- normalized acquirer|target, or url hash
  headline         text NOT NULL,
  summary          text,
  deal_status      signal_deal_status NOT NULL DEFAULT 'unknown',
  deal_type        signal_deal_type NOT NULL DEFAULT 'other',
  acquirer         text,
  target           text,
  sponsor          text,                          -- PE sponsor behind the buyer, if any
  advisors         jsonb NOT NULL DEFAULT '[]',   -- [{name, role}] e.g. financial/legal/consulting advisor
  deal_value_usd_m numeric(14,2),
  sector           text,
  region           text,
  announced_on     date,
  -- Deal terms and sizing (whatever the sources report; null when not disclosed)
  acquirer_ticker  text,
  target_ticker    text,
  acquirer_hq      text,
  target_hq        text,
  target_employees integer CHECK (target_employees >= 0),   -- drives kAI seat sizing
  acquirer_employees integer CHECK (acquirer_employees >= 0),
  consideration    text,                          -- cash / stock / mixed / unknown
  price_per_share  numeric(14,4),
  premium_pct      numeric(8,2),
  expected_close   date,
  closed_on        date,
  financing        text,
  approvals        text,                          -- regulatory / shareholder approvals pending
  terms            jsonb NOT NULL DEFAULT '{}',   -- any other reported terms (earn-outs, break fees, rollover...)
  extracted        jsonb NOT NULL DEFAULT '{}',   -- latest full Claude extraction, verbatim
  fit_score        integer NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
  why_grodivo      text,                          -- the selling angle, one or two sentences
  prospects        jsonb NOT NULL DEFAULT '[]',   -- [{name, role, segment, angle}] who to pitch
  status           signal_status NOT NULL DEFAULT 'new',
  status_note      text,                          -- e.g. dismissal reason
  actioned_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  actioned_at      timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signals_status_idx ON signals(status, first_seen_at DESC);
CREATE INDEX signals_fit_idx ON signals(fit_score DESC);
CREATE INDEX signals_acquirer_trgm ON signals USING gin (lower(acquirer) gin_trgm_ops);
CREATE INDEX signals_target_trgm ON signals USING gin (lower(target) gin_trgm_ops);

-- Every article or filing that reported the deal (one signal, many sources)
CREATE TABLE signal_sources (
  id           bigserial PRIMARY KEY,
  signal_id    uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  origin       signal_origin NOT NULL,
  url          text NOT NULL,
  publisher    text,
  title        text,
  published_at timestamptz,
  raw          jsonb,                             -- the original record (FMP filing row, GDELT article, research citation)
  extracted    jsonb,                             -- what Claude extracted from this specific source
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id, url)
);
CREATE INDEX signal_sources_url_idx ON signal_sources(url);

-- What the team did with a signal: which account/deal it fed
CREATE TABLE signal_links (
  id          bigserial PRIMARY KEY,
  signal_id   uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id     uuid REFERENCES deals(id) ON DELETE SET NULL,
  role        text,                               -- acquirer / target / sponsor / advisor
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signal_links_signal_idx ON signal_links(signal_id);
CREATE INDEX signal_links_account_idx ON signal_links(account_id);

-- Fuzzy account matching for "already in our CRM" chips
CREATE INDEX accounts_name_trgm ON accounts USING gin (lower(name) gin_trgm_ops);

-- Deal history: every change to status, value, dates or parties, with the source that reported it
CREATE TABLE signal_events (
  id          bigserial PRIMARY KEY,
  signal_id   uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  origin      signal_origin,
  source_url  text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signal_events_signal_idx ON signal_events(signal_id, at);

-- Every candidate the feed looked at, kept or not, with Claude's reason. Full audit trail and tuning data.
CREATE TABLE signal_candidates (
  id          bigserial PRIMARY KEY,
  run_id      bigint,
  origin      signal_origin NOT NULL,
  url         text NOT NULL,
  title       text,
  published_at timestamptz,
  kept        boolean NOT NULL,
  reason      text,
  signal_id   uuid REFERENCES signals(id) ON DELETE SET NULL,
  raw         jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin, url)
);
CREATE INDEX signal_candidates_created_idx ON signal_candidates(created_at DESC);

-- Every item logged by the 35 Peaks / Group Black Dome scheduled digests (PE Weekly, Fashion is Finance,
-- Compute is Capital, WM Weekly, Fintech Weekly, Oil/Gas/Energy, ...), all deal types, kept verbatim.
-- Deal-type rows (M&A, buyout, add-on, take-private) also become signals; signal_id links them.
CREATE TABLE digest_items (
  id                 bigserial PRIMARY KEY,
  digest             text NOT NULL,
  date_logged        date,
  week_of            text,
  section            text,
  headline           text NOT NULL,
  url                text,
  firms_named        text[] NOT NULL DEFAULT '{}',
  sellers            text[] NOT NULL DEFAULT '{}',
  target_company     text,
  deal_type          text,
  deal_size_usd_m    numeric(14,2),
  source_publication text,
  summary            text,
  source_file        text,
  signal_id          uuid REFERENCES signals(id) ON DELETE SET NULL,
  raw                jsonb NOT NULL,
  imported_at        timestamptz NOT NULL DEFAULT now()
);
-- Same story logged by two digests (or re-imported) is one row
CREATE UNIQUE INDEX digest_items_story_uniq ON digest_items (coalesce(url, ''), lower(headline));
CREATE INDEX digest_items_type_idx ON digest_items(deal_type, date_logged DESC);
CREATE INDEX digest_items_firms_idx ON digest_items USING gin (firms_named);

-- One row per news run, so the team can see the feed is alive
CREATE TABLE signal_runs (
  id          bigserial PRIMARY KEY,
  origin      signal_origin NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  items_in    integer NOT NULL DEFAULT 0,
  created     integer NOT NULL DEFAULT 0,
  merged      integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  note        text
);
