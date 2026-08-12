-- Preserve historical physical-attempt truth before version-scoped retry begins.

update internal_product_registration.legacy_backfill_jobs
set total_attempt_count = greatest(total_attempt_count, attempt_count)
where total_attempt_count < attempt_count;
