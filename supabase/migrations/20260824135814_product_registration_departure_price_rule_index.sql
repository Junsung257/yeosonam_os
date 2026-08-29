-- Foreign keys are not indexed automatically. Supabase applies migrations in a
-- transaction, where CREATE INDEX CONCURRENTLY is invalid. Bound lock waiting
-- so a busy ledger fails closed and can be retried during the publication
-- freeze rather than blocking live writes indefinitely.
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create index if not exists idx_pr_v61_departure_price_rule
  on internal_product_registration.departure_instances(price_rule_id);
