-- Staging-only repair for Preview branches created from the legacy baseline.
-- Evidence identity includes the immutable source version; the older
-- content_key/evidence_key-only constraint prevents a refreshed capture.

alter table public.blog_information_evidence
  drop constraint if exists blog_information_evidence_content_key_evidence_key_key;
