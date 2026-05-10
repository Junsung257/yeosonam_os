@../AGENTS.md

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
- [ ] **기존 커맨드 MD 파일 읽었는가?** — `.claude/commands/` 내 관련 파일(`register.md`, `manage-attractions.md`, `register-product.md`, `assemble-product.md`)
- [ ] **Error Registry 최근 10건 체크리스트 확인했는가?** — `db/error-registry.md` 하단
- [ ] **"이 기능 제가 구현해드릴게요"라고 말하기 전** 진짜 그 기능이 없는지 확인했는가?
- [ ] **임시 스크립트(`db/seed_XXX.js`, `db/temp_XXX.js`) 만들려 하는가?** → 중단하고 기존 API/UI 사용

### 도메인별 강제 진입점

특정 도메인 작업은 해당 MD 파일을 **반드시 먼저 Read**:

| 도메인 | 필수 Read 파일 |
|-------|--------------|
| 상품 등록 | `.claude/commands/register.md` |
| 서안 등 어셈블러 지역 | `.claude/commands/assemble-product.md` |
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

### 11-4. 외부 AI API 모델 선택 자동 기준

새 AI 호출 코드를 작성할 때 아래 기준을 자동 적용:

| 작업 | 모델 | 이유 |
|------|------|------|
| 라우팅·분류·메타 추출 | `claude-haiku-4-5-20251001` 또는 `gemini-2.5-flash` | 단순, 속도 우선 |
| 블로그·카드뉴스·카피 생성 | `gemini-2.5-flash` | 창작, 비용 우선 |
| 상품 정규화 (복잡) | `claude-sonnet-4-6` (Prompt Cache 필수) | 정확도, 규칙 복잡 |
| 환각 교차검증 | `gemini-2.5-flash` | 감사 전용, 저비용 |
| JARVIS 에이전트 루프 | `gemini-2.5-flash` executor + `gemini-2.5-pro` advisor (막힐 때 1회) | Advisor 패턴 |
| RAG 컨텍스트 생성·인덱싱 | `claude-haiku-4-5-20251001` + system cache | 반복 호출, 캐시 필수 |
| 고객 실시간 상담 | `gemini-3.1-flash-lite-preview` | 스트리밍, 최저비용 |

**절대 금지**: 단순 분류·추출·라우팅에 Sonnet/Pro 사용.
**신규 Claude 호출 시 필수**: `cache_control: { type: 'ephemeral' }` system + tools에 항상 적용.

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
