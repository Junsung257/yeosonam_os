-- Foreign keys are not indexed automatically. Keep price-rule joins and
-- deletes from scanning every departure fact while avoiding a write-blocking
-- index build on an existing ledger table.
create index concurrently if not exists idx_pr_v61_departure_price_rule
  on internal_product_registration.departure_instances(price_rule_id);
