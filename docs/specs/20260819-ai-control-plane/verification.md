# Verification log

## Local verification

- AI control-plane, gateway contract, and migration tests: 13/13 passed.
- Blog V4 required lane: 39 files, 242 tests passed.
- Blog publisher/gateway/caller regression subset: 42/42 passed.
- Type-check: passed.
- Targeted ESLint: passed with zero warnings.
- `verify:ai-direct-call-guard`: passed with the explicit legacy migration
  allowlist; no new direct provider caller is allowed.
- `verify:ai-control-plane-migration`: passed exact migration/rollback hashes.
- Production build: passed on Windows with `NEXT_BUILD_MAX_OLD_SPACE_SIZE=8192`;
  local build logged the expected service-role-missing sitemap warning and
  completed output verification.

Production DB apply, production deployment, and API-key changes are explicitly
not performed in this worktree.
