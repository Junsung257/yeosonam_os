@../AGENTS.md

## 2026-06-16 Superpowers Adoption

Use Superpowers, when available in the Codex/Claude harness, as a general development workflow layer for brainstorming, planning, TDD, systematic debugging, code review, and verification-before-completion.

Superpowers is not the source of truth for Yeosonam domain decisions. For product registration, DB/RLS/schema changes, supplier parsing, attractions, render contracts, AI routing, and customer-facing data safety, the project SSOT files below still take priority:

- `docs/product-registration-current-ssot.md`
- `docs/blog-autopublish-contract.md`
- `docs/affiliate-current-ssot.md`
- `docs/settlement-current-ssot.md`
- `docs/marketing-current-ssot.md`
- `docs/ai-ops-current-ssot.md`
- `.claude/skills/register/SKILL.md`
- `.claude/CLAUDE.md`
- `.cursor/rules/*.mdc`
- `CURRENT_STATUS.md`
- `db/error-registry.md`

If Superpowers, LazyCodex, Spec Kit, Cline, OpenHands, Aider, ast-grep, or Probe guidance conflicts with Yeosonam-specific rules, follow the Yeosonam rule and mention the conflict in the final report. For the selected internal workflow contract, read `docs/agent-workflow-current-ssot.md`. Do not install or configure external agent runtimes, autonomous hooks, or a Superpowers MCP wrapper unless the user explicitly asks for a separate tool pilot.

## 2026-06-16 MCP Tooling

Codex global MCP setup includes Context7, Serena, and apifable. See `docs/agent-mcp-tooling.md`.

- Use Context7 for current library/API documentation before changing framework, SDK, auth, deployment, or integration code.
- Use Serena for symbol-aware exploration/refactoring across multiple files in this large codebase.
- Use apifable before writing admin frontend/API integration code; verify exact endpoint method/path/params/response against `docs/api-spec.json`.

These tools support engineering workflow only. Yeosonam domain SSOT rules still take priority.

## 2026-06-05 Product Registration SSOT

For supplier upload registration, mobile landing, and A4 readiness, read `docs/product-registration-current-ssot.md` first.

Current rule: one active SSOT, not many competing plans. Audit docs are evidence/history. Legacy `.claude/commands/register-product.md` and `.claude/commands/assemble-product.md` are manual references only unless the user explicitly asks for manual script insertion.

Never patch a new supplier case directly into `src/app/api/upload/route.ts`. Fix through fixture -> parser/IR or registration-object improvement -> price recovery -> deliverability gate -> persistence/audit.

## 2026-06-05 Documentation Automation

For repeated mistakes, SSOT cleanup, and "do we need a doc update?" decisions, read `docs/ai-agent-doc-automation.md`.

Close meaningful work by naming the durable artifact: fixture/test, current SSOT rule, error-registry entry, audit note, or "no doc update needed because behavior did not change."

# 여소남 OS — AI 개발 하네스 (Harness Guide)

> **공통 진입점:** 위 `@../AGENTS.md` 가 자동 로드됨 (Claude Code는 AGENTS.md를 직접 읽지 않으므로 import 필수). 이 파일은 **심층 레시피·유틸 카탈로그·Claude Code 토큰 규칙** 전용이다.

> 이 문서는 "하지 마라" 목록이 아니라 **"이렇게 해라" 레시피북**입니다.
> 올바른 경로를 따라가면 버그가 구조적으로 발생할 수 없습니다.

## 0. 당신의 역할
여소남 OS는 [랜드사 → 플랫폼(여소남) → 여행사/고객]을 연결하는 B2B2C 여행 SaaS 플랫폼입니다.
코드를 작성할 때 항상 '데이터 무결성', '제로 딜레이 UX', '멀티 테넌시 확장성'을 염두에 두십시오.

**🚨 [필독] 독단적 상상 코딩 및 데이터 주입 절대 금지 (Zero-Hallucination Policy)**
시스템에 데이터를 주입하거나 새로운 에이전트/코드를 작성할 때, 절대 "이렇게 생겼을 것이다"라고 추측하여 네 맘대로 작업하지 마십시오.
모든 작업 전 **반드시 기존 코드베이스(특히 `DetailClient.tsx`, `YeosonamA4Template.tsx`, `booking-state-machine.ts` 등)가 해당 데이터를 어떻게 파싱하고 화면에 뿌려주는지 먼저 `grep_search` 나 `view_file` 로 조회하고 분석**해야 합니다. 기존 프론트엔드 렌더링 로직이나 정규식을 무시하고 임의 규격으로 DB에 데이터를 밀어 넣으면 UI가 모두 깨지는 대형 참사가 일어납니다.

