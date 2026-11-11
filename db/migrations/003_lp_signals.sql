-- Public pension (LP) board actions from the 35 Peaks Pension Signal Monitor: fund commitments, manager
-- hires/terminations, consultant changes, allocation changes and leadership moves, mostly from the plans'
-- own minutes and board books (source_type = 'primary').
-- For Grodivo: a GP that just won LP commitments is about to deploy into new deals, which is a diligence moment.

ALTER TYPE deal_source ADD VALUE IF NOT EXISTS 'lp_signal';

CREATE TABLE lp_signals (
  id              bigserial PRIMARY KEY,
  signal_key      text NOT NULL UNIQUE,         -- key from the Pension Signal Monitor DB
  period          text,
  event_month     date,                         -- first day of the event month
  signal_category text,                         -- Pacing / Manager / Allocation / Consultant / Leadership
  signal_type     text,
  asset_class     text,
  asset_group     text,                         -- normalized: private_equity, venture, private_credit, infrastructure, real_estate, hedge_funds, public, other
  plan            text,
  plan_type       text,
  state           text,
  region          text,
  aum_tier        text,
  counterparty    text,                         -- fund or firm named in the action
  manager_family  text,
  manager_entity  text,                         -- reconciled GP name (entity rollup)
  amount_usd_m    numeric(14,2),
  relevance       text,
  action_detail   text,
  source_snippet  text,
  source_name     text,
  source_title    text,
  source_url      text,
  source_type     text,                         -- primary / secondary
  doc_type        text,
  doc_date        date,
  retrieved_at    date,
  raw             jsonb NOT NULL,
  imported_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lp_signals_gp_idx ON lp_signals (lower(coalesce(manager_entity, manager_family)));
CREATE INDEX lp_signals_month_idx ON lp_signals (event_month DESC);
CREATE INDEX lp_signals_group_idx ON lp_signals (asset_group);
CREATE INDEX lp_signals_gp_trgm ON lp_signals USING gin (lower(coalesce(manager_entity, manager_family)) gin_trgm_ops);
