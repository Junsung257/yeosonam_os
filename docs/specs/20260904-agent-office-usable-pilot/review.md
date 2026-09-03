# Review checklist

## Required

- No Production DB migration or external tool installation.
- No new Command or automatic delegation.
- API uses `requirePlatformAdminRequest` and `Cache-Control: private, no-store`.
- Attestation cannot issue a model turn and reports only booleans/hashes.
- UI labels stale/blocked state honestly and never presents a disabled button as executable.

## Verification evidence

- `node scripts/check-agent-workflow-contract.mjs --strict` — passed.
- `node scripts/check-agent-surfaces.mjs --spec 20260904-agent-office-usable-pilot --agent codex --base e5f0dd94d04e5b35ca3a507ca90e334975e758eb` — passed.
- Targeted Vitest — 6 files, 46 tests passed; full Vitest — 908 files, 6,721 passed, 7 skipped.
- TypeScript (`tsc --noEmit`) and ESLint (`npm run lint`) — passed.
- Local production build with `NODE_OPTIONS=--max-old-space-size=8192` — manifests verified.
- Playwright smoke with `ys-dev-admin=1`: `/admin` returned 200 with one `AI 운영실` link to `/admin/agent-mas`; `/admin/agent-mas` returned 200 and rendered `Technology Scout Pilot`; no Next error overlay.

The local dashboard smoke also reported the repository's expected missing-Supabase 500/503 responses for unrelated KPI endpoints. The Office route itself remained read-only and returned 200.

## Open risks

- Production does not contain `public.agent_runs`; the live durable pilot remains unavailable.
- Codex CLI protocol may change; attestation must be rerun after binary upgrades.
- Full live pilot still needs 20+ reviewed public cases and three identical-input trials.
