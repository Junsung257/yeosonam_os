# 2026-09-01 하네스 문서 통합 매핑

상태: historical record
기준 branch: `codex/harness-doc-remediation-20260901`
통합 기준점: `origin/main@421e81bb4f1394b17e8039dba4919a28825b68ba`

| 기존 경로 | 처리 | 현재 권위 또는 보관 경로 |
|---|---|---|
| `CURRENT_STATUS.md` 장문 상태 로그 | 이동·대체 | `docs/archive/status/2026-09-01-current-status-pre-refactor.md` → 새 짧은 `CURRENT_STATUS.md` |
| `docs/agent-superpowers-adoption.md` | 통합·이동 | `docs/agent-workflow-current-ssot.md`, `docs/archive/harness/agent-superpowers-adoption.md` |
| `docs/agency-agents-adoption.md` | 통합·이동 | `docs/agent-workflow-current-ssot.md`, `docs/archive/harness/agency-agents-adoption.md` |
| `docs/99_NEXT_STEPS.md` | 이동 | `docs/archive/harness/99_NEXT_STEPS.md` |
| `docs/ai-automation-implementation.md` | 통합·이동 | `docs/ai-ops-current-ssot.md`, `docs/archive/ai-automation/ai-automation-implementation.md` |
| `docs/ai-automation-runbook.md` | 통합·이동 | `docs/ai-ops-current-ssot.md`, `docs/archive/ai-automation/ai-automation-runbook.md` |
| `docs/*_COMPLETE.md`·`docs/AUTOMATION_COMPLETE.md` | 이동 | `docs/archive/completions/` |
| `.claude/skills` 수동 원본 | 대체 | `.agents/skills` 원본 → 생성 mirror |
| 정적 route/migration 상태 목록 | 대체 | `docs/generated/system-inventory.*` |

## 복구 지점

- 원래 사용 중인 dirty 작업 폴더: 이 브랜치 밖의 사용자 작업공간이며 이 리팩터링에서 수정하지 않음
- 이전 격리 스냅샷 브랜치: `codex/harness-doc-refactor-20260901`, 보존 commit `b1e8b9d4b`
- 최신 main 기반 복구 지점: `421e81bb4f1394b17e8039dba4919a28825b68ba`
- Research Node 통합 merge: 이 브랜치의 `b08e2ac77`

복구는 파일 삭제나 hard reset이 아니라 위 Git 기준점에서 필요한 파일을 선택 복원하는 방식으로 수행한다.