### 작업 전 필수 체크리스트 (Pre-Flight Check)

모든 작업 시작 전 **아래를 수행했는지 self-check**하십시오. 하나라도 생략되면 ERR-20260418-33 급 참사가 발생합니다.

- [ ] **기존 기능 탐색했는가?** — `Glob`, `Grep`으로 `src/app/admin/`, `src/app/api/`, `src/lib/`에서 관련 구현 확인
- [ ] **현재 스킬/SSOT를 먼저 읽었는가?** — 상품 등록은 `docs/product-registration-current-ssot.md`와 `.claude/skills/register/SKILL.md`를 우선한다. `.claude/commands/register-product.md`·`.claude/commands/assemble-product.md`는 사용자가 수동 legacy 삽입/어셈블러 작업을 명시 요청한 경우에만 참조한다.
- [ ] **Error Registry 최근 10건 체크리스트 확인했는가?** — `db/error-registry.md` 하단
- [ ] **"이 기능 제가 구현해드릴게요"라고 말하기 전** 진짜 그 기능이 없는지 확인했는가?
- [ ] **임시 스크립트(`db/seed_XXX.js`, `db/temp_XXX.js`) 만들려 하는가?** → 중단하고 기존 API/UI 사용
- [ ] **사장님 SSOT 무력화 패턴 자기진단 (ERR-XIY-2026-05-16):**
  - 정규식 가드 30개+ 추가하려는가? → 본질 우회 신호. SSOT 테이블·큐 어디에 적재되는지 먼저 확인
  - 외부 source 기반 자동 INSERT 박으려는가? → `manage-attractions.md` STRICT SSOT 정책 위반. 사장님이 어드민에서 직접 등록하는 게 의도
  - 사장님이 같은 의견을 2번 이상 주셨는가? → 무조건 채택. `feedback_user_intent_is_ssot.md` 참조

### 도메인별 강제 진입점

특정 도메인 작업은 해당 MD 파일을 **반드시 먼저 Read**:

| 도메인 | 필수 Read 파일 |
|-------|--------------|
| 상품 등록 | `.claude/skills/register/SKILL.md` (+ references/) |
| 블로그 생성·발행·이미지·SEO·색인 | `docs/blog-autopublish-contract.md` (+ 운영은 `docs/blog-ops-runbook.md`) |
| 제휴·인플루언서·추천코드·커미션 | `docs/affiliate-current-ssot.md` |
| 정산·입금·ledger·환불·지급 | `docs/settlement-current-ssot.md` |
| 마케팅·Ad OS·외부 광고 발행 | `docs/marketing-current-ssot.md` |
| AI·자비스·RAG·프롬프트·모델 라우팅 | `docs/ai-ops-current-ssot.md` |
| 서안 등 수동 legacy 어셈블러 요청 | `.claude/commands/assemble-product.md` (명시 요청 시에만) |
| **관광지(attractions) 관리** | **`.claude/commands/manage-attractions.md`** |
| **등록 후 상품 검증** | **`.claude/commands/validate-product.md`** (원문 ↔ A4 ↔ 모바일 3자 대조) |
| **A4/모바일 렌더링 로직 추가·수정** | **`src/lib/render-contract.ts` 의 `renderPackage()` 출력에 추가** (렌더러는 `view.*` 만 소비, pkg 직접 파싱 금지 — ERR-KUL-05) |
| **DB 필드에 내용 넣기 전** | **`db/FIELD_POLICY.md`** — 고객 노출 vs 내부 필드 구분. 커미션/정산 메모는 special_notes 금지 (ERR-FUK-customer-leaks) |
| **AI 플라이휠·자비스 오케스트레이션·공개 QA(제휴 스코프·고객 여정)** | 루트 **`CURRENT_STATUS.md`** (§AI·§3 채팅/DB), **`docs/jarvis-orchestration.md`**, **`docs/platform-ai-roadmap.md`**, 에이전트 규칙 **`.cursor/rules/yeosonam-context.mdc`** — 스키마는 `supabase/migrations/2026050212*`~`0217*`·`0220*` 참고 |
| 예약 상태 변경 | `src/lib/booking-state-machine.ts` |

