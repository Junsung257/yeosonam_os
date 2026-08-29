-- The claim ledger is already deployed in some environments. Keep this
-- forward-only index migration idempotent for existing and fresh databases.
create index concurrently if not exists idx_blog_generation_dedup_claims_creative
  on public.blog_generation_dedup_claims(content_creative_id);
