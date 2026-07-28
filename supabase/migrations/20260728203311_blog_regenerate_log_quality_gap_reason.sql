-- Allow the published-research recovery fallback to record its durable lock.
-- The wider partial unique index also prevents the same slug from being
-- enqueued twice on one UTC day through different automatic recovery signals.

BEGIN;

ALTER TABLE public.blog_regenerate_log
  DROP CONSTRAINT IF EXISTS blog_regenerate_log_reason_check;

ALTER TABLE public.blog_regenerate_log
  ADD CONSTRAINT blog_regenerate_log_reason_check
  CHECK (
    reason IN (
      'zero_click',
      'rank_drop',
      'manual',
      'quality_gate_fail',
      'quality_gap'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS blog_regenerate_log_automatic_daily_unique
  ON public.blog_regenerate_log (slug, created_day_utc)
  WHERE reason IN ('zero_click', 'quality_gap');

COMMENT ON INDEX public.blog_regenerate_log_automatic_daily_unique IS
  'One automatic zero-click or missing-research recovery lock per slug and UTC day.';

COMMIT;