**이 강제 진입점을 무시하고 추측으로 진행하면 즉시 중단하십시오.**

### 🚨 프로세스 완수 메타 규칙 (ERR-process-violation)

사용자가 `/register` 또는 다른 절차 지시 시:
- **"INSERT 성공 = 완료" 아님.** `/register`의 모든 Step (0~7)을 끝까지 자동 실행.
- **Step 7 자동 감사(`post_register_audit.js`)는 MANDATORY.** 사용자에게 "나중에 직접 실행하세요" 안내 금지.
- **경고 발생 시 자동 수정 가능한 것은 DB UPDATE까지 실행** (예: 과거 출발일 필터, itinerary_data.meta 추가).
- **최종 보고는 항상 "한 화면" 리포트**로 출력 — 감사 결과, 수정 내역, 사용자가 해야 할 마지막 단계(어드민 승인) 포함.
- **예외: 사용자가 명시적으로 "INSERT만", "감사는 건너뛰어" 라고 지시한 경우만 스킵.**

---

## 1. 비즈니스 로직의 집 — `src/lib/`

파싱·매칭·계산·정산 같은 **비즈니스 로직은 항상 `src/lib/` 안에 살아야 합니다.** UI 컴포넌트(`.tsx`)는 import해서 결과만 렌더링합니다.

> **상세 유틸리티 카탈로그 (40+ 함수)**: `src/lib/`, `src/components/`, `src/app/`, `db/` 작업 시 자동 로드되는 [`.claude/rules/utilities.md`](rules/utilities.md) 참조. 새 함수 만들기 전 반드시 확인.

```typescript
// 컴포넌트에서 로직을 사용하는 올바른 패턴
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import { getEffectivePriceDates } from '@/lib/price-dates';

const days = normalizeDays(pkg.itinerary_data);
const attr = matchAttraction(item.activity, attractions, pkg.destination);
```

---

## 2. 네이밍 컨벤션 (전역)

| 영역 | 규칙 | 예시 |
|---|---|---|
| DB 컬럼 | `snake_case` | `ai_confidence_score`, `total_paid_out` |
| TS 변수 | `camelCase` | `aiConfidenceScore` |
| 컴포넌트 | `PascalCase` | `BookingDrawer` |
| 파일 (유틸) | `kebab-case.ts` | `payment-matcher.ts` |
| API 라우트 | `kebab-case/` | `/api/card-news` |

---

## 3. 도메인별 상세 규칙 (path-scoped 자동 로드)

도메인 작업 시 아래 룰이 해당 파일을 읽을 때만 컨텍스트에 들어옵니다 (평소 0 토큰):

| 도메인 | 활성 파일 패턴 | 룰 |
|---|---|---|
| DB 작업 | `src/app/api/**`, `supabase/migrations/**`, `db/**` | [`.claude/rules/db-recipes.md`](rules/db-recipes.md) |
| API 라우트 | `src/app/api/**`, `src/middleware.ts` | [`.claude/rules/api-routes.md`](rules/api-routes.md) |
| 프론트엔드 | `src/app/**/*.tsx`, `src/components/**` | [`.claude/rules/frontend.md`](rules/frontend.md) |
| 외부 API (Pexels·Solapi·Claude·Gemini) | `src/lib/llm-*`, `src/lib/content-pipeline/**`, `src/app/api/blog\|card-news/**` | [`.claude/rules/external-apis.md`](rules/external-apis.md) |
| 예약 시스템 | `src/lib/booking-state-machine.ts`, `src/app/api/bookings/**` | [`.claude/rules/booking-system.md`](rules/booking-system.md) |
| 알림 | `src/lib/notification-adapter.ts`, `src/app/api/notify/**` | [`.claude/rules/notifications.md`](rules/notifications.md) |
| 마케팅 카피·AI 콘텐츠 | `src/lib/content-pipeline/**`, `src/app/api/card-news\|blog/**` | [`.claude/rules/marketing-copy.md`](rules/marketing-copy.md) |
| 유틸리티 카탈로그 | `src/lib/**`, `src/components/**`, `src/app/**`, `db/**` | [`.claude/rules/utilities.md`](rules/utilities.md) |
| **GitHub Actions 워크플로** | **`.github/workflows/**`** | **[`.github/workflows/README.md`](../.github/workflows/README.md) — permissions/continue-on-error/deprecated 액션 체크리스트. 메일 폭탄 사고 v1~v4 이력 박제.** |

