# 2026-09-01 문서·AI 하네스 통합 리팩터링 감사

상태: implementation verified, three operational follow-ups open
담당: platform-engineering
기준: `origin/main@421e81bb4f1394b17e8039dba4919a28825b68ba`
브랜치: `codex/harness-doc-remediation-20260901`
Research Node 통합: `b08e2ac77`
dirty 작업 보존 snapshot: `b1e8b9d4b`

## 결론

문서 권위, 에이전트 지침, 스킬 원본, Spec lifecycle, 생성 inventory, CI와 평가 하네스를 하나의 검사 경로로 통합했다. 기존 제품 기능과 Production 공개 DB/API 계약은 변경하지 않았고, PR #1217의 격리된 내부 Research intake만 통합했다. Research Node에는 Production 직접 권한을 추가하지 않았으며 intake 경계의 fail-closed rate limit과 수집 transport의 DNS pinning을 보강했다.

항상 로드되는 핵심 지침 4개는 기준 44,416 bytes에서 8,522 bytes로 80.8% 감소했다. 내부 하네스 감사는 P0/P1/P2/P3 0건이며, 기존 P2 패턴 부채 2,679건은 baseline으로 고정하고 신규 위반 0건만 허용하는 ratchet으로 전환했다.

## 반영 범위

- `AGENTS.md`를 공통 헌법과 위험·도메인별 라우터로 축소했다.
- Claude, Cursor, Copilot 지침을 도구별 차이만 담는 adapter로 축소했다.
- `.agents/skills`를 원본으로, `.claude/skills`를 검사 가능한 생성 mirror로 통일했다.
- `CURRENT_STATUS.md`를 현재 권위 색인으로 축소하고 route, migration, workflow 사실을 `docs/generated/system-inventory.*`로 생성한다.
- `docs/document-registry.yml`에 문서 class, 권위 영역, owner, 상태, 검증일, 검토 주기, 대체 관계를 등록했다.
- 활성 Tier 2·3 Spec의 packet 요건과 완료 Spec의 실제 commit·evidence·미해결 항목 검사를 도입했다.
- 단일 `audit-doc-harness`가 registry, 링크, Spec, skill sync, 지침 예산, 비밀·위험 명령, generated inventory를 검사한다.
- Promptfoo는 `tools/harness-evals`에 격리했다. 잠긴 `0.122.2`를 사용하되 미사용 provider optional dependency는 설치하지 않고 플랫폼별 잠긴 libSQL binding만 설치한다.
- PR #1217의 Research Node를 통합하면서 distributed limiter 미설정·장애 시 503 fail-closed, 첫 public DNS 응답 transport pinning, credential destination 제한을 적용했다.
- Codex 기본·audit·elevated profile, Serena cwd 인식, apifable 버전 고정, Claude hook·권한 축소를 host health 검사로 확인한다.

파일별 유지·통합·이동·대체 내역과 rollback 기준은 `docs/archive/harness/2026-09-01-refactor-manifest.md`에 있다.

## 검증 증거

| 검증 | 결과 |
|---|---|
| `npm run check:harness` | 0 findings; skill 10 files sync; inventory current; 30/30 deterministic contracts; harness negative tests 13/13 |
| `npm run eval:harness:promptfoo` | 30/30 pass |
| `npm run audit:high` | root high/critical 0 |
| `npm run audit:harness-evals` | 설치 대상 high/critical 0 |
| Research signal·route·rate limiter Vitest | 26/26 pass |
| Research Node Node tests | 9/9 pass |
| `npm run type-check` | pass |
| agent workflow·doc automation | pass |
| secret lint·CI action pin·automation runtime·LLM telemetry | pass |
| 내부 current/harness 링크 | 오류 0 |
| 외부 출처 감사 | P0/P1/P2/P3 0 |
| 원래 dirty 작업 보존 대조 | 보존 대상 991개 hash 일치; 정책상 복사 제외한 env 파일 1개만 제외 |

세 차례 독립 read-only 우회 검토에서 발견한 22개 경계 결함을 모두 수정했다. 여기에는 외부 링크 감사 SSRF, Supabase 설정 문자열·stdio·sibling server·TOML profile/decoy 우회, import alias·주석·dead branch·무관 handler·비지배 인증 가드 통과, push 변경 감지 누락, 공용 문서·무관 테스트 artifact 우회, IPv4-mapped·NAT64·IPv4-embedded IPv6, signed URL 변형, Unicode·전화번호·주민번호 PII 우회가 포함된다. 외부 감사는 공개 HTTPS 주소를 확인하고 DNS 응답을 실제 transport에 pin하며 redirect마다 다시 검증한다. 관련 negative test를 포함한 전체 외부 출처 감사는 0건이다.

## 열린 후속 조치

| 항목 | 영향 | 담당 | 다음 확인일 |
|---|---|---|---|
| 과거 평문 PAT·서비스 역할 키의 공급자 측 폐기·회전 증빙 없음 | 저장 설정과 저장소에서는 제거됐지만 과거 자격증명의 효력 소멸은 로컬 감사만으로 입증할 수 없음 | credential owner | 즉시 |
| 현재 실행 중인 Codex 세션은 설정 변경 전 Supabase tool catalog를 유지함 | 이 세션에서는 최소 권한 완료를 입증할 수 없음. 새 세션에서 project-scoped read-only 연결만 노출되는지 재검증 필요 | local operator | 2026-09-02 |
| 실제 모델 provider를 쓰는 30개 live policy eval 미실행 | 정적 계약과 Promptfoo deterministic 회귀는 통과했으나 모델별 행동 비교 결과는 없음 | ai-platform | provider 승인 시 |
| 기존 P2 risk baseline 2,679건 | 신규 위반은 차단되지만 기존 부채는 점진 감축 필요 | 각 domain owner | 매 PR·주간 감사 |

새 Codex 세션에서는 먼저 `npm run check:agent-host`를 실행하고 Supabase read-only 조회만 smoke test한다. Production write probe는 실행하지 않으며, write 도구 부재와 project/read-only 설정으로 차단을 확인한다.

## Rollback

- 최신 main 기준점: `421e81bb4f1394b17e8039dba4919a28825b68ba`
- Research Node merge 기준점: `b08e2ac77`
- 이전 격리 스냅샷: `codex/harness-doc-refactor-20260901`
- dirty 작업 보존 commit: `b1e8b9d4b`
- 복구는 hard reset이 아니라 manifest의 경로 매핑을 사용한 선택 복원으로 수행한다.
