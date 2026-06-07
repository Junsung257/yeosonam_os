BEGIN;

CREATE TABLE IF NOT EXISTS product_registration_improvement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  upload_id TEXT,
  product_id TEXT,
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  attempt_no INTEGER NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),

  raw_text_hash CHAR(64) NOT NULL,
  section_raw_text_hash CHAR(64),
  parser_version TEXT NOT NULL DEFAULT 'product-registration-central',
  detected_format TEXT NOT NULL DEFAULT 'unknown',

  final_status TEXT NOT NULL CHECK (final_status IN ('PASS', 'AUTO_FIXED', 'REVIEW_NEEDED', 'BLOCKED')),
  blockers_before JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  normalized_blocker_signatures TEXT[] NOT NULL DEFAULT '{}',
  evidence_spans JSONB NOT NULL DEFAULT '[]'::jsonb,
  compared_fields TEXT[] NOT NULL DEFAULT '{}',
  auto_fixes_applied JSONB NOT NULL DEFAULT '[]'::jsonb,
  packages_audit JSONB NOT NULL DEFAULT '{}'::jsonb,
  a4_audit JSONB NOT NULL DEFAULT '{}'::jsonb,

  fixture_candidate BOOLEAN NOT NULL DEFAULT false,
  rule_candidate BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_created
  ON product_registration_improvement_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_raw_hash
  ON product_registration_improvement_events (raw_text_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_package
  ON product_registration_improvement_events (package_id, created_at DESC)
  WHERE package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_status
  ON product_registration_improvement_events (final_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_format
  ON product_registration_improvement_events (detected_format, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_blockers
  ON product_registration_improvement_events USING gin (normalized_blocker_signatures);

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_rule_candidates
  ON product_registration_improvement_events (created_at DESC)
  WHERE rule_candidate = true;

COMMENT ON TABLE product_registration_improvement_events IS
  'Append-only shadow ledger for product-registration micro QA and macro pattern mining. Stores hashes, blockers, render audit, and evidence spans, not supplier raw text.';

COMMENT ON COLUMN product_registration_improvement_events.raw_text_hash IS
  'SHA-256 hash of the upload or product section raw text. Raw text is intentionally not stored here.';

ALTER TABLE product_registration_improvement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_registration_improvement_events_service_role"
  ON product_registration_improvement_events;

CREATE POLICY "product_registration_improvement_events_service_role"
  ON product_registration_improvement_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