> 새 도메인 룰을 추가하려면 `.claude/rules/` 에 `paths:` frontmatter 포함한 .md 추가 후 위 표에 한 줄 반영.

---

## 4. 플랫폼 확장성

### 멀티 테넌시 대비
- DB 쿼리에 `tenant_id` 필터를 확장할 수 있는 구조로 설계합니다
- RLS 정책: "자신의 회사 데이터만 볼 수 있는가?"를 기준으로 설계합니다
- API 응답은 예측 가능한 JSON 포맷을 유지합니다

---

## 10. 수정 작업 가이드

1. **요청받은 파일만 수정합니다.** 관련 파일을 건드려야 할 때는 영향 범위를 먼저 보고합니다.
2. **기존 코드의 문맥을 유지합니다.** 요청받은 기능만 정밀하게 추가/수정합니다.
3. **수정 후 변경된 파일 목록을 명시합니다.**
4. **확신이 없으면 먼저 질문합니다.**
5. **코드를 생략(`...`)하지 않습니다.** SQL, 컴포넌트 코드를 제공할 때 전체를 작성합니다.

---

## 11. Claude Code 토큰 효율 — 자동 최적화 규칙 (필수 준수)

> 이 섹션은 Claude Code 자신의 컨텍스트 창과 외부 AI API 비용을 자동으로 아끼는 규칙입니다.
> 매 세션 설정 없이 **항상** 아래 규칙을 따릅니다.

### 11-1. 탐색 위임 — 직접 스캔 금지 기준

| 상황 | 처리 방법 |
|------|---------|
| 파일 3개 이상 조회 | `Explore` 서브에이전트에 위임 (직접 Read 금지) |
| "이 기능이 구현됐는지 모름" | `Explore` 서브에이전트에 위임 |
| LLM 호출 패턴·API 라우트 전수조사 | `Explore` 서브에이전트에 위임 |
| 알고 있는 파일 1~2개 수정 | 직접 Read → Edit |
| 특정 심볼 1개 검색 | `Grep` 직접 사용 |

**금지**: 탐색 목적으로 5개 이상 파일을 내 컨텍스트에 직접 로드하는 행위.

### 11-2. 작업 복잡도별 접근 방식 자동 결정

```
단순 (파일 1~2개, 명확한 요구사항)
  → 직접 Read + Edit. Plan/Agent 불필요.

중간 (파일 3~5개 연관, 도메인 파악 필요)
  → Explore 에이전트로 파악 → 내가 직접 수정.

복잡 (멀티파일 설계 변경, 아키텍처 결정)
  → Plan 모드 진입 → 사용자 승인 → 실행.

병렬 독립 작업 (서로 의존성 없는 작업 2개+)
  → 단일 메시지에 Agent 여러 개 동시 실행.
```

### 11-3. 큰 파일 읽기 규칙

- 300줄 이상 파일: `offset + limit` 파라미터로 필요한 범위만 Read.
- 방금 Edit 한 파일: 다시 Read 하지 않음 (Edit 성공 = 반영됨).
- 서브에이전트 결과: 핵심 요약만 메인 컨텍스트에 가져옴 (전체 출력 X).

### 11-4. 외부 AI API 모델 선택 자동 기준 (V3 — 2026-05 동기화)

> **SSOT**: `src/lib/llm-gateway.ts` 의 `ROUTING` 테이블이 실제 정책. 본 표는 가이드 요약.
> **V3 (2026-05-01)** 부터 DeepSeek V4 가 primary, Gemini 2.5 Flash 가 fallback. Claude/GPT 는 라우팅에서 제거 (단 `register` 시 longCache opt-in 으로 부분 사용).

새 AI 호출 코드를 작성할 때 아래 기준을 자동 적용:

