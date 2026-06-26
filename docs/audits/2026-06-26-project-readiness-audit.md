# 2026-06-26 Project Readiness Audit

This is an evidence note for the local workspace consolidation check before continuing development in `C:\dev\yeosonam-os`.

Current SSOT files remain the source of truth. This audit records what was checked, what passed, what was optimized, and what should still be fixed before production-facing changes.

## Verdict

- Local development can continue from this folder.
- Local `main` is aligned with `origin/main` at `d1188292` (`Fix Guangzhou transport variant catalog split (#423)`).
- Stale external worktree records were pruned; `git worktree list` now shows only `C:/dev/yeosonam-os`.
- No merge conflict markers were found in tracked project files.
- Type-check, targeted product-registration test, runtime env verification, doc automation check, and production build passed.
- Vercel MCP and Supabase MCP are connected and usable.
- Follow-up optimization completed:
  - local Vercel CLI project metadata restored through ignored `.vercel/project.json`
  - safe Supabase CLI config added at `supabase/config.toml`
  - `.env.local` dotenv parser compatibility fixed without exposing values
  - remote Supabase `upsert_unmatched_activity` RPC execute access restricted to `service_role`
  - remote Supabase `touch_entity_master_candidates_updated_at` search path fixed

## Remaining Local Changes

These were left untouched and should be intentionally reviewed before the next commit:

- `src/app/blog/destination/[dest]/page.tsx`
- `docs/local-repo-topology-audit-2026-06-26.md`
- `supabase/config.toml`
- `supabase/migrations/20260626060903_harden_unmatched_rpc_and_touch_function.sql`

## Verification Commands

The following checks passed:

- `npm run type-check`
- `npm test -- src/lib/product-registration/catalog-split-recovery.test.ts`
- `npm run verify:runtime-env-docs`
- `npm run verify:runtime-env-code`
- `npm run verify:runtime-env-wiring`
- `npm run check:doc-automation`
- `npm run build`

Build evidence:

- Next.js build completed successfully.
- Static page generation completed (`388/388`).
- Vercel function budget check reported `24/50` entries.

## Vercel Findings

- MCP project access works for project `os`.
- Latest production deployment is `READY`.
- Production deployment commit matched local `origin/main` after fetching: `d1188292`.
- Runtime logs show repeated blog list query timeout warnings and `BLOG_DATABASE_UNAVAILABLE`.
- Runtime logs show `/api/cron/blog-publisher` timing out at Vercel's 300 second execution limit.
- Runtime logs include missing optional/default integration variables for several publishing and ad channels.
- Local Vercel CLI is installed.
- `.vercel/project.json` was restored locally using project `os` metadata. The `.vercel` directory is ignored and should remain untracked.

## Supabase Findings

- MCP access works.
- Local project ref points to active project `ixaxnvbmhzjvupissmly`.
- Supabase project health is `ACTIVE_HEALTHY`.
- Supabase CLI now runs from this workspace after adding `supabase/config.toml` and fixing `.env.local` parser compatibility.
- Supabase migration history has substantial historical local/remote drift. Do not run broad `db push`; use targeted migrations only until history is reconciled.
- The raw-label unmatched RPC body and public blog hotpath indexes were already present in the remote database even though related local migration versions were not recorded in remote history.
- Applied remote migration `20260626060903_harden_unmatched_rpc_and_touch_function` through Supabase MCP.
- Security advisor follow-up:
  - fixed mutable function search path for `public.touch_entity_master_candidates_updated_at`
  - fixed public/anon and authenticated execution access to `SECURITY DEFINER` unmatched-activity upsert functions
  - remaining WARN: leaked password protection disabled, which is an Auth/dashboard setting
- Performance advisor reports duplicate indexes in:
  - `public.content_creatives`
  - `public.content_distributions`
  - `public.cron_run_logs`
- Recent database logs include:
  - missing `processed_at` column references
  - vector operator mismatch involving `extensions.vector`

## Documentation Findings

- Core operating docs and rules were readable as UTF-8.
- The terminal displayed Korean mojibake in some PowerShell reads, but direct UTF-8 file reads were valid.
- `CURRENT_STATUS.md` is dated `2026-05-28`, so it should be refreshed before using it as a current project-state handoff.
- Runtime environment documentation verification passed.
- Document automation verification passed.

## Configuration Findings

- Local Node version matches the project engine expectation: Node `24.x`.
- The repository uses `package-lock.json`; no alternate package-manager lockfile was found.
- `.mcp.json` exists locally and is ignored by git. It contains sensitive MCP credentials and must remain untracked.
- `.env.local` is ignored by git.
- `.env.prod` is tracked; before any commit touching environment files, confirm it contains placeholders only.
- `supabase/config.toml` is now present and contains no secret values.
- `.vercel/project.json` is now present locally and ignored by git.

## Recommended Next Gates

Before production-impacting development:

1. Reconcile historical Supabase migration drift before using broad migration commands.
2. Enable Supabase Auth leaked password protection from the dashboard if plan/settings allow it.
3. Investigate blog query timeouts and the blog publisher cron timeout.
4. Refresh `CURRENT_STATUS.md`.
5. Keep `.mcp.json`, `.env.local`, and `.vercel/` untracked.
