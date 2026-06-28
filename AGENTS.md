# AGENTS.md — 여소남 OS (AI 에이전트 공통 진입점)

> **서비스 한 줄:** 랜드사 → 플랫폼(여소남) → 여행사/고객을 잇는 **B2B2C 여행 SaaS**. 멀티 테넌시·예약 상태 머신·제휴/정산·AI(자비스·QA)가 핵심이다.

이 파일은 **항상 짧게 유지**한다. 상세 레시피·유틸 카탈로그·프로세스 완수 규칙은 **`.claude/CLAUDE.md`**에 있다.

---

## 1. 작업 전에 무엇을 읽을지

| 작업 성격 | 먼저 Read (필요한 구간만) |
|-----------|---------------------------|
| **도메인·DB·RLS·제휴·PII·학습 데이터·자비스** | `CURRENT_STATUS.md`, 아래 **§docs/ 주제별** 표에서 파일 고른 뒤 필요한 구간만 Read, `.claude/CLAUDE.md` 해당 절 |
| **상품 등록·A4/모바일 렌더·관광지** | `docs/product-registration-current-ssot.md` 먼저 Read + `.claude/CLAUDE.md` 해당 절. `.claude/commands/*.md`는 수동 legacy 작업 요청 때만 참조 |
| **블로그 생성·발행·이미지·SEO·색인** | `docs/blog-autopublish-contract.md` 먼저 Read + `docs/blog-ops-runbook.md` 필요한 구간 |
| **제휴·인플루언서·추천코드·커미션** | `docs/affiliate-current-ssot.md` 먼저 Read + 반복 오류는 `docs/errors/affiliate.md` |
| **정산·입금·ledger·환불·지급** | `docs/settlement-current-ssot.md` 먼저 Read + 반복 오류는 `docs/errors/settlement.md` |
| **마케팅·Ad OS·외부 광고 발행** | `docs/marketing-current-ssot.md` 먼저 Read + 반복 오류는 `docs/errors/marketing.md` |
| **AI·자비스·RAG·프롬프트·모델 라우팅** | `docs/ai-ops-current-ssot.md` 먼저 Read + 반복 오류는 `docs/errors/ai-ops.md` |
| **게이미피케이션·마일리지** | `CURRENT_STATUS.md`, `docs/gamification-runbook.md`, `src/lib/gamification-service.ts`, `src/lib/mileage-service.ts` |
| **API 응답 포맷·인증 패턴** | `.cursor/rules/api-response-format.mdc` |
| **DB 변경·마이그레이션** | `.cursor/rules/db-migration-policy.mdc`, `CURRENT_STATUS.md`, `db/FIELD_POLICY.md` |
| **대형·고위험 작업·에이전트 워크플로우** | `docs/agent-workflow-current-ssot.md` 먼저 Read + 해당 도메인 SSOT |
| **반복 실수·문서 자동 정리·SSOT 정리** | `docs/ai-agent-doc-automation.md` + `db/error-registry.md` |
| **Git 정리·커밋·푸시·PR·머지·배포** | `docs/git-commit-handoff.md` 먼저 Read. 사용자는 비개발자이므로 AI가 안전한 기본값으로 판단하고, 폐기·되돌리기·강제푸시 전에는 멈춘다 |
| **오타·import 한 줄·사용자가 지정한 단일 파일 기계적 수정** | 생략 가능 (프로젝트 규칙은 `.cursor/rules` 참고) |

사용자가 「CLAUDE 읽고」「상태 확인」이라고 하면 해당 턴에서 위 문서를 **실제로 연 뒤** 진행한다.

---

## 2. 단일 정보 소스 (SSOT) 원칙

- **사실·정책·스키마 요약의 최신본:** 루트 `CURRENT_STATUS.md` (날짜 확인).
- **구현 레시피·안티패턴·명령 체크리스트:** `.claude/CLAUDE.md`.
- **대화 톤·컨텍스트 읽기 시점:** `.cursor/rules/` (`yeosonam-context.mdc`, `yeosonam-communication-ko.mdc`).
- **★ 과거 오류 반복 금지 규칙 (필독):** `.cursor/rules/yeosonam-lessons-learned.mdc`
- **★ AI 운영·세션 전략·판단 기준 (필독):** `.cursor/rules/yeosonam-operating-model.mdc`

채팅 **메모리**에만 두는 도메인 지식은 오래된 오답이 될 수 있으므로, 반복되는 결정은 **이 레포의 Markdown으로 옮기고 PR로 갱신**하는 것을 우선한다.

### Git/PR 자동 운영 원칙

- 사용자가 "알아서 깃 정리"를 요청하면 AI가 브랜치 생성, 커밋 분할, 푸시, PR 생성, 체크 확인, 머지 가능 여부 판단까지 주도한다.
- 다른 세션/작업 폴더가 있으면 먼저 `git worktree`, 열린 PR, 현재 브랜치 차이를 확인하고, 반영 여부를 사용자에게 기술 용어 없이 설명한다.
- 오래된 브랜치는 그대로 머지하지 않는다. 현재 `main` 기준으로 필요한 변경만 선별 반영하고, 삭제·폐기·강제 되돌리기는 명시 승인 없이는 하지 않는다.
- 스쿼시/리베이스 때문에 브랜치 커밋이 남아 보여도 곧바로 "미반영"으로 판단하지 말고, 패치 동등성(`git cherry`)과 실제 파일 내용을 대조한다.

### docs/ 주제별 (빠른 찾기)