| 작업 | 권장 task (llm-gateway) | 실제 모델 (executor) | Fallback | 이유 |
|------|------------------------|---------------------|----------|------|
| 라우팅·분류·메타 추출 | `extract-meta`, `classify`, `summary` | `deepseek-v4-flash` | `gemini-2.5-flash` | DeepSeek 자동 prompt cache, 비용 최저 |
| 블로그·카드뉴스·카피 생성 | `blog-generate`, `card-news`, `content-brief` | `deepseek-v4-flash` | `gemini-2.5-flash` | 창작·재시도 부담 적음 |
| 상품 정규화 (복잡) | `normalize-complex` | `deepseek-v4-pro` + advisor | `gemini-2.5-flash` | Pro + advisor 패턴 박음 |
| 환각 교차검증 | `cross-validate`, `judge`, `response-critic` | `deepseek-v4-flash` | `gemini-2.5-flash` | 감사 전용, 저비용 |
| JARVIS 에이전트 루프 | `jarvis-simple` / `jarvis-complex` | `deepseek-v4-flash` (simple) / `deepseek-v4-pro` advisor (complex) | `gemini-2.5-flash` | Advisor 패턴 + Confidence-gated escalation |
| 자유여행 플래너 | `free-travel-extract` / `-itinerary` / `-compose` | `deepseek-v4-flash` | `gemini-2.5-flash` | 3-step 직렬 (병렬화 후보) |
| HWP/PDF 여행상품 구조화 | `parse_travel_doc` | `deepseek-v4-flash` | `gemini-2.5-flash` | maxRetries=3 |
| 고객 실시간 상담 | `qa-chat` (`tryDeepSeekStream` 우선) | `deepseek-v4-flash` (streaming) | `gemini-2.5-flash` | TTFT 최적, JSON `reply` 부분 추출 |
| 고객 팩트 추출 | `customer-fact-extract` | `deepseek-v4-flash` | `gemini-2.5-flash` | Mem0 스타일 |

**절대 금지**:
- 단순 분류·추출·라우팅에 `deepseek-v4-pro` 사용 (Flash 로 충분).
- `llm-gateway.ts` 우회하고 `new OpenAI()` / `new Anthropic()` / `new GoogleGenerativeAI()` 직접 호출 (예외: `normalize-with-llm`, `gemini-agent-loop-v2`, `blog-ai-caller`, `jarvis/deepseek-agent-loop-v2` 같은 전문 모듈만 — 클라이언트 싱글톤 캐싱 필수).

**캐싱 정책 (필수)**:
- **DeepSeek**: 프롬프트 캐싱 자동 (별도 플래그 불필요). system prompt 를 user prompt 와 분리해 호출하면 자동 적중 — 동일 system 으로 N회 호출 시 input 90% 할인.
- **Claude (Anthropic)**: `cache_control: { type: 'ephemeral' }` 기본 5분. 1시간 내 반복 호출 워크로드(시간당 publisher, 카드뉴스 일괄 생성, 7-플랫폼 fan-out)는 **`longCache: true`** 로 `ttl: '1h'` opt-in — `blog-ai-caller.ts`, `llm-gateway.ts (callClaude)` 둘 다 지원.
- **Gemini**: `cachedContent` API 미사용 (현재 인프라). 향후 도입 시 별도 PR.

### 11-5. llm-gateway.ts 사용 강제

`src/lib/` 에서 AI를 새로 호출할 때:
- `llmCall({ task: '...' })` 를 먼저 찾아 맞는 task 타입 있으면 재사용.
- 없으면 새 task 타입을 `llm-gateway.ts`의 `ROUTING` 테이블에 추가 후 사용.
- 직접 `new Anthropic()` / `new GoogleGenerativeAI()` 인스턴스 생성은 전문 모듈(normalize-with-llm, gemini-agent-loop-v2 등)에서만 허용.

### 11-6. 반복 허가 요청 자동 해결

아래 명령은 `.claude/settings.json` 에 이미 허가되어 있으므로 즉시 실행:
- `git status`, `git diff`, `git log` (읽기 전용 git)
- `node db/post_register_audit.js` (감사 스크립트)
- `npx tsc --noEmit` (타입 체크)
- `node -e "..."` (인라인 Node.js)

새 반복 패턴이 3회 이상 허가 요청되면: settings.json `permissions.allow` 에 추가 제안.

---

## 12. 정보 추출/매칭 작업 — 학술 표준 hierarchy (필수 준수)

> **2026-05-17 박제 (시즈오카 사고 ERR-LLM-overuse)**: 사장님이 5번 반복한 의도("정보는 일정표에 이미 있고 애매한 부분만 LLM")를 무시하고 라인 매칭 작은 문제를 "전체 itinerary 재추출 모듈(PR #109/#110)"로 확장 → 매칭률 42%→13% 다운그레이드 + 원문 verbatim 정책 위반.
>
> 본 절은 Mihalcea & Csomai 2007 "Wikify!", Andersen et al. 2008 "Hybrid IE" 학술 컨센서스 박제.

