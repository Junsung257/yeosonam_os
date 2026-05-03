-- Canonical uppercase referral_code (case-insensitive attribution, safe eq vs ilike/_ wildcard).
-- Run only after resolving any affiliates that differ only by letter case (duplicate lower(trim)).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT lower(trim(referral_code)) AS k
      FROM affiliates
      WHERE referral_code IS NOT NULL AND trim(referral_code) <> ''
      GROUP BY lower(trim(referral_code))
      HAVING count(*) > 1
    ) d
  ) THEN
    RAISE EXCEPTION 'migrate: affiliates.referral_code case-colliding rows — resolve manually then re-run';
  END IF;
END $$;

UPDATE affiliates
SET referral_code = upper(trim(referral_code))
WHERE referral_code IS NOT NULL AND referral_code <> upper(trim(referral_code));

UPDATE influencer_links
SET referral_code = upper(trim(referral_code))
WHERE referral_code IS NOT NULL AND referral_code <> upper(trim(referral_code));

UPDATE affiliate_touchpoints
SET referral_code = upper(trim(referral_code))
WHERE referral_code IS NOT NULL AND referral_code <> upper(trim(referral_code));

COMMIT;
