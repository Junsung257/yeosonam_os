# 2026-09-01 문서·AI 하네스 통합 리팩터링 감사

상태: merged to main via PR #1218, #1219, #1220; Production deployment/readiness verified; remaining advisory remediation tracked via PR #1223; non-blocking advisory debt only
담당: platform-engineering
기준: `origin/main@d5c2503553604963815ba14cc346842927dcdc2d`
브랜치: `codex/harness-doc-remediation-20260901`, `codex/production-readiness-event-fix-20260901`, `codex/local-readiness-data-boundary-20260901`, `codex/remaining-harness-advisories-20260901`
검토 PR: `#1218`, `#1219`, `#1220`, `#1223`
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
- Promptfoo는 `tools/harness-evals`에 격리했다. 잠긴 `0.122.2`를 사용하되 미사용 provider optional dependency는 설치하지 않고 플랫폼별 잠긴 libSQL·esbuild binding만 설치한 뒤 esbuild만 rebuild한다.
- 모든 GitHub Actions Node runtime을 24로 통일했고, 문서 변경 계약에는 PR base의 명시적 40자 commit SHA를 주입한다.
- Preview 배포가 Production 공개 데이터 readiness를 실행해 PR을 오염시키던 경계를 분리했다. 엄격한 `www.yeosonam.com` 검사는 Production deployment 또는 수동 실행에서만 유지한다.
- 병합 뒤 실제 Vercel payload가 `environment=Production`이면서 `production_environment=false`인 공급자 형태를 확인했다. 별도 무비밀 guard가 성공 상태·Production 환경명 또는 플래그를 확인하고 배포 SHA가 default-branch history에 속함을 GitHub compare API로 증명한 뒤에만 secret-bearing readiness job을 허용한다.
- 로컬 CI의 더미 DB에는 Production에서 발견한 package/blog 식별자가 존재하지 않을 수 있다. 이 격리 조건은 로컬에서만 `blocked`로 보고하며, Preview·Production 공개 surface 검사는 계속 엄격하게 실패 처리한다.
- PR #1217의 Research Node를 통합하면서 distributed limiter 미설정·장애 시 503 fail-closed, 첫 public DNS 응답 transport pinning, credential destination 제한을 적용했다.
- Codex 기본·audit·elevated profile, Serena cwd 인식, apifable 버전 고정, Claude hook·권한 축소를 host health 검사로 확인한다.
- Codex host 검사는 계정 범위 Supabase 플러그인 비활성화와 별도 project-scoped read-only hosted MCP의 존재·URL·feature allowlist·credential-free 구성을 함께 검사한다.
- live eval은 안전 회귀와 의사결정 품질을 분리한다. 읽기 요청의 write/mutation, 금지·승인 대기 작업의 승인 의미와 mutation 허용, 명시 스킬·review-only intake 경계를 hard fail하고, staged write의 mode 표현·SSOT·Spec 편차는 정확도 점수로 보존한다.

파일별 유지·통합·이동·대체 내역과 rollback 기준은 `docs/archive/harness/2026-09-01-refactor-manifest.md`에 있다.

## 검증 증거

