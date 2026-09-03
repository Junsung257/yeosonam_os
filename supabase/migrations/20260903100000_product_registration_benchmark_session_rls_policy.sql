-- Keep the human-review session ledger explicit under RLS. Privileges alone
-- are not a durable boundary if a future role grant or generated client is
-- introduced.
drop policy if exists benchmark_human_review_sessions_service_role
  on internal_product_registration.benchmark_human_review_sessions;
create policy benchmark_human_review_sessions_service_role
  on internal_product_registration.benchmark_human_review_sessions
  for all to service_role
  using (true)
  with check (true);

comment on table internal_product_registration.benchmark_human_review_sessions is
  'Private, short-lived reviewer session ledger. Service-role workers only; authenticated reviewers enter through the guarded RPC.';
