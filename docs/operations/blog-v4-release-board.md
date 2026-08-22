# Blog V4 Release Board

이 문서는 Blog V4의 코드 통합, staging canary, production 승격 상태를 기록하는 단일 운영 원장이다. 범위는 Yeosonam Blog V4, draft canary, `pilot_3`에 한정한다.

## Current board

| Field | Current value |
|---|---|
| `current_gate` | `BASELINE_PR_1141_CODE_GATE=PASS; PR_1141=APPROVAL_PENDING` |
| `code_status` | `PR #1141 OPEN; required checks PASS; required approval 1건 대기; PR #1140 DRAFT` |
| `integration_status` | `LOCAL_INTEGRATION_CORE=PASS; isolated preview worktree clean; remote-evidence/prepare safety split implemented locally` |
| `staging_status` | `STAGING_CANARY_INFRA_READY=NO; verified Preview ref/credentials/workdir evidence 없음` |
| `canary_status` | `REAL_ARTICLE_GENERATED=NO; draft canary not started` |
| `production_status` | `PRODUCTION_READY=NO; AUTO_PUBLISHING=OFF` |
| `blocker` | `PR #1141 required approval 1건; 이후 persistent Supabase Preview ref·전용 credential·격리 workdir 증거 필요` |
| `blocker_owner` | `PR reviewer: 승인 담당자; staging infra: 사용자/운영자` |
| `next_executable_action` | `PR #1141 승인·병합 후 origin/main SHA 기록 → #1140 clean worktree rebase → Preview ref/credential/workdir 검증 → migration history read` |

## Evidence ledger

- `BASELINE_MAIN_SHA` last observed before this board: `28fa9f5a19ad6e4bfcc5e22237b938ec234baf22`.
- Local integration commit: `e96acfeb117eaac3ee84190052ce9a02652e84c5`.
- Safety guard commit A: `2984e4287` (`refactor(blog): make Supabase release preparation evidence-only`).
- Documentation commit B contains this board and the workflow plans; its final SHA is recorded in the handoff after commit creation.
- Required PR #1141 checks were green; the non-required `readiness` check is not a merge blocker.
- Full default Vitest had three timeout failures; the three files passed when rerun with larger per-file timeouts. The default full-suite command remains not green.
- `check:deadcode` reports `new=396`; the same result reproduces in the clean #1140 worktree, so it is not attributed to the local #1141 merge.
- `check:agent-workflow:ci` previously reported three missing `plan.md` files; those documents are being restored in this integration worktree.
- The old prepare script performed one read-only linked migration-history query while the linked metadata pointed to the Production ref. No mutation followed.

## Side-effect counters

| Counter | Current value | Meaning |
|---|---:|---|
| `production_writes` | `0` | No migration apply, seed, update, publication, or environment mutation. |
| `production_reads` | `1` | One historical read-only migration-history query occurred before the new guard; no further remote query is authorized until Preview evidence exists. |
| `AI_calls` | `0` | No DeepSeek/other provider call. |
| `publications` | `0` | No production or public publication. |
| `indexing_side_effects` | `0` | No sitemap/RSS/IndexNow/indexing-outbox side effect. |

## Hard stops

- Do not rerun any prepare script until a verified Preview evidence JSON exists.
- Do not run `supabase db push`, migration apply, seed, candidate generation, Vercel Preview deployment, production environment changes, or autopublishing from this board state.
- Do not checkout, rebase, reset, or otherwise alter the primary dirty worktree with 71 changes.
