-- LP·상품 리드에 광고 키워드(utm_term) 저장 — 테이블이 없으면 스킵
DO $$
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'utm_term'
  ) THEN
    RETURN;
  END IF;
  ALTER TABLE public.leads ADD COLUMN utm_term text;
END $$;
