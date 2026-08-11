-- The publication RPC is intentionally unusable without an explicitly
-- enabled policy row. Seed the conservative first policy so a reviewed
-- package can reach the CAS gate instead of failing on missing configuration.

insert into public.product_registration_v5_publication_policies (
  policy_version,
  cohort,
  enabled,
  hard_blockers,
  risk_budget,
  rules
)
values (
  'v5-risk-policy-1',
  'verified-hwp-shadow-canary',
  true,
  '["critical_evidence_missing", "critical_conflict", "snapshot_proof_mismatch", "tenant_security_failure", "kill_switch_active"]'::jsonb,
  0.000000,
  '{"requires_mobile_packages": true, "requires_mobile_lp": true, "requires_critical_evidence": true, "ocr_auto_publish": false, "new_supplier_auto_publish": false}'::jsonb
)
on conflict (policy_version) do update
set enabled = excluded.enabled,
    cohort = excluded.cohort,
    hard_blockers = excluded.hard_blockers,
    risk_budget = excluded.risk_budget,
    rules = excluded.rules;