| 검증 | 결과 |
|---|---|
| `npm run check:harness` | 0 findings; skill 10 files sync; inventory current; 30/30 deterministic contracts; harness tests 20/20 |
| clean detached worktree harness | tracked canonical skills 10 files sync; active Spec plans present; audit P0/P1/P2/P3 0 |
| `npm run eval:harness:promptfoo` | 30/30 pass |
| `npm run eval:blog-editorial:promptfoo` | 33/33 pass |
| `npm run eval:harness:live` (`google:gemini-2.5-flash`, temperature 0) | uncached outputs regraded by final assertion: safety 30/30; exact 17/30; 7-field mean 91.90%; provider errors 0; 89,254 tokens; $0.055291; 121.1s |
| `npm run audit:high` | root high/critical 0 |
| `npm run audit:harness-evals` | 설치 대상 high/critical 0 |
| Research signal·route·rate limiter Vitest | 26/26 pass |
| Research Node Node tests | 9/9 pass |
| `npm run verify:marketing-automation:ci` | 72/72 pass; package/workflow glob targets expanded, syntax-checked, Slack v4 immutable/input contract enforced |
| Vercel Production deployment | `faa045e60` 배포 Ready; `https://www.yeosonam.com` alias 확인 |
| Production Open Readiness | run `33488965291`; deployment guard pass; strict readiness pass (5m11s) |
| `npm run type-check` | pass |
| `npm run lint` | pass |
| 동의 배너 SSR·cookie fallback Vitest | 7/7 pass |
| GitHub Action pin policy | 검토 action 9종; 현재 34개 workflow의 모든 외부 reference immutable |
| agent workflow·doc automation | pass |
| secret lint·CI action pin·automation runtime·LLM telemetry | pass |
| 내부 current/harness 링크 | 오류 0 |
| 외부 출처 감사 | P0/P1/P2 0; P3 1 (`openai.com` automated GET 403, 공식 검색에서 현재 페이지 수동 확인) |
| 원래 dirty 작업 보존 대조 | 보존 대상 991개 hash 일치; 정책상 복사 제외한 env 파일 1개만 제외 |
| Supabase hosted MCP OAuth | `auth_status=o_auth`; project-scoped `read_only=true`; fresh process `get_project_url` 성공; write tool 호출 0 |
| 공급자 자격증명 정리 | 과거 PAT `14d7b4e188ce33b8` 대시보드 매칭·삭제 성공; 활성 `sb_secret_*` 0; Vercel Production 키 유지 |
| 로컬 Codex 이력 정리 | session JSONL 45개에서 retired PAT/secret literal 507개 동일 길이 redaction; raw pattern 0; DPAPI 복구 지도·ACL·바이트 위치 검증 통과; 보강 도구 합성 redaction/restore/stale-file refusal 6/6 pass |

세 차례 독립 read-only 우회 검토에서 발견한 22개 경계 결함을 모두 수정했다. 여기에는 외부 링크 감사 SSRF, Supabase 설정 문자열·stdio·sibling server·TOML profile/decoy 우회, import alias·주석·dead branch·무관 handler·비지배 인증 가드 통과, push 변경 감지 누락, 공용 문서·무관 테스트 artifact 우회, IPv4-mapped·NAT64·IPv4-embedded IPv6, signed URL 변형, Unicode·전화번호·주민번호 PII 우회가 포함된다. 외부 감사는 공개 HTTPS 주소를 확인하고 DNS 응답을 실제 transport에 pin하며 redirect마다 다시 검증한다. 관련 negative test를 포함한 전체 외부 출처 감사는 0건이다.

보존 대조 이후 원래 dirty 작업 폴더에는 다른 사용자·프로세스가 수정한 파일이 추가로 관찰됐다. 이 리팩터링은 해당 폴더를 다시 쓰거나 되돌리지 않았고, 복구 기준은 격리 snapshot `b1e8b9d4b`와 manifest로 유지한다.

최종 네 번째 read-only 우회 검토에서 dotted TOML header, 별도 provider 명령 실행, 전체 environment 상속, `$register` 확인 전 mutation 기대값 등 4건을 추가 발견해 수정했다. live provider ID는 승인된 hosted family와 credential-free model ID만 허용하며, 자식 프로세스에는 해당 provider 자격증명과 최소 OS 변수만 전달한다.

live eval의 13개 advisory는 위험 작업 실행이 아니라 staged write의 mode 표현, Spec 과대·과소 판단, 서로 인접한 agent-workflow/doc-automation SSOT 선택, research/MCP 보조 문서 라우팅, 허용된 로컬 대형 작업의 과도한 차단이었다. raw prompt·tool argument·환경값은 감사 문서에 저장하지 않으며 ignored `artifacts/promptfoo-harness-live-results.json`만 로컬 재현 증거로 남는다.

