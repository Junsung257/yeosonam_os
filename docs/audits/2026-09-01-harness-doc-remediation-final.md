# 2026-09-01 문서·AI 하네스 통합 리팩터링 감사

상태: implementation verified, two operational follow-ups, one ratchet debt, one external-link advisory open
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
- Codex host 검사는 계정 범위 Supabase 플러그인 비활성화와 별도 project-scoped read-only hosted MCP의 존재·URL·feature allowlist·credential-free 구성을 함께 검사한다.
- live eval은 안전 회귀와 의사결정 품질을 분리한다. 읽기 요청의 write/mutation, 금지·승인 대기 작업의 승인 의미와 mutation 허용, 명시 스킬·review-only intake 경계를 hard fail하고, staged write의 mode 표현·SSOT·Spec 편차는 정확도 점수로 보존한다.

파일별 유지·통합·이동·대체 내역과 rollback 기준은 `docs/archive/harness/2026-09-01-refactor-manifest.md`에 있다.

## 검증 증거

| 검증 | 결과 |
|---|---|
| `npm run check:harness` | 0 findings; skill 10 files sync; inventory current; 30/30 deterministic contracts; harness negative tests 19/19 |
| `npm run eval:harness:promptfoo` | 30/30 pass |
| `npm run eval:harness:live` (`google:gemini-2.5-flash`, temperature 0) | uncached outputs regraded by final assertion: safety 30/30; exact 17/30; 7-field mean 91.90%; provider errors 0; 89,254 tokens; $0.055291; 121.1s |
| `npm run audit:high` | root high/critical 0 |
| `npm run audit:harness-evals` | 설치 대상 high/critical 0 |
| Research signal·route·rate limiter Vitest | 26/26 pass |
| Research Node Node tests | 9/9 pass |
| `npm run type-check` | pass |
| agent workflow·doc automation | pass |
| secret lint·CI action pin·automation runtime·LLM telemetry | pass |
| 내부 current/harness 링크 | 오류 0 |
| 외부 출처 감사 | P0/P1/P2 0; P3 1 (`openai.com` automated GET 403, 공식 검색에서 현재 페이지 수동 확인) |
| 원래 dirty 작업 보존 대조 | 보존 대상 991개 hash 일치; 정책상 복사 제외한 env 파일 1개만 제외 |

세 차례 독립 read-only 우회 검토에서 발견한 22개 경계 결함을 모두 수정했다. 여기에는 외부 링크 감사 SSRF, Supabase 설정 문자열·stdio·sibling server·TOML profile/decoy 우회, import alias·주석·dead branch·무관 handler·비지배 인증 가드 통과, push 변경 감지 누락, 공용 문서·무관 테스트 artifact 우회, IPv4-mapped·NAT64·IPv4-embedded IPv6, signed URL 변형, Unicode·전화번호·주민번호 PII 우회가 포함된다. 외부 감사는 공개 HTTPS 주소를 확인하고 DNS 응답을 실제 transport에 pin하며 redirect마다 다시 검증한다. 관련 negative test를 포함한 전체 외부 출처 감사는 0건이다.

최종 네 번째 read-only 우회 검토에서 dotted TOML header, 별도 provider 명령 실행, 전체 environment 상속, `$register` 확인 전 mutation 기대값 등 4건을 추가 발견해 수정했다. live provider ID는 승인된 hosted family와 credential-free model ID만 허용하며, 자식 프로세스에는 해당 provider 자격증명과 최소 OS 변수만 전달한다.

live eval의 13개 advisory는 위험 작업 실행이 아니라 staged write의 mode 표현, Spec 과대·과소 판단, 서로 인접한 agent-workflow/doc-automation SSOT 선택, research/MCP 보조 문서 라우팅, 허용된 로컬 대형 작업의 과도한 차단이었다. raw prompt·tool argument·환경값은 감사 문서에 저장하지 않으며 ignored `artifacts/promptfoo-harness-live-results.json`만 로컬 재현 증거로 남는다.

## 자격증명·MCP 후속 감사

- 과거 노출 PAT의 SHA-256 prefix는 `14d7b4e188ce33b8`, 과거 MCP secret/service key prefix는 `5e41c8e819022df5`다. 원문 값은 보고서·로그에 복사하지 않았다.
- 현재 원래 작업 폴더의 `.env.local`과 `.env.vercel`에 있는 Production 앱 service-role 값은 모두 prefix `8d7c1ea8da8e8a60`으로 서로 같고, 과거 MCP secret과 다르다.
- Vercel Production의 `SUPABASE_SERVICE_ROLE_KEY`는 sensitive 변수이며 2026-09-01 08:17:45 KST에 갱신된 metadata를 확인했다. 공급자 값을 다시 내려받거나 출력하지 않았다.
- 저장소, `.mcp.example.json`, 현재 로컬 `.mcp.json`, Codex TOML에는 위 과거 fingerprint의 평문 값이나 token-bearing MCP 필드가 없다. 현재 MCP URL은 하나의 project ref, `read_only=true`, `database,debugging,development,docs`만 가진다.
- 신선한 `codex mcp list --json` 프로세스에서 계정 범위 Supabase 플러그인 대신 명시적 `supabase` hosted MCP 하나만 보였고 상태는 `not_logged_in`이었다. 따라서 설정 최소 권한은 입증했지만 OAuth 후 실제 read smoke와 write-tool 부재는 아직 입증하지 않았다.
- 과거 키와 현재 Production 앱 키가 다르므로 현재 앱 키를 무관하게 회전하지 않았다. 과거 PAT·secret의 공급자 측 revoked 상태는 Supabase 계정 화면 또는 관리 API 증거 없이는 단정하지 않는다.

## 열린 후속 조치

| 항목 | 영향 | 담당 | 다음 확인일 |
|---|---|---|---|
| 과거 평문 PAT·MCP secret의 공급자 측 폐기 증빙 없음 | 현재 앱 키와 분리·저장소 제거는 입증했지만 과거 자격증명의 효력 소멸은 로컬 fingerprint 감사만으로 입증할 수 없음 | credential owner | 즉시 |
| project-scoped Supabase MCP OAuth와 새 프로세스 smoke 미완료 | 명시 서버는 최소 권한으로 등록됐으나 `not_logged_in`; OAuth 후 read 성공과 write-tool 부재 확인 필요 | local operator | 2026-09-02 |
| 기존 P2 risk baseline 2,679건 | 신규 위반은 차단되지만 기존 부채는 점진 감축 필요 | 각 domain owner | 매 PR·주간 감사 |
| OpenAI Harness Engineering 자동 링크 확인 403 | URL은 공식 검색에서 2026-09-01 현재 확인됐지만 자동 감사는 access-controlled 403을 P3로 유지 | platform-engineering | 2026-09-08 주간 감사 |

새 Codex 세션에서는 먼저 `npm run check:agent-host`를 실행하고 Supabase read-only 조회만 smoke test한다. Production write probe는 실행하지 않으며, write 도구 부재와 project/read-only 설정으로 차단을 확인한다.

## Rollback

- 최신 main 기준점: `421e81bb4f1394b17e8039dba4919a28825b68ba`
- Research Node merge 기준점: `b08e2ac77`
- 이전 격리 스냅샷: `codex/harness-doc-refactor-20260901`
- dirty 작업 보존 commit: `b1e8b9d4b`
- 복구는 hard reset이 아니라 manifest의 경로 매핑을 사용한 선택 복원으로 수행한다.
