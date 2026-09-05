-- Product registration V3 draft ledger sidecar.
-- Keeps raw source immutable and stores a reviewable ledger next to the current upload pipeline.

CREATE TABLE IF NOT EXISTS public.product_registration_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  raw_text TEXT NOT NULL,
  raw_text_hash TEXT NOT NULL,
  source_type TEXT,
  supplier_hint TEXT,
  document_type TEXT,
  structure_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  ledger JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_index JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  gate_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'parsed'
    CHECK (status IN ('parsed', 'needs_review', 'blocked', 'ready_to_publish', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_registration_drafts_hash
  ON public.product_registration_drafts(raw_text_hash);

CREATE INDEX IF NOT EXISTS idx_product_registration_drafts_package
  ON public.product_registration_drafts(package_id);

CREATE INDEX IF NOT EXISTS idx_product_registration_drafts_status
  ON public.product_registration_drafts(status, created_at DESC);

ALTER TABLE public.product_registration_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_registration_drafts service-role only" ON public.product_registration_drafts;
CREATE POLICY "product_registration_drafts service-role only"
  ON public.product_registration_drafts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.set_product_registration_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_registration_drafts_updated_at ON public.product_registration_drafts;
CREATE TRIGGER trg_product_registration_drafts_updated_at
  BEFORE UPDATE ON public.product_registration_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_product_registration_drafts_updated_at();

COMMENT ON TABLE public.product_registration_drafts IS
  'V3 sidecar draft ledger for upload registration. Customer-visible facts remain gated until evidence and render checks pass.';
