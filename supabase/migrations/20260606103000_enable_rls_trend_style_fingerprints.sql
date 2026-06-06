-- Public schema table must not be exposed through PostgREST without RLS.
-- No client-facing policies are added; server-side service-role access remains available.

ALTER TABLE public.trend_style_fingerprints ENABLE ROW LEVEL SECURITY;
