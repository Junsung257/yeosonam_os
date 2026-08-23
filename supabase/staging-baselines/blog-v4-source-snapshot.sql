-- Staging-only supplement for the information evidence repository.
--
-- Older Preview branches may already have the legacy baseline migration
-- recorded without this column. Keep the repair idempotent and outside the
-- production migration directory; the staging workflow assigns its own
-- migration version when it copies this file.

alter table public.blog_information_source_versions
  add column if not exists snapshot_content text;
