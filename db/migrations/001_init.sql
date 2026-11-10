-- Grodivo sales dashboard: initial schema
-- Segments, offerings and pricing follow the Grodivo business model:
-- four buyer segments, land-and-expand motion, one-time diagnostics plus PEPY kAI seats.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE segment AS ENUM ('pe', 'corporate_ma', 'consulting', 'cxo_board');
CREATE TYPE deal_stage AS ENUM (
  'lead', 'qualified', 'discovery', 'proposal', 'pilot', 'negotiation', 'closed_won', 'closed_lost'
);
CREATE TYPE deal_motion AS ENUM ('land', 'expand');
CREATE TYPE offering AS ENUM ('diagnostic', 'kai_subscription', 'enterprise_transformation', 'pilot');
CREATE TYPE deal_source AS ENUM ('direct', 'partner', 'referral', 'inbound', 'event', 'investor');
CREATE TYPE activity_type AS ENUM ('call', 'email', 'meeting', 'demo', 'note', 'task');
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'rep');

-- Users mirror Cognito identities; id = Cognito "sub". Rows are upserted on first API call.
CREATE TABLE users (
  id          uuid PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  role        user_role NOT NULL DEFAULT 'rep',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  segment           segment NOT NULL,
  parent_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL, -- e.g. PE firm -> portfolio company
  industry          text,
  employee_count    integer CHECK (employee_count >= 0),
  website           text,
  hq_location       text,
  owner_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_segment_idx ON accounts(segment);
CREATE INDEX accounts_parent_idx ON accounts(parent_account_id);
CREATE UNIQUE INDEX accounts_name_uniq ON accounts(lower(name));

CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  title       text,
  email       text,
  phone       text,
  linkedin_url text,
  is_champion boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_account_idx ON contacts(account_id);

CREATE TABLE deals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  name             text NOT NULL,
  owner_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  primary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  motion           deal_motion NOT NULL DEFAULT 'land',
  offering         offering NOT NULL,
  stage            deal_stage NOT NULL DEFAULT 'lead',
  -- Value: one-time program fee plus recurring kAI seats (PEPY = per employee per year)
  one_time_value   numeric(14,2) NOT NULL DEFAULT 0 CHECK (one_time_value >= 0),
  pepy_rate        numeric(10,2) NOT NULL DEFAULT 0 CHECK (pepy_rate >= 0),
  seats            integer NOT NULL DEFAULT 0 CHECK (seats >= 0),
  arr              numeric(14,2) GENERATED ALWAYS AS (pepy_rate * seats) STORED,
  probability      integer CHECK (probability BETWEEN 0 AND 100), -- null = stage default
  expected_close   date,
  closed_at        timestamptz,
  lost_reason      text,
  source           deal_source NOT NULL DEFAULT 'direct',
  partner_name     text,
  next_step        text,
  next_step_date   date,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deals_account_idx ON deals(account_id);
CREATE INDEX deals_owner_idx ON deals(owner_id);
CREATE INDEX deals_stage_idx ON deals(stage);
CREATE INDEX deals_close_idx ON deals(expected_close);

-- Default win probability by stage, editable by admins
CREATE TABLE stage_probabilities (
  stage       deal_stage PRIMARY KEY,
  probability integer NOT NULL CHECK (probability BETWEEN 0 AND 100),
  sort_order  integer NOT NULL
);
INSERT INTO stage_probabilities (stage, probability, sort_order) VALUES
  ('lead', 5, 1), ('qualified', 15, 2), ('discovery', 25, 3), ('proposal', 45, 4),
  ('pilot', 60, 5), ('negotiation', 80, 6), ('closed_won', 100, 7), ('closed_lost', 0, 8);

CREATE TABLE deal_stage_history (
  id          bigserial PRIMARY KEY,
  deal_id     uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage  deal_stage,
  to_stage    deal_stage NOT NULL,
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_stage_history_deal_idx ON deal_stage_history(deal_id, changed_at);

CREATE TABLE activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid REFERENCES deals(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  type        activity_type NOT NULL,
  summary     text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (deal_id IS NOT NULL OR account_id IS NOT NULL)
);
CREATE INDEX activities_deal_idx ON activities(deal_id, occurred_at DESC);
CREATE INDEX activities_account_idx ON activities(account_id, occurred_at DESC);
CREATE INDEX activities_user_idx ON activities(user_id, occurred_at DESC);

-- Targets: user_id NULL = company-wide target (e.g. $5M ARR)
CREATE TABLE quotas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  target_arr      numeric(14,2) NOT NULL DEFAULT 0,
  target_bookings numeric(14,2) NOT NULL DEFAULT 0, -- one-time program fees
  CHECK (period_end > period_start)
);
CREATE UNIQUE INDEX quotas_user_period_uniq
  ON quotas(COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end);

-- Keep updated_at fresh
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER deals_touch BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Record stage changes and stamp closed_at. The API sets app.user_id per transaction.
CREATE FUNCTION track_deal_stage() RETURNS trigger AS $$
DECLARE actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by)
      VALUES (NEW.id, NULL, NEW.stage, actor);
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by)
      VALUES (NEW.id, OLD.stage, NEW.stage, actor);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER deals_stage_history AFTER INSERT OR UPDATE OF stage ON deals
  FOR EACH ROW EXECUTE FUNCTION track_deal_stage();

CREATE FUNCTION stamp_closed_at() RETURNS trigger AS $$
BEGIN
  IF NEW.stage IN ('closed_won', 'closed_lost') THEN
    IF TG_OP = 'INSERT' OR OLD.stage NOT IN ('closed_won', 'closed_lost') THEN
      NEW.closed_at := COALESCE(NEW.closed_at, now());
    END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER deals_closed_at BEFORE INSERT OR UPDATE OF stage ON deals
  FOR EACH ROW EXECUTE FUNCTION stamp_closed_at();

-- Convenience view: open/closed deals with effective probability and weighted values
CREATE VIEW deal_metrics AS
SELECT d.*,
       a.name    AS account_name,
       a.segment AS segment,
       COALESCE(d.probability, sp.probability) AS effective_probability,
       ROUND(d.arr * COALESCE(d.probability, sp.probability) / 100.0, 2) AS weighted_arr,
       ROUND(d.one_time_value * COALESCE(d.probability, sp.probability) / 100.0, 2) AS weighted_one_time,
       d.stage NOT IN ('closed_won', 'closed_lost') AS is_open
FROM deals d
JOIN accounts a ON a.id = d.account_id
JOIN stage_probabilities sp ON sp.stage = d.stage;

-- Company target from the pre-seed plan: $5M ARR
INSERT INTO quotas (user_id, period_start, period_end, target_arr, target_bookings)
VALUES (NULL, DATE '2026-10-01', DATE '2027-12-31', 5000000, 0);
