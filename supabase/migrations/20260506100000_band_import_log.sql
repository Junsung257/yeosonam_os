CREATE TABLE IF NOT EXISTS band_import_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_url    text UNIQUE NOT NULL,
  post_title  text,
  raw_text    text,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'imported', 'skipped', 'failed')),
  error_msg   text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_band_import_log_product_id  ON band_import_log (product_id);
CREATE INDEX IF NOT EXISTS idx_band_import_log_status       ON band_import_log (status);
CREATE INDEX IF NOT EXISTS idx_band_import_log_imported_at  ON band_import_log (imported_at DESC);

ALTER TABLE band_import_log DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE band_import_log IS '밴드 RSS/붙여넣기 임포트 이력. post_url UNIQUE로 중복 방지.';
