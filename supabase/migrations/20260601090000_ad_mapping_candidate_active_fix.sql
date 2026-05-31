-- Keep the legacy active flag aligned with the Ad OS operational status.
-- Candidate/approved/testing mappings are planning records, not live ads.

UPDATE public.ad_landing_mappings
SET
  active = CASE
    WHEN operational_status IN ('active', 'winning', 'scaled') THEN TRUE
    ELSE FALSE
  END,
  updated_at = NOW()
WHERE operational_status IS NOT NULL
  AND active IS DISTINCT FROM (
    CASE
      WHEN operational_status IN ('active', 'winning', 'scaled') THEN TRUE
      ELSE FALSE
    END
  );
