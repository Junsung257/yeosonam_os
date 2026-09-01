-- The legacy job updates public.products directly and is rejected by the
-- product-registration authority guard. Keep its history and definition for
-- auditability, but stop the daily failing execution. A replacement must use
-- the canonical product authority command before this job can be reactivated.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed; expire-products-daily retirement skipped';
    RETURN;
  END IF;

  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'expire-products-daily';

  IF v_job_id IS NULL THEN
    RAISE NOTICE 'expire-products-daily does not exist; nothing to retire';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id := v_job_id, active := false);
END
$$;
