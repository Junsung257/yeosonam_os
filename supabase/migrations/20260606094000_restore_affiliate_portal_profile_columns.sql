BEGIN;

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS grade_label text,
  ADD COLUMN IF NOT EXISTS grade_rate numeric,
  ADD COLUMN IF NOT EXISTS logo_url text;

UPDATE public.affiliates
SET grade_label = CASE COALESCE(grade, 1)
  WHEN 1 THEN 'Bronze'
  WHEN 2 THEN 'Silver'
  WHEN 3 THEN 'Gold'
  WHEN 4 THEN 'Platinum'
  ELSE 'Partner'
END
WHERE grade_label IS NULL;

COMMENT ON COLUMN public.affiliates.grade_label IS 'Partner portal display grade label.';
COMMENT ON COLUMN public.affiliates.grade_rate IS 'Optional display commission/benefit rate for partner portal.';
COMMENT ON COLUMN public.affiliates.logo_url IS 'Optional partner logo URL for co-branded surfaces.';

NOTIFY pgrst, 'reload schema';

COMMIT;
