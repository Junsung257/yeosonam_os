-- Forward-only replay-safe indexes for foreign keys that predate the final
-- authority bundle. Supabase migrations run in a transaction, so bound lock
-- and statement waiting instead of using CREATE INDEX CONCURRENTLY here.
-- Production application remains blocked until the release preflight records
-- target row counts and an approved maintenance window.
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create index if not exists idx_pr_v62_price_lineage_price_override
  on internal_product_registration.departure_price_lineage(price_override_id);

create index if not exists idx_pr_v62_price_lineage_price_rule
  on internal_product_registration.departure_price_lineage(price_rule_id);
