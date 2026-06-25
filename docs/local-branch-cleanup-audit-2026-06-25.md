# Local Branch Cleanup Audit - 2026-06-25

## Current Safe Base

- Active branch: `codex/unmatched-product-open-readiness`
- Latest reviewed commit: `da671c5f Bound upload review replay picker query`
- Working tree after cleanup: clean
- Production-critical Supabase/blog resource-saver changes are on this branch.

## Protected References

These refs intentionally preserve pre-cleanup work and must not be deleted until their topic is explicitly closed:

- `archive/cleanup-20260625/local-main`
- `archive/cleanup-20260625/upload-review-middleware`
- `archive/cleanup-20260625/marketing-readiness-integration`
- `archive/cleanup-20260625/unmatched-product-open-readiness`
- `archive/cleanup-20260625/stash-blog-autopublish-recovery`

## Remaining Candidates

- `stash@{0}` / `archive/cleanup-20260625/stash-blog-autopublish-recovery`
  - Topic: blog autopublish recovery and scheduling.
  - Status: most high-value publisher/scheduler concepts are already present in the current branch.
  - Do not apply wholesale; it can reintroduce older batch and cron assumptions.

- `main` worktree at `yeosonam-specialprice-split`
  - Topic: Jarvis/RAG, public query timeout, audit/build hardening.
  - Status: large and stale (`ahead 24 / behind 224` at cleanup time).
  - Do not merge wholesale; public blog list changes are older than the current single-query/resource-saver implementation.

- `codex-upload-review-middleware`
  - Topic: upload registration, offline audits, Supabase resource pressure.
  - Status: broad branch; core resource-saver utilities and resource-pressure migration already exist in current branch.
  - Applied on 2026-06-25: bounded `upload-review-auto-replay` picker query with `runSupabaseQueryWithTimeout`.

## Cleanup Already Done

- Removed safe merged `[gone]` local branches.
- Removed detached worktrees that were already contained in `origin/main`.
- Shared duplicated bounded env integer parsing via `src/lib/env-utils.ts`.
- Kept unmerged or topic-heavy branches untouched.

## Next Review Rules

- For blog autopublishing work, inspect the protected stash ref first and cherry-pick only specific hunks.
- For product upload work, compare against `archive/cleanup-20260625/upload-review-middleware` file-by-file.
- For Jarvis/RAG work, treat `archive/cleanup-20260625/local-main` as a separate integration project.
- Never merge any of these branches wholesale into the active production branch without a fresh diff and full build.