### 12-1. 정보 추출 hierarchy (cost ascending)

attractions·schedule·destination·고객 정보 등 **텍스트에서 정보 추출 작업**은 항상 아래 순서로:

| Level | 방법 | 비용 | 사용 시점 |
|-------|------|------|---------|
| **L1** | Rule (regex / DB 직접 읽기 / 조건) | $0 | 명확한 패턴 (식사/이동/공항/조식/날짜/요일/이미 박힌 DB 컬럼) |
| **L2** | Fuzzy / Alias / Substring 매칭 | $0 | 표기 변형 (Levenshtein 0.78+, 이미 박힌 `attractions_aliases`) |
| **L3** | LLM (단순 키워드 추출, 50~200 토큰) | ~$0.0001 | **L1+L2 가 fail 한 ambiguity 만** |
| **L4** | Human-in-the-loop (사장님 어드민) | 사장님 시간 | L3 도 확신 0 — `unmatched_activities` 큐 |

### 12-2. 절대 금지 (anti-patterns)

- ❌ **L1/L2 대신 L3 사용** — 토큰 낭비 + 환각 위험 + 응답 지연 (DeepSeek raw_text 5000자 → 2~8초)
- ❌ **LLM 에게 전체 재구성 요청** (raw_text → 통째 JSON). 라인 단위 ambiguity 해결만.
- ❌ **기존 인프라 무시 + 새 모듈 신규 작성** — `matchAttraction`/`attractions_aliases`/`unmatched_activities`/EPR few-shot/Reflexion memory 가 이미 다 있음. 이걸 활용하지 않고 새 함수 만들면 NIH 신드롬.
- ❌ **few-shot 5개 + Zod strict schema + 백슬래시 잡탕 prompt** — DeepSeek 빈 응답 폭주 (ERR-LLM-empty-response @ 2026-05-17).
- ❌ **사장님 schedule activity 원본 텍스트 변경** — `feedback_no_reference_pattern_borrow.md` 위반.

### 12-3. 올바른 L3 사용법

```ts
// L1: 명확한 패턴 skip (regex)
if (/공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식|면세점/.test(activity)) continue;

// L2: 기존 인프라 (substring + fuzzy + alias)
const candidates = extractAttractionCandidates(activity, note);  // regex
const matches = candidates.flatMap(c => matchAttraction(c, attractions, destination));
if (matches.length > 0) {
  item.attraction_ids = matches.map(m => m.id);
  continue;  // L3 호출 안 함
}

// L3: L1+L2 fail 한 라인만 LLM
const keywords = await extractAttractionKeywordsWithLLM(activity, destination);
const llmMatches = keywords.flatMap(kw => matchAttraction(kw, attractions, destination));
if (llmMatches.length > 0) item.attraction_ids = llmMatches.map(m => m.id);
else await pushToUnmatched(activity, packageId, day, destination);  // L4
```

### 12-4. 학술 출처

- Mihalcea & Csomai 2007 "Wikify!" — Entity Linking 표준
- Andersen et al. 2008 "Hybrid Information Extraction" — rule + ML cost ordering
- Brown et al. 2020 "GPT-3 few-shot" — in-context learning 비용 분석
- OpenAI Cookbook "Function calling with data extraction" — schema 강제는 ambiguity 만
- Microsoft GraphRAG 2024 — KB entity linking pattern (우리 attractions DB와 동일)

### 12-5. 사장님 비전 일치

> "정보는 일정표에 이미 들어가있고 애매한 부분만 LLM" — 2026-05-17 사장님 명시.
> = Information Extraction hierarchy의 한국어 번역. 100% 학술 표준 일치.

새 정보 추출 작업 시 본 12절 hierarchy 무시하고 L3/L4 부터 작성한 PR 은 사장님 검토 자동 차단.

### 12-6. register 파이프라인 7 도메인 hierarchy (전체 적용 박제)

> **2026-05-17 사고 (ERR-domain-scope-narrow)**: attractions 매칭에만 hierarchy 적용하고
> 다른 6 도메인 누락 → 후쿠오카 패키지 등록 시 destination/price_dates/display_title/
> product_summary 모두 fail. 사장님 "전부 해결" 인식과 실제 "1/7 도메인 해결" 의 갭.