| 주제 | 파일 |
|------|------|
| **프로젝트 헌법·최상위 제품 원칙** | **`docs/yeosonam-os-constitution.md`**, `docs/yeosonam-os-constitution-evidence-map.md` |
| **제휴 현재 SSOT·추천코드·커미션 계약** | **`docs/affiliate-current-ssot.md`** |
| 제휴 추적·쿠키·코브랜딩 세부 | `docs/affiliate-attribution.md` |
| **블로그 자동발행 현재 SSOT·품질 계약** | **`docs/blog-autopublish-contract.md`** |
| 블로그 운영 런북 | `docs/blog-system-runbook.md`, `docs/blog-ops-runbook.md` |
| **정산 현재 SSOT·ledger·지급 계약** | **`docs/settlement-current-ssot.md`** |
| **마케팅 현재 SSOT·Ad OS·외부발행 계약** | **`docs/marketing-current-ssot.md`** |
| **AI Ops 현재 SSOT·자비스·RAG·모델 라우팅** | **`docs/ai-ops-current-ssot.md`** |
| 배포 전 체크리스트 | `docs/deploy-checklist.md` |
| 환경 변수 레퍼런스 | `docs/env-variables-reference.md` |
| Supabase Auth 오픈 보안 게이트 | `docs/supabase-auth-open-gate.md` |
| AI 정책 운영 가이드 | `docs/ai-policy-operations.md` |
| 에이전트 워크플로우 현재 SSOT | `docs/agent-workflow-current-ssot.md` |
| AI 에이전트 문서 자동화·하네스 | `docs/ai-agent-doc-automation.md` |
| 반복 오류 상세 보관소 | `docs/errors/README.md` |
| Git 커밋 핸드오프 | `docs/git-commit-handoff.md` |
| 자유여행 100 시나리오 스펙 | `docs/free-travel-100-scenarios-spec.md` |
| 자유여행 AI 플래너 운영 | `docs/free-travel-planner-runbook.md` |
| 자비스 오케스트레이션 | `docs/jarvis-orchestration.md` |
| 자비스 RAG 감사 운영 | `docs/jarvis-rag-audit-runbook.md` |
| 자비스 출시 준비 게이트 | `docs/jarvis-readiness-gate.md` |
| 자비스 100점 점수표·로드맵 | `docs/jarvis-100-scorecard-and-roadmap.md` |
| 플랫폼 AI·학습 로드맵 | `docs/platform-ai-roadmap.md` |
| Solapi 리뷰 요청 템플릿 | `docs/solapi-review-template-guide.md` |
| **/register 변경 이력 (P0~P1·결정)** | **`docs/register-changelog.md`** |
| 미설정 트래커 | `docs/pending-settings-tracker.md` |
| Threads 자동화 운영 런북 | `docs/threads-autopilot-runbook.md` |
| Threads 운영 투입 체크리스트 | `docs/threads-go-live-checklist.md` |
| 등록 파이프라인 개선 (TOP 10) | `docs/registration-improvement-plan.md` |
| **상품등록 현재 SSOT·통합엔진 계약** | **`docs/product-registration-current-ssot.md`** |
| 상품 등록 정확도·토큰 절감 플랜 | `docs/product-registration-accuracy-plan.md` |
| **상품등록 V3 표준언어·REMARK·검수 UI SSOT** | **`docs/product-registration-v3-standard-language.md`** |
| 추천·비교 V1 개발 실행서 | `docs/recommendation-comparison-v1-plan.md` |
| 호텔 점수 V1.5 운영 런북 | `docs/hotel-scoring-v1-5-runbook.md` |
| 게이미피케이션 운영 런북 | `docs/gamification-runbook.md` |
| 검색광고 자동화 리서치 | `docs/search-ads-automation-research.md` |
| Ad OS 완전자동화 마스터플랜 | `docs/ad-os-autopilot-master-plan.md` |
| 일회성 감사 로그 인덱스 | `docs/audits/README.md` |

*새 현재 문서를 `docs/`에 추가하면 이 표에 한 줄 반영할 것. 일회성 감사 로그(YYYY-MM-DD 패턴)는 `docs/audits/` 서브폴더로 넣고 `docs/audits/README.md`에만 한 줄 추가한다. 현재 규칙 검색 시에는 먼저 `docs/audits/**`를 제외한다.*

---

## 3. 레포 지도 (요약)

| 경로 | 역할 |
|------|------|
| `src/app/` | Next.js App Router (고객·어드민·API) |
| `src/lib/` | 비즈니스 로직·연동 (UI에 로직 넣지 말 것) |
| `supabase/migrations/` | DB 스키마 변경 이력 |
| `docs/` | 주제별 심화 문서 — **위 §docs/ 주제별 표** |
| `db/` | 감사·마이그레이션 스크립트, `FIELD_POLICY.md`, `error-registry.md` |

---

## 4. 에코시스템별 파일

| 도구 | 파일 |
|------|------|
| **Cursor / 범용 CLI 에이전트** | 이 파일(`AGENTS.md`) + `.cursor/rules/*.mdc` |
| **Claude Code / 심층 하네스** | `.claude/CLAUDE.md` |
| **GitHub Copilot (IDE·리뷰)** | `.github/copilot-instructions.md` |

---

## 5. 로컬 개발 (최소)

- 의존성: `npm install`
- 개발 서버: `npm run dev`
- 환경 변수 요약: `docs/env-variables-reference.md`

---

*갱신 시: `CURRENT_STATUS.md` 날짜·메뉴/테이블과 충돌이 없는지 함께 점검할 것.*