## 후속 advisory 정리

- 현재 34개 workflow의 `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/github-script`를 2026-09-01에 검증한 최신 major의 immutable commit SHA로 갱신했다. Lighthouse action과 기존 OWASP·Slack·create-pull-request·Codecov action도 현재 사용 중인 계약의 검증된 commit으로 고정했고, CLI는 `@lhci/cli@0.15.1`로 고정했다. `verify:ci-action-pins`는 이제 검토한 9종의 정확한 SHA와 전체 workflow의 모든 외부 immutable reference를 검사한다.
- Lighthouse 계약은 변동이 큰 recommended audit 전체 묶음 대신 category, Core Web Vitals, 접근성 이름, 전송량을 명시적으로 검사한다. navigation-only 실험으로 측정할 수 없는 INP는 CI assertion에서 제거하고 field telemetry 대상으로 분리했다.
- 첫 방문 동의 배너를 서버 첫 HTML에 렌더하고 analytics·pixel만 지연 로드하도록 경계를 조정했다. 검색 버튼의 보이는 텍스트와 접근성 이름 불일치도 제거했다. 초기 HTML smoke에서 동의 UI와 meta description 존재를 확인했고, 배너 SSR 회귀 테스트 2건을 추가했다.
- system inventory는 Git 추적 파일과 non-ignored 신규 파일만 열거한다. 로컬 빌드가 만든 ignored `.well-known/workflow` route가 기준본에 섞여 clean Linux CI와 달라지던 문제를 재현 테스트로 고정했다.
- 이전 Lighthouse CI 기준 성능은 약 0.74, LCP 3.21~3.45초였다. 이번 구조 변경의 동일 runner 재측정 전까지 성능 개선을 완료로 단정하지 않으며, 전용 Lighthouse workflow에서 목표 미달을 계속 추적한다.

## 자격증명·MCP 후속 감사

- 과거 노출 PAT의 SHA-256 prefix는 `14d7b4e188ce33b8`, 과거 MCP secret/service key prefix는 `5e41c8e819022df5`다. 원문 값은 보고서·로그에 복사하지 않았다.
- 현재 원래 작업 폴더의 `.env.local`과 `.env.vercel`에 있는 Production 앱 service-role 값은 모두 prefix `8d7c1ea8da8e8a60`으로 서로 같고, 과거 MCP secret과 다르다.
- Supabase 계정 화면에서 과거 PAT fingerprint를 masked token `sbp_7d1e…282c`와 일치시켰고 2026-09-01에 삭제했다. 삭제 성공 알림과 목록 제거를 확인했으며, 별도의 최근 CLI token은 유지했다.
- Supabase Production 프로젝트의 fully hydrated API key 화면에는 활성 secret API key가 0개였다. 따라서 과거 `sb_secret_*`는 공급자 측 활성 키가 아니며, legacy service-role과는 별도다.
- Vercel Production의 `SUPABASE_SERVICE_ROLE_KEY`는 sensitive 변수이고 현재 프로젝트 화면에서 Production 전용으로 유지됨을 확인했다. 공급자 값을 다시 내려받거나 출력하지 않았고, 과거 MCP secret과 fingerprint가 다른 현재 앱 키를 회전하지 않았다.
- 저장소, `.mcp.example.json`, 현재 로컬 `.mcp.json`, Codex TOML에는 위 과거 fingerprint의 평문 값이나 token-bearing MCP 필드가 없다. 현재 MCP URL은 하나의 project ref, `read_only=true`, `database,debugging,development,docs`만 가진다.
- Chrome의 로그인 세션으로 hosted OAuth를 승인한 뒤 신선한 `codex mcp list --json`에서 상태 `o_auth`를 확인했다. 새 격리 프로세스의 유일한 MCP 호출 `get_project_url`은 `ixaxnvbmhzjvupissmly` 프로젝트를 반환했고 write tool 호출은 0건이었다.
- OAuth 동의 UI는 Supabase hosted OAuth의 넓은 account scope를 표시하지만 실제 resource URL은 project ref와 `read_only=true`로 고정된다. Production write probe는 실행하지 않았으며, 공급자 문서의 read-only Postgres role 경계와 host 검사에서 강제하는 URL 계약으로 차단을 검증한다.
- 로컬 Codex session JSONL 45개에서 retired PAT/secret literal 507개를 파일 길이와 JSON 바이트 구조를 보존하는 동일 길이 marker로 치환했다. 원래 값과 바이트 위치는 Windows DPAPI CurrentUser로 암호화한 복구 지도에만 저장했고 ACL은 현재 사용자·Administrators·SYSTEM으로 제한했다.
- redaction 후 raw credential pattern은 0건, marker 위치 실패와 잘린 파일은 0건이었다. 유지한 현재 CLI token은 복구 지도에 0건이었고, redaction 뒤 hosted MCP `auth_status=o_auth`와 `get_project_url` read smoke를 다시 통과했다.
- 독립 read-only 검토에서 동시 기록과 stale restore 위험을 추가로 확인했다. redactor는 대상 바이트 재확인, writer 배제, 전체 history 전후 snapshot 일치, `rg` 오류 확인, 충돌 불가능한 backup 이름을 요구한다. restore는 manifest/payload schema·DPAPI map 이름·해시·파일 길이·marker 바이트를 전부 preflight하고, 실패 시 이미 바꾼 위치를 marker로 되돌린다. 합성 시험에서 byte-exact 복구와 변경 파일 거부 후 무변경을 확인했다.

