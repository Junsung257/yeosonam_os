# 2026-09-01 문서·AI 하네스 통합 리팩터링 감사

상태: implementation and credential remediation verified; one ratchet debt, one external-link advisory, one local-history hygiene advisory open
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
| Supabase hosted MCP OAuth | `auth_status=o_auth`; project-scoped `read_only=true`; fresh process `get_project_url` 성공; write tool 호출 0 |
| 공급자 자격증명 정리 | 과거 PAT `14d7b4e188ce33b8` 대시보드 매칭·삭제 성공; 활성 `sb_secret_*` 0; Vercel Production 키 유지 |

세 차례 독립 read-only 우회 검토에서 발견한 22개 경계 결함을 모두 수정했다. 여기에는 외부 링크 감사 SSRF, Supabase 설정 문자열·stdio·sibling server·TOML profile/decoy 우회, import alias·주석·dead branch·무관 handler·비지배 인증 가드 통과, push 변경 감지 누락, 공용 문서·무관 테스트 artifact 우회, IPv4-mapped·NAT64·IPv4-embedded IPv6, signed URL 변형, Unicode·전화번호·주민번호 PII 우회가 포함된다. 외부 감사는 공개 HTTPS 주소를 확인하고 DNS 응답을 실제 transport에 pin하며 redirect마다 다시 검증한다. 관련 negative test를 포함한 전체 외부 출처 감사는 0건이다.

최종 네 번째 read-only 우회 검토에서 dotted TOML header, 별도 provider 명령 실행, 전체 environment 상속, `$register` 확인 전 mutation 기대값 등 4건을 추가 발견해 수정했다. live provider ID는 승인된 hosted family와 credential-free model ID만 허용하며, 자식 프로세스에는 해당 provider 자격증명과 최소 OS 변수만 전달한다.

live eval의 13개 advisory는 위험 작업 실행이 아니라 staged write의 mode 표현, Spec 과대·과소 판단, 서로 인접한 agent-workflow/doc-automation SSOT 선택, research/MCP 보조 문서 라우팅, 허용된 로컬 대형 작업의 과도한 차단이었다. raw prompt·tool argument·환경값은 감사 문서에 저장하지 않으며 ignored `artifacts/promptfoo-harness-live-results.json`만 로컬 재현 증거로 남는다.

## 자격증명·MCP 후속 감사

- 과거 노출 PAT의 SHA-256 prefix는 `14d7b4e188ce33b8`, 과거 MCP secret/service key prefix는 `5e41c8e819022df5`다. 원문 값은 보고서·로그에 복사하지 않았다.
- 현재 원래 작업 폴더의 `.env.local`과 `.env.vercel`에 있는 Production 앱 service-role 값은 모두 prefix `8d7c1ea8da8e8a60`으로 서로 같고, 과거 MCP secret과 다르다.
- Supabase 계정 화면에서 과거 PAT fingerprint를 masked token `sbp_7d1e…282c`와 일치시켰고 2026-09-01에 삭제했다. 삭제 성공 알림과 목록 제거를 확인했으며, 별도의 최근 CLI token은 유지했다.
- Supabase Production 프로젝트의 fully hydrated API key 화면에는 활성 secret API key가 0개였다. 따라서 과거 `sb_secret_*`는 공급자 측 활성 키가 아니며, legacy service-role과는 별도다.
- Vercel Production의 `SUPABASE_SERVICE_ROLE_KEY`는 sensitive 변수이고 현재 프로젝트 화면에서 Production 전용으로 유지됨을 확인했다. 공급자 값을 다시 내려받거나 출력하지 않았고, 과거 MCP secret과 fingerprint가 다른 현재 앱 키를 회전하지 않았다.
- 저장소, `.mcp.example.json`, 현재 로컬 `.mcp.json`, Codex TOML에는 위 과거 fingerprint의 평문 값이나 token-bearing MCP 필드가 없다. 현재 MCP URL은 하나의 project ref, `read_only=true`, `database,debugging,development,docs`만 가진다.
- Chrome의 로그인 세션으로 hosted OAuth를 승인한 뒤 신선한 `codex mcp list --json`에서 상태 `o_auth`를 확인했다. 새 격리 프로세스의 유일한 MCP 호출 `get_project_url`은 `ixaxnvbmhzjvupissmly` 프로젝트를 반환했고 write tool 호출은 0건이었다.
- OAuth 동의 UI는 Supabase hosted OAuth의 넓은 account scope를 표시하지만 실제 resource URL은 project ref와 `read_only=true`로 고정된다. Production write probe는 실행하지 않았으며, 공급자 문서의 read-only Postgres role 경계와 host 검사에서 강제하는 URL 계약으로 차단을 검증한다.
- 로컬 Codex의 과거 session JSONL에는 이미 기록된 legacy PAT literal이 남아 있다. 이는 저장소·현재 설정·MCP credential source가 아니고 공급자 활성 목록의 과거 대상은 폐기됐지만, Codex 작업 이력 삭제는 복구 불가능한 사용자 데이터 변경이므로 자동 수행하지 않았다.

## 열린 후속 조치

| 항목 | 영향 | 담당 | 다음 확인일 |
|---|---|---|---|
| 기존 P2 risk baseline 2,679건 | 신규 위반은 차단되지만 기존 부채는 점진 감축 필요 | 각 domain owner | 매 PR·주간 감사 |
| OpenAI Harness Engineering 자동 링크 확인 403 | URL은 공식 검색에서 2026-09-01 현재 확인됐지만 자동 감사는 access-controlled 403을 P3로 유지 | platform-engineering | 2026-09-08 주간 감사 |
| 로컬 Codex 과거 session JSONL의 retired credential literal | 현재 설정·MCP·공급자 활성 키는 아니지만 로컬 이력 백업에는 값이 남음; 작업 이력 삭제·재작성은 별도 사용자 승인과 백업 후 수행 | local operator | 2026-09-08 |

새 Codex 세션에서는 먼저 `npm run check:agent-host`를 실행한다. OAuth read smoke는 완료됐으므로 Production write probe는 실행하지 않으며, project/read-only URL 계약과 공급자 read-only role로 차단을 유지한다.

## Rollback

- 최신 main 기준점: `421e81bb4f1394b17e8039dba4919a28825b68ba`
- Research Node merge 기준점: `b08e2ac77`
- 이전 격리 스냅샷: `codex/harness-doc-refactor-20260901`
- dirty 작업 보존 commit: `b1e8b9d4b`
- 복구는 hard reset이 아니라 manifest의 경로 매핑을 사용한 선택 복원으로 수행한다.