| # | 도메인 | L1 (rule) | L2 (fuzzy/alias) | L3 (LLM) | L4 (human) |
|---|--------|----------|-----------------|---------|----------|
| 1 | **attractions 매칭** | 식사/이동 skip | `matchAttraction` | `extractAttractionsByDayWithLLM` (hybrid) | unmatched_activities |
| 2 | **destination** | 제목 우선 / 대괄호 패턴 | `destinationToIsoSet` | `extractHeroContextWithLLM` | 사장님 어드민 |
| 3 | **display_title** | 제목 첫 줄 trim | (없음) | 위 hero LLM | 어드민 |
| 4 | **product_summary** | (없음) | (없음) | 위 hero LLM (환각 차단) | 어드민 |
| 5 | **price_dates** | `extractPriceTable` (표준 4-라인 regex) | (없음) | `extractPriceTableWithLLM` (chunk 분할) | 어드민 |
| 6 | **inclusions/excludes** | regex 섹션 추출 | (없음) | `extractInclusionsExcludesNoticesWithLLM` | 어드민 |
| 7 | **notices_parsed** | `deterministic/notices.ts` (4-type) | (없음) | 위 inc/exc/notices LLM (5-type: + PRICING_RULE) | 어드민 |

**통합 호출**:
- `src/lib/parser/llm/section-extractors.ts` `backfillSectionsByPackageId(packageId, {force})`
- upload/route.ts G2 단계에서 fire-and-forget (사장님 응답 블로킹 X)
- 기존 값 verbatim 보존 (force=false default). NULL/0건/빈약 컬럼만 채움.

**비용**: 패키지 1개당 ~$0.005 (3 함수 병렬 + prompt cache).

### 12-7-pre. 새 세션 시작 시 의무 체크 (2026-05-18 박제 — self-review 12 실수)

> [[feedback-session-2026-05-17-18-self-review]] — 2026-05-17/18 세션 자기검토 12 실수.
> 매 세션 시작 시 아래 5가지 의무 체크:

1. **사장님 의도 텍스트 inline 인용 확인** — "정확히 무엇 원하시는지?" 모호하면 즉시 질문
2. **Pre-Flight Check 수행** — 기존 인프라 grep + 강제 진입점 MD Read (CLAUDE.md §0)
3. **TodoWrite 사용** — 3단계+ 작업 시 의무
4. **"완료" 단어 사용 전** — 사장님 화면 fetch 또는 ASCII 시뮬레이션
5. **외부 API 호출 보고 전** — 5분 실측 (AbortSignal.timeout(N) 의무)

### 12-7. 자동 후속 처리 (ERR-audit-stale-snapshot + ERR-dev-revalidate-누락 박제)

> **2026-05-17 사고 (오늘 세션 6회 반복)**: backfill 함수가 DB UPDATE 후 audit_report
> 갱신 안 하고 prod 만 revalidate → 사장님 페이지에 **옛 경고 + 옛 캐시** 노출.
> 사장님 "또 사고" 인식 → 매 PR 머지 후 동일 패턴.

**모든 backfill 함수는 DB UPDATE 직후 다음 2개 helper 호출 의무**:

1. **`refreshAuditAfterBackfill(packageId)`** (`section-extractors.ts`)
   - audit_report.checks 자동 정정 (C4/C5/C6/C11)
   - 모든 warn 사라지면 `audit_status: 'warnings' → 'clean'`
   - 사장님 페이지의 stale 경고 차단

2. **`revalidatePackagePaths(packageId, {alsoServerContext})`** (`revalidate-helper.ts`)
   - prod (yeosonam.com) + dev3001 동시 호출
   - `DEV_REVALIDATE_URL` / `PROD_REVALIDATE_URL` 환경변수 지원
   - server context 내부면 `revalidatePath` 직접 호출 (alsoServerContext: true)

**금지**: `revalidatePath` 단독 호출 (server 내부만), 또는 prod 만 fetch (dev 누락).
**필수**: 둘 다 또는 `revalidatePackagePaths` 단일 호출.

**현재 적용 함수**:
- `backfillSectionsByPackageId` ✓
- `backfillPackageAttractionsL3` ✓
- 향후 신규 backfill 함수도 동일 패턴 박제.
