ALTER TABLE public.indexing_reports
  ADD COLUMN IF NOT EXISTS google_index_verdict text,
  ADD COLUMN IF NOT EXISTS google_coverage_state text,
  ADD COLUMN IF NOT EXISTS google_indexing_state text,
  ADD COLUMN IF NOT EXISTS google_last_crawl_time timestamptz,
  ADD COLUMN IF NOT EXISTS google_page_fetch_state text,
  ADD COLUMN IF NOT EXISTS google_canonical text,
  ADD COLUMN IF NOT EXISTS user_canonical text;

CREATE INDEX IF NOT EXISTS idx_ir_google_index_verdict
  ON public.indexing_reports (google_index_verdict, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_ir_url_reported
  ON public.indexing_reports (url, reported_at DESC);