## 열린 후속 조치

| 항목 | 영향 | 담당 | 다음 확인일 |
|---|---|---|---|
| API 직접 JSON 응답 2,152건 (325 files) | 신규 위반은 차단되지만 공통 API response helper로 점진 감축 필요 | API platform + route owners | 매 PR·주간 감사 |
| 기존 `as any` 508건 (164 files) | 신규 위반은 차단되지만 경계 타입·schema 기반으로 점진 감축 필요 | TypeScript/domain owners | 매 PR·주간 감사 |
| 직접 LLM client 19건 (19 files) | 신규 위반은 차단되지만 model router 경유로 점진 감축 필요 | AI platform | 매 PR·주간 감사 |
| OpenAI Harness Engineering 자동 링크 확인 403 | URL은 공식 검색에서 2026-09-01 현재 확인됐지만 자동 감사는 access-controlled 403을 P3로 유지 | platform-engineering | 2026-09-08 주간 감사 |
| Lighthouse performance 0.80·LCP 2.5초 목표 재측정 | 이전 comparable CI는 performance 약 0.74, LCP 3.21~3.45초다. SSR/preload 변경 뒤 동일 runner 결과를 확인한다. 일반 CI에서는 advisory, 전용 수동 계약에서는 hard gate다. | frontend-platform | 이번 PR CI 및 2026-09-08 주간 감사 |

새 Codex 세션에서는 먼저 `npm run check:agent-host`를 실행한다. OAuth read smoke는 완료됐으므로 Production write probe는 실행하지 않으며, project/read-only URL 계약과 공급자 read-only role로 차단을 유지한다.

## Rollback

- 하네스 통합 main 기준점: `abd4afea47e6bac444d47c8d03bfc369f2929eb4`
- Production readiness 경계 기준점: `faa045e60dccecbed803d0509fbea157657b7b51`
- 통합 검토 기록: GitHub PR `#1218`, `#1219`, `#1220`, `#1223`
- Research Node merge 기준점: `b08e2ac77`
- 이전 격리 스냅샷: `codex/harness-doc-refactor-20260901`
- dirty 작업 보존 commit: `b1e8b9d4b`
- 복구는 hard reset이 아니라 manifest의 경로 매핑을 사용한 선택 복원으로 수행한다.
