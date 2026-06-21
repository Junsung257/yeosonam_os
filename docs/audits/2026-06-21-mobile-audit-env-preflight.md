# 2026-06-21 Mobile Audit Env Preflight

## Context

During upload-inbox registration recovery, the mobile/A4 readiness audit was run with `.env.prod` loaded. That local file had `SUPABASE_SERVICE_ROLE_KEY=xxx`, so Supabase correctly rejected the request with `Invalid API key`. On Windows the process also emitted a low-level Node assertion after the failed Supabase call, which made the real cause look like a runtime crash instead of a configuration problem.

## Engine Rule

`scripts/audit-product-mobile-landing-readiness.mjs` now fails before any Supabase query when the admin key is missing or clearly a placeholder such as `xxx`, `placeholder`, `your_*`, or `replace_me`.

This is an operator-safety rule only. It does not mark products customer-ready and does not weaken the mobile/A4 proof requirement.

## Verification

```text
DOTENV_CONFIG_PATH=.env.prod node -r dotenv/config scripts/audit-product-mobile-landing-readiness.mjs --public-only --strict --limit=1 --json
```

Expected result with the current local placeholder env:

```text
Invalid Supabase admin configuration: service role key is a placeholder.
```

Actual product registration and customer mobile proof still require a valid server-side Supabase service role key or a valid admin-authenticated upload session.
