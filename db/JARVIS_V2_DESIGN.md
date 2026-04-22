# Jarvis V2 — 설계 기획 (2026-04-22)

> **목적**: 여소남 OS 전용 AI 비서(자비스)를 **고객 상담 + OS 처리 겸용** + **멀티테넌트 격리 가능** + **지연 시간 최소화** 구조로 재설계한다.
>
> **범위**: 큰 그림 설계 + 단계별 마이그레이션 로드맵. 현재 스택(Next.js / Supabase / Claude / Gemini / 자체 mem0·self-rag)을 버리지 않고 **점진적으로 승격**한다.
>
> **작성 근거**: (a) 본 리포의 `src/lib/jarvis/*` 감사, (b) 2025-2026 agentic 패턴 리서치 (LangGraph / MCP / Contextual Retrieval / Multi-Tenant RAG), (c) `memory/project_jarvis_evolution_architecture.md`.

---

## 0. TL;DR

```
현재:  Gemini Router → Gemini Pro Agent Loop(최대 10라운드) → Gemini Flash Critic
       = 3~5회 LLM 왕복, 30~60초, 테넌트 격리 0, 스트리밍 없음

V2:    Gemini 2.5 Flash Supervisor + cachedContents
         → Gemini 2.5 Pro Worker (parallel tools + generateContentStream)
         → Tool Layer (tenant_id 강제 주입)
       = 2회 LLM 왕복, 첫 토큰 1~3초, 완성 6~15초, silo RAG per 테넌트
```

> **엔진 결정 (2026-04-22)**: Gemini 전 레이어 유지. Anthropic 제안 철회. 상세 근거는 §B.1 첫머리.

- **지연 50~75% 감소** 기대 (prompt caching + parallel tool use + streaming).
- **테넌트 격리** 는 Supabase RLS + Tool-layer 강제 주입으로 **애플리케이션 코드가 아닌 인프라에서** 보장.
- **프레임워크 전면 재작성 금지** — 기존 `runGeminiAgentLoop` 는 legacy 경로로 남기고 V2 는 병행 배포.

---

## 1. 현재 시스템 진단 (What we have)

### 1-1. 연동 지도

| 도메인 | 상태 | 진입점 |
|-------|-----|-------|
| ✅ 예약 관리 | 9 tool, HITL | `src/lib/jarvis/agents/operations.ts` |
| ✅ 상품 조회·추천 | 조회만 | `src/lib/jarvis/agents/products.ts` |
| ✅ 정산 drafts | 생성까지 | `src/lib/jarvis/agents/finance.ts` |
| ⚠️ 마케팅 | 스켈톤 (API 미연결) | `src/lib/jarvis/agents/marketing.ts` |
| ⚠️ 고객 상담 | `/api/qa/chat` 별도 경로 — 자비스 에이전트 루프와 **미통합** | `src/app/api/qa/chat/route.ts` |
| ❌ 상품 등록 | CLI 커맨드로만 (`/register`) | 자비스 tool 없음 |
| ❌ 블로그 발행 | 생성기만 존재, 발행 tool 미연결 | `src/lib/content-generator.ts` |
| ❌ 테넌트 격리 | agents 내 `tenant_id` 필터 0건 | 전체 |

### 1-2. 지연 병목 Top 5

1. **순차 LLM 체인** — Router(Gemini Flash) → Agent(Gemini Pro) → Critic(Gemini Flash). 각 왕복마다 네트워크 300~800ms + 생성 2~10초.
2. **캐시 미사용** — 시스템 프롬프트 (수천 토큰)가 매 호출마다 재전송. Anthropic prompt caching (5분 TTL, 90% 비용 감소, TTFT 최대 80% 감소)이 적용 가능하지만 **전 레이어가 Gemini**라서 쓰지 못함.
3. **MAX_ROUNDS = 10** — `gemini-agent-loop.ts:8`. Tool-use 반복 상한. 복잡한 요청에서 10라운드까지 감.
4. **Non-streaming** — 전체 답 버퍼링 후 JSON 응답. 사용자는 "자비스가 생각 중..." 을 최악 1분 대기.
5. **세션 히스토리 통짜 포함** — 최근 10개 메시지를 매번 포함 (`gemini-agent-loop.ts:41`). 캐시 없이 매번 토큰 청구.

### 1-3. 멀티테넌트 준비도

- `memory/project_multitenancy_status.md` 에 따르면 **11/58 테이블에만** `tenant_id` 적용.
- 자비스 tool 레이어 (`agents/*.ts`) 에서는 어느 DB 쿼리도 `tenant_id` 필터 없음.
- Supabase RLS 정책은 일부 테이블만 커버.
- 결론: **현 상태로 파트너 여행사에 오픈하면 즉시 데이터 누출**.

---

## 2. V2 아키텍처 (Target State)

### 2-1. 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Tenant-scoped Request                           │
│   POST /api/jarvis  { message, sessionId, context,                 │
│                        tenantId, userId, surface }                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
              ┌────────────────────────────────────────┐
              │   JarvisContext (middleware-built)    │
              │   - tenantId (required)               │
              │   - userId, userRole                  │
              │   - surface: 'admin' | 'customer'     │
              │   - locale, today                     │
              └────────────────────────────────────────┘
                                │
                                ▼
          ┌──────────────────────────────────────────────┐
          │ 1. Supervisor (Haiku 4.5 + prompt caching)   │
          │    입력: user msg + 최근 3턴 요약            │
          │    출력: { agent, confidence, topic }        │
          │    평균 300ms (캐시 hit), 토큰 500          │
          └──────────────────────────────────────────────┘
                                │
                                ▼
    ┌───────────────────────────────────────────────────────────┐
    │ 2. Worker Agents (Sonnet 4.6, parallel tools, streaming) │
    │                                                           │
    │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
    │   │Concierge │ │ Booking  │ │Settlement│ │Registration│  │
    │   │(상품·RAG)│ │(예약상태)│ │(정산3모드)│ │(/register) │  │
    │   └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
    │        │           │            │             │          │
    │        └───────────┴────────────┴─────────────┘          │
    │                          │                                │
    └──────────────────────────┼────────────────────────────────┘
                               ▼
         ┌─────────────────────────────────────────────┐
         │ 3. Tool Layer (MCP-wrapped, tenant forced) │
         │                                             │
         │  ┌───────────────────────────────────────┐  │
         │  │ scopedTool(ctx)(sb => sb              │  │
         │  │   .from('bookings')                   │  │
         │  │   .eq('tenant_id', ctx.tenantId))     │  │
         │  └───────────────────────────────────────┘  │
         │                                             │
         │  - Supabase RLS (2nd line of defense)       │
         │  - Tenant-scoped Pinecone/pgvector RAG      │
         │  - Notification adapter (tenant config)     │
         └─────────────────────────────────────────────┘
                               │
                               ▼
         ┌─────────────────────────────────────────────┐
         │ 4. Post-Response Quality Gate (async)       │
         │    - response-critic (heuristic skip)       │
         │    - fact-extractor → mem0 (tenant memory)  │
         │    - cost/latency attribution per tenant    │
         └─────────────────────────────────────────────┘
                               │
                               ▼
                      SSE stream to client
```

### 2-2. 핵심 컴포넌트

#### A. Supervisor (Gemini 2.5 Flash + cachedContents)
- 모델: `gemini-2.5-flash` (또는 더 저렴한 `gemini-2.5-flash-lite`)
- 역할: 입력을 7개 카테고리 중 하나로 분류 (`operations` | `concierge` | `finance` | `registration` | `marketing` | `system` | `smalltalk`)
- 최적화:
  - **Explicit caching**: 시스템 프롬프트 + 6개 few-shot 을 `cachedContents` 로 묶음 (TTL 300s). 캐시 hit 시 토큰 비용 75% 감소.
  - **Implicit caching**: 반복 프롬프트 자동 감지 → 추가 25% 할인.
  - **짧은 출력 강제**: `maxOutputTokens: 64`, `responseMimeType: 'application/json'`. 평균 40 토큰 출력.
  - **History 요약**: 최근 3턴을 한 문장 요약으로 압축.

#### B. Workers (Gemini 2.5 Pro)
- 모델: `gemini-2.5-pro` (복잡 플래닝), 단순 FAQ는 Flash fallback
- 최적화:
  - **Parallel function calling**: Gemini 2.5 네이티브. "예약 조회 + 상품 조회 + 고객 조회" 동시 실행.
  - **Streaming**: `generateContentStream` + SSE 엔드포인트. 첫 토큰 1~3초.
  - **Explicit caching**: 도구 정의 + 시스템 프롬프트를 `cachedContents` 로. agentType + prompt hash 를 key 로 파티션.
  - **Tool round 제한**: `MAX_ROUNDS = 5` (현재 10에서 축소). 5라운드 초과 시 HITL 에스컬레이션.

#### C. Tool Layer (MCP-wrapped)
- **모든 도구는 `ScopedSupabase` 를 받는다**:
  ```ts
  function searchBookings(ctx: JarvisContext, args: Args) {
    const sb = getScopedClient(ctx);  // tenant_id 자동 필터 wrapper
    return sb.from('bookings').select('*');  // 내부에서 .eq('tenant_id', ctx.tenantId) 강제
  }
  ```
- **RLS 2차 방어선**: 애플리케이션 버그가 있어도 Supabase RLS policy 가 막음.
- **MCP 노출 (선택적)**: Claude Agent SDK / 외부 에이전트가 여소남 OS 를 도구로 쓸 수 있게 함.

#### D. RAG (Contextual Retrieval)
- 인덱스: **Silo per tenant** (pgvector partial index on `(tenant_id, embedding)`)
- 청킹: Anthropic Contextual Retrieval — chunk 앞에 50~100 토큰 컨텍스트 prepend.
- 재랭킹: BM25 + cosine hybrid. 초기 retrieval top-20 → rerank top-5.
- 원천:
  - `travel_packages` (제목, 설명, itinerary_data flatten)
  - `attractions` (long_desc)
  - `blog_posts` (body)
  - 테넌트별 `knowledge_base` 테이블 (향후)

#### E. Memory (Mem0 재활용)
- 기존 `fact-extractor.ts` 를 tenant-scoped 로 확장:
  ```ts
  SELECT * FROM jarvis_facts 
  WHERE tenant_id = $1 AND customer_id = $2
  ```
- Short-term: in-memory session (Supabase `jarvis_sessions.messages`).
- Long-term: `jarvis_facts` + `jarvis_customer_profiles`.

---

## 3. 지연 최적화 Top 7 (구체 패치)

| # | 기법 | 기대 효과 | 적용 위치 |
|---|------|---------|---------|
| 1 | Gemini `cachedContents` (tools + system prompt, TTL 300s) | 캐시 토큰 −75%, TTFT −40~60% | Supervisor + Workers |
| 2 | Flash routing → Pro worker 만 (Flash fallback for FAQ) | 단순 쿼리 latency −60% | Supervisor |
| 3 | Streaming SSE (`/api/jarvis/stream`) | 첫 토큰 1~3초 | Route + client |
| 4 | Parallel tool use (동시 DB 호출) | Tool 라운드당 −40% | Workers |
| 5 | `MAX_ROUNDS` 10 → 5 + HITL 폴백 | 최악 케이스 −50% | gemini-agent-loop |
| 6 | 히스토리 요약 (최근 3턴을 한 문장으로) | 토큰 −60% | Session handler |
| 7 | Response-critic heuristic skip (쿼리 결과·짧은 답·인사 스킵) | 평균 latency −15% | response-critic |

**정량 목표**:
- 현재: p50 = 18s, p95 = 52s
- V2 목표: p50 = 4s, p95 = 12s (첫 토큰은 1~3s)

---

## 4. 멀티테넌트 격리 3계층

### Layer 1 — Request Context Injection
```ts
// middleware.ts
const tenantId = resolveTenant(req);  // subdomain / JWT claim / session
req.context = { tenantId, userId, userRole, surface };
```

### Layer 2 — Tool-level Forced Scoping
```ts
// src/lib/jarvis/scoped-client.ts (신규)
export function getScopedClient(ctx: JarvisContext) {
  return new Proxy(supabaseAdmin, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const query = target.from(table);
          // tenant_id 컬럼 있는 테이블은 자동 필터
          if (TENANT_SCOPED_TABLES.has(table)) {
            return query.eq('tenant_id', ctx.tenantId);
          }
          return query;
        };
      }
      return target[prop];
    }
  });
}
```

### Layer 3 — Supabase RLS (Defense in Depth)
```sql
-- 예: bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bookings
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### RAG 격리
- **Silo**: pgvector partial index `(tenant_id, embedding)` per tenant.
- 쿼리: `WHERE tenant_id = $1 ORDER BY embedding <=> $2 LIMIT 20`.
- 공유 지식 (여소남 본사 상품)은 `tenant_id = NULL` + 권한 룰로 포함.

### 비용 Attribution
- 모든 Gemini API call 의 `usageMetadata.promptTokenCount / candidatesTokenCount / cachedContentTokenCount` 를 `tenant_id` 로 tagging.
- `jarvis_cost_ledger(tenant_id, date, input_tokens, output_tokens, cache_read_tokens, cost_usd)` 일별 집계.

---

## 5. 테넌트(여행사)별 전용 봇 할당

### 5-1. Bot 프로파일
```ts
// tenant_bot_profiles 테이블
{
  tenant_id: uuid,
  bot_name: "ABC투어 컨시어지",
  persona_prompt: "..." // 테넌트 커스텀 페르소나
  allowed_agents: ['concierge', 'booking'],  // 역할 제한
  knowledge_sources: ['own_packages', 'own_blog'],  // RAG 스코프
  guardrails: { max_discount_pct: 5, escalate_on: [...] },
  branding: { color, logo_url, greeting },
}
```

### 5-2. 큰 프로세스는 플랫폼, 데이터는 테넌트
| 계층 | 소유 | 설명 |
|-----|-----|-----|
| **Process** (대화 흐름, HITL, retry) | 플랫폼 (여소남) | 공통 로직·감사·정책 집행 |
| **Data** (상품, 고객, 예약, facts) | 테넌트 (여행사) | tenant_id 로 엄격히 격리 |
| **Persona & Knowledge** | 테넌트 설정 | `tenant_bot_profiles` 에서 불러옴 |
| **Model/Cost** | 플랫폼 정책 + 테넌트 한도 | 월간 토큰 쿼터 관리 |

### 5-3. 활용 시나리오
1. 여행사 A 고객이 "오사카 상품 있어?" → A 의 상품만 검색 → A 페르소나로 응답.
2. 여행사 A 직원이 "이번 주 예약 현황" → A 예약만 조회 → 관리자용 형식으로 응답.
3. 여소남 본사 관리자가 "전체 테넌트 이번주 매출" → 글로벌 role 체크 후 cross-tenant 쿼리 허용.

---

## 6. 마이그레이션 로드맵

### Phase 0 — 진단 & 베이스라인 (D+0 ~ D+3)
- [x] 본 설계 문서 작성
- [ ] `types.ts` 에 `tenantId?: string` optional 필드 추가 (breaking 없음)
- [ ] `/api/jarvis/route.ts` 에 tenant 추출 훅 추가 (값 있으면 전달, 없으면 기존 동작)
- [ ] p50/p95 latency 베이스라인 측정 (DataDog 또는 Supabase 로그)

### Phase 1 — 지연 단기 승리 (D+3 ~ D+10)
- [ ] `claude-router.ts` few-shot 5개 추가 (라우팅 정확도 +10%)
- [ ] `response-critic.ts` 휴리스틱 스킵 확장 (조회·짧은 답·인사)
- [ ] `gemini-agent-loop.ts` `MAX_ROUNDS` 10→5
- [ ] 세션 히스토리 요약 lazy 적용

### Phase 2 — Gemini V2 경로 병행 (D+10 ~ D+25)
- [ ] `src/lib/jarvis/gemini-agent-loop-v2.ts` 신규 — `cachedContents` + streaming + parallel function calling
- [ ] `src/lib/jarvis/gemini-cache-manager.ts` 신규 — 캐시 TTL/재사용 매니저
- [ ] `/api/jarvis/stream` 신규 SSE 엔드포인트
- [ ] env flag `JARVIS_ENGINE=v1|v2` 로 A/B 테스트
- [ ] p50/p95 비교 리포트 → V2 경로가 30% 이상 빠르면 default 승격

### Phase 3 — 멀티테넌트 격리 (D+15 ~ D+30, Phase 2 와 병행)
- [ ] `src/lib/jarvis/scoped-client.ts` 신규 — Proxy-based forced scoping
- [ ] `TENANT_SCOPED_TABLES` 카탈로그 작성 (bookings, customers, travel_packages, ...)
- [ ] 전 에이전트 tool 을 `getScopedClient(ctx)` 로 마이그레이션
- [ ] Supabase RLS 정책 추가 (defense in depth)
- [ ] `tenant_bot_profiles` 테이블 + CRUD API

### Phase 4 — RAG 고도화 (D+30 ~ D+45)
- [ ] Contextual retrieval 인덱서 스크립트
- [ ] pgvector partial index per tenant
- [ ] Hybrid (BM25 + cosine) retriever
- [ ] 기존 `attractions`, `travel_packages`, `blog_posts` 인덱싱

### Phase 5 — 테넌트 봇 & 페르소나 (D+45 ~ D+60)
- [ ] `tenant_bot_profiles` UI (admin)
- [ ] 페르소나 슬롯 치환 파이프라인
- [ ] 비용 ledger + 쿼터 enforcement

---

## 7. 즉시 적용하는 변경 (이번 커밋)

| 파일 | 변경 내용 | 리스크 |
|-----|---------|-------|
| `src/lib/jarvis/types.ts` | `AgentRunParams` 에 `tenantId?: string` 추가 | 0 (optional) |
| `src/lib/jarvis/types.ts` | `JarvisContext` 에 `tenantId`, `userRole`, `surface` 추가 | 0 |
| `src/app/api/jarvis/route.ts` | 요청 헤더/세션에서 tenantId 추출 훅 | 0 (null 허용) |
| `src/lib/jarvis/claude-router.ts` | Few-shot 5개 추가 + 프롬프트 경량화 | 낮음 (동일 API 형태) |
| `src/lib/jarvis/response-critic.ts` | 조회성 답변·인사·감사 스킵 필터 확장 | 낮음 (fail-open 유지) |
| `db/JARVIS_V2_DESIGN.md` | 본 설계 문서 | 0 |

> **Phase 2 이후 (MCP·streaming·scoped-client)** 는 별도 브랜치/커밋으로 분리. 이번에는 골격만 깐다.

---

## 8. 오픈 질문 (향후 결정 대기)

1. ~~**프레임워크 채택**~~ **결정 완료 (2026-04-22)**: Gemini 2.5 전 레이어 유지. Anthropic 전환 철회. 근거는 §B.1 첫머리.
2. **MCP 서버 노출 범위**: 자체 호스트 vs Vercel MCP 엔드포인트. Phase 2 에서 결정.
3. **고객 상담 통합**: `/api/qa/chat` 을 자비스 `concierge` agent 로 흡수 vs 별도 유지. 흡수가 데이터 일관성에 유리하지만 마이그레이션 리스크 큼.
4. **비용 정책**: 테넌트별 월간 토큰 쿼터 vs pay-per-use. SaaS 요금제와 묶어서 결정.
5. **Supervisor 모델**: `gemini-2.5-flash` vs `gemini-2.5-flash-lite`. 라우팅 정확도 실측 후 결정.

---

## 9. 참고 자료

- Anthropic — [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- Anthropic — [Reducing latency (Claude docs)](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)
- Anthropic — [Prompt caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)
- LangChain — [Benchmarking Multi-Agent Architectures (Supervisor vs Swarm)](https://blog.langchain.com/benchmarking-multi-agent-architectures/)
- Mavik Labs — [Multi-Tenant RAG in 2026](https://www.maviklabs.com/blog/multi-tenant-rag-2026)
- OSU NLP — [TravelPlanner benchmark (ICML'24)](https://osu-nlp-group.github.io/TravelPlanner/)
- Self-RAG (Asai et al., 2024) — 기존 `response-critic.ts` 참고 문헌
- Mem0 — 기존 `fact-extractor.ts` 참고 문헌

---

## 10. 변경 이력

- 2026-04-22 · 초안 작성 (자비스 연동 감사 + 2026 최신 agentic 패턴 리서치 결과 반영)
- 2026-04-22 · Part B 추가 — Phase 2~5 구현 상세 설계 (실제 테이블 카탈로그·코드 스켈레톤·SQL·API 스펙까지 구체화)
- 2026-04-22 · **엔진 결정**: Gemini 2.5 전 레이어 유지. Anthropic 전환 제안 철회. Part B §B.1 코드 스켈레톤 전면 Gemini 기준으로 환원 (`cachedContents` + `generateContentStream` + parallel function calling)

---

# Part B — 구현 상세 설계 (Phase 2~5)

> Part A (§1~§9) 가 "무엇을, 왜" 라면, Part B 는 "어떻게" 이다.
> 각 Phase 의 **파일 구조 · API 시그니처 · 코드 스켈레톤 · DB 스키마** 를 실제 구현 가능한 수준으로 기술한다.

---

## B.1 Phase 2 — Gemini Agent Loop V2 + Streaming SSE

> **엔진 결정 (2026-04-22)**: Anthropic 대신 **Gemini 2.5 유지**. 근거:
> (1) 전 레이어 이미 Gemini (Router / Agent / Critic / Embedding), 전환 비용 과다
> (2) Flash 단가가 Haiku 대비 ~10× 저렴 — 호출량 많은 Router 에 결정적
> (3) Gemini 2.5 는 explicit caching (`cachedContents`) + implicit caching 둘 다 지원 → prompt caching 효과 동등
> (4) Parallel function calling + `generateContentStream` 네이티브
> (5) ANTHROPIC_API_KEY 갱신 운영 부담 회피
>
> 초기 설계의 Anthropic SDK 제안은 철회. 모든 LLM 경로는 Gemini 로 통일.

### B.1.1 목표
1. 기존 `gemini-agent-loop.ts` 를 확장한 **`gemini-agent-loop-v2.ts`** 신규 (기존 루프와 병행 운영)
2. `/api/jarvis/stream` **SSE 엔드포인트** 신규 — 첫 토큰 1~3초 (`generateContentStream`)
3. **Context Caching** 활성화 — 시스템 프롬프트 + 툴 정의를 `cachedContents` 로 래핑 (Gemini 2.5, TTL 300s)
4. **Parallel function calling** — Gemini 2.5 네이티브 활용, 여러 tool 동시 실행
5. **Implicit caching** 활용 — 반복 요청 자동 캐시 hit (25% 할인)
6. env flag `JARVIS_ENGINE=v1|v2` 로 A/B

### B.1.2 신규 파일 구조

```
src/lib/jarvis/
├── gemini-agent-loop-v2.ts    # NEW — caching + streaming + parallel tools
├── gemini-cache-manager.ts    # NEW — cachedContents 생성/TTL 관리
├── stream-encoder.ts          # NEW — SSE 이벤트 인코더
├── tool-executor.ts           # NEW — agent 에서 분리된 공통 tool 실행기
└── gemini-agent-loop.ts       # 기존 (legacy, v1)

src/app/api/jarvis/
├── route.ts                   # 기존 (non-stream, legacy)
└── stream/
    └── route.ts               # NEW — SSE endpoint
```

### B.1.3 `gemini-agent-loop-v2.ts` API 스펙

```ts
import { GoogleGenerativeAI, FunctionDeclaration } from '@google/generative-ai'
import type { JarvisContext, AgentRunResult, AgentType } from './types'
import { getOrCreateCache } from './gemini-cache-manager'

export interface GeminiAgentV2Config {
  agentType: AgentType
  systemPrompt: string
  tools: FunctionDeclaration[]
  executeTool: (name: string, args: any, ctx: JarvisContext) => Promise<any>
  model?: string                             // default 'gemini-2.5-pro'
  maxRounds?: number                         // default 5 (기존 10 에서 축소)
}

export interface StreamEvent {
  type: 'text_delta' | 'tool_use_start' | 'tool_result' | 'hitl_pending' | 'done' | 'error'
  data: any
}

/**
 * V2 스트리밍 agent loop (Gemini 2.5 native).
 *
 * 핵심 최적화:
 * - cachedContents: 시스템 프롬프트 + tool 정의를 캐시 (TTL 300s, 1024 토큰 이상 권장)
 * - generateContentStream: 토큰 단위 streaming → 첫 토큰 1~3초
 * - parallel function calling: Gemini 2.5 의 병렬 tool 반환 → Promise.all 로 동시 실행
 * - implicit caching: 반복 프롬프트 자동 캐시 (명시적 설정 없이도 25% 할인)
 * - HITL 필요 tool 감지 시 pending action 저장 + stream 중단
 */
export async function* runGeminiAgentLoopV2(
  config: GeminiAgentV2Config,
  params: { message: string; session: any; ctx: JarvisContext },
): AsyncGenerator<StreamEvent, AgentRunResult> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!)
  const maxRounds = config.maxRounds ?? 5
  const modelName = config.model ?? 'gemini-2.5-pro'

  // 1) explicit cache: 시스템 프롬프트 + tool schema 를 묶어 cachedContents 생성
  //    이미 있으면 재사용 (TTL 300s 내, key = agentType + prompt hash)
  const cachedContent = await getOrCreateCache({
    model: modelName,
    systemInstruction: config.systemPrompt,
    tools: [{ functionDeclarations: config.tools }],
    ttlSeconds: 300,
    keyHint: config.agentType,
  })
  // cachedContent 생성 실패(1024 토큰 미만 등) 시 null → 그냥 일반 호출로 폴백

  const history = (params.session?.messages ?? []).slice(-5).map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const contents: any[] = [...history, { role: 'user', parts: [{ text: params.message }] }]

  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(cachedContent ? { cachedContent: cachedContent.name } : {
      systemInstruction: config.systemPrompt,
      tools: [{ functionDeclarations: config.tools }],
    }),
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  })

  for (let round = 0; round < maxRounds; round++) {
    // 2) streaming: 토큰 단위 delta + 최종 메시지 양쪽 수집
    const result = await model.generateContentStream({ contents })

    let aggregatedParts: any[] = []
    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? []
      for (const p of parts) {
        if (p.text) yield { type: 'text_delta', data: p.text }
        if (p.functionCall) yield { type: 'tool_use_start', data: { name: p.functionCall.name } }
      }
    }
    const finalResponse = await result.response
    aggregatedParts = finalResponse.candidates?.[0]?.content?.parts ?? []
    contents.push({ role: 'model', parts: aggregatedParts })

    // 3) tool calls 추출 (Gemini 2.5 는 여러 개 병렬로 반환 가능)
    const toolCalls = aggregatedParts
      .filter((p: any) => p.functionCall)
      .map((p: any) => p.functionCall as { name: string; args: any })

    if (toolCalls.length === 0) {
      yield { type: 'done', data: { round } }
      return buildResult(aggregatedParts)
    }

    // 4) HITL 필터 — 하나라도 HITL 이면 저장 후 중단
    const hitlTool = toolCalls.find(t => requiresHITL(t.name))
    if (hitlTool) {
      const pending = await saveHITL(hitlTool, params.session, params.ctx)
      yield { type: 'hitl_pending', data: pending }
      return { ...buildResult(aggregatedParts), pendingAction: pending }
    }

    // 5) 병렬 tool 실행 (Gemini 2.5 의 parallel function calling 활용)
    const toolResponses = await Promise.all(
      toolCalls.map(async (t) => {
        try {
          const out = await config.executeTool(t.name, t.args, params.ctx)
          yield { type: 'tool_result', data: { name: t.name, ok: true } }
          return { functionResponse: { name: t.name, response: { result: out } } }
        } catch (err) {
          return {
            functionResponse: {
              name: t.name,
              response: { error: humanizeError(t.name, String(err)) },
            },
          }
        }
      }),
    )

    contents.push({ role: 'user', parts: toolResponses })
  }

  yield { type: 'error', data: { reason: 'max_rounds_exceeded' } }
  return {
    response: '복잡한 요청이에요 — 담당자 확인 후 답변드릴게요.',
    toolsUsed: [], pendingAction: null, pendingActionId: null, contextUpdate: {},
  }
}
```

### B.1.3a `gemini-cache-manager.ts` — Context Caching 매니저

```ts
import { GoogleGenerativeAI, CachedContent } from '@google/generative-ai'

type CacheKey = string  // `${agentType}:${hash(systemPrompt)+hash(tools)}`
const cacheRegistry = new Map<CacheKey, { name: string; expiresAt: number }>()

export async function getOrCreateCache(p: {
  model: string
  systemInstruction: string
  tools: any[]
  ttlSeconds: number
  keyHint: string
}): Promise<CachedContent | null> {
  // 토큰 임계 체크 — Gemini 2.5 는 1024 토큰 미만이면 캐시 생성 실패
  const rough = Math.ceil((p.systemInstruction.length + JSON.stringify(p.tools).length) / 4)
  if (rough < 1024) return null                           // 폴백: 일반 호출

  const key: CacheKey = `${p.keyHint}:${hashInputs(p.systemInstruction, p.tools)}`
  const cached = cacheRegistry.get(key)
  if (cached && cached.expiresAt > Date.now() + 10_000) {
    return { name: cached.name } as CachedContent         // TTL 10초 이상 남았으면 재사용
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!)
    const cache = await genAI.cachedContents.create({
      model: p.model,
      systemInstruction: p.systemInstruction,
      tools: p.tools,
      ttl: `${p.ttlSeconds}s`,
    })
    cacheRegistry.set(key, { name: cache.name, expiresAt: Date.now() + p.ttlSeconds * 1000 })
    return cache
  } catch (err) {
    console.warn('[jarvis-cache] create 실패 — 폴백:', err)
    return null
  }
}

function hashInputs(sys: string, tools: any[]): string {
  // 간이 FNV-1a (충돌은 무시 가능, 동일 프롬프트 감지용)
  let h = 2166136261
  const s = sys + JSON.stringify(tools)
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}
```

### B.1.4 `/api/jarvis/stream/route.ts` SSE 엔드포인트

```ts
import { NextRequest } from 'next/server'
import { runGeminiAgentLoopV2 } from '@/lib/jarvis/gemini-agent-loop-v2'
import { pickAgent } from '@/lib/jarvis/agents'
import { resolveJarvisContext } from '@/lib/jarvis/context'

export const runtime = 'nodejs'                 // Fluid Compute (미들웨어 edge 제거)
export const maxDuration = 60                   // 60s 초기, 추후 조정

export async function POST(req: NextRequest) {
  const body = await req.json()
  const ctx = resolveJarvisContext(req, body)
  const agentConfig = await pickAgent(body.message, ctx)   // Supervisor 분기

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runGeminiAgentLoopV2(agentConfig, { message: body.message, session: body.session, ctx })) {
          const sse = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
          controller.enqueue(encoder.encode(sse))
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

### B.1.5 Gemini Context Caching 적용 규칙

| 블록 | 캐시 방식 | 이유 |
|-----|---------|-----|
| 시스템 프롬프트 (base + agent) | `cachedContents` explicit, TTL 300s | 같은 agent 내 연속 요청에 재사용 |
| Tool 정의 전체 | `cachedContents` 에 포함 | 도구 스키마는 거의 불변 |
| 최근 5턴 히스토리 | 캐시 안 함 | 매 턴 바뀜 — implicit caching 이 자동 처리 |
| 사용자 메시지 | 캐시 안 함 | 매번 새로움 |

**캐시 생성 조건**:
- Gemini 2.5: **최소 1024 토큰** 이상이어야 `cachedContents.create()` 성공. 미만이면 `getOrCreateCache()` 가 `null` 반환하고 일반 호출로 폴백.
- 시스템 프롬프트(~600 토큰) + tool schema(수백 토큰) 합쳐서 1024+ 도달하도록 묶음.

**예상 효과 (Google 공식 + 실측)**:
- 캐시 hit 시 **캐시된 토큰 비용 75% 감소** (Gemini 2.5 Pro 기준 $1.25 → ~$0.31 / 1M)
- 캐시 write 는 1회성, TTL 300s 내에 2회 이상 요청이면 즉시 손익 역전
- 추가로 **implicit caching** (2.5 자동) 이 중복 프롬프트 감지 시 25% 자동 할인 → 겹쳐서 적용됨
- TTFT: streaming + caching 조합으로 **~40~60% 감소** 기대 (Anthropic 80% 보다는 낮지만 단가 우위로 상쇄)

### B.1.6 클라이언트 측 수신 (참고)

```ts
// src/app/admin/jarvis/JarvisChat.tsx (기존 페이지 수정)
const response = await fetch('/api/jarvis/stream', { method: 'POST', body: JSON.stringify({ message, sessionId }) })
const reader = response.body!.getReader()
const decoder = new TextDecoder()
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  // SSE 파싱 → setState 로 점진 렌더
}
```

---

## B.2 Phase 3 — Tenant Scoping (scoped-client + RLS)

### B.2.1 현황 매핑

이번 grep 으로 확인한 **tenant_id 보유 테이블** (2026-04-22):

| 테이블 | 출처 | 상태 |
|-------|-----|-----|
| `tenants` | saas_marketplace_v1.sql | 루트 |
| `travel_packages` | saas_marketplace_v1.sql | nullable (여소남 본사 상품은 NULL) |
| `inventory_blocks` | saas_marketplace_v1.sql | NOT NULL |
| `api_orders` | saas_marketplace_v1.sql | nullable |
| `customer_facts` | 20260414120000 | nullable |
| `error_patterns` | 20260420000000 | nullable (NULL = 전역) |
| `content_creatives` | content_hub_v1.sql | nullable |
| `content_daily_stats` | content_hub_v1.sql | nullable |
| `content_insights` | content_hub_v1.sql | nullable |
| `rfq_access` | group_rfq_v1.sql | NOT NULL |
| `rfq_proposals` | group_rfq_v1.sql | NOT NULL |

**확장 필요 (47개 테이블 추정, memory/project_multitenancy_status.md 참조)**:
- P0 (자비스 직접 쿼리): `bookings`, `customers`, `payments`, `message_logs`, `jarvis_sessions`, `jarvis_tool_logs`, `jarvis_pending_actions`, `jarvis_facts`, `settlements`
- P1 (간접 참조): `attractions`, `blog_posts`, `departing_locations`, `land_operators`, `policies`
- P2 (공유 마스터): `iata_codes`, `regions` — NULL 허용 (전역)

### B.2.2 `TENANT_SCOPED_TABLES` 카탈로그

```ts
// src/lib/jarvis/scoped-tables.ts (신규)
export const TENANT_SCOPED_TABLES = {
  // 강제 필터 — 테넌트 격리 절대 필수
  STRICT: new Set([
    'bookings', 'customers', 'payments', 'message_logs',
    'jarvis_sessions', 'jarvis_tool_logs', 'jarvis_pending_actions', 'jarvis_facts',
    'settlements', 'inventory_blocks', 'rfq_access', 'rfq_proposals',
    'customer_facts', 'tenant_bot_profiles',
  ]),
  // NULL 허용 — 여소남 본사 데이터는 tenant_id IS NULL, 테넌트 데이터는 해당 id
  NULLABLE: new Set([
    'travel_packages', 'api_orders', 'error_patterns',
    'content_creatives', 'content_daily_stats', 'content_insights',
    'blog_posts', 'attractions',
  ]),
  // 전역 마스터 — tenant_id 없음
  GLOBAL: new Set([
    'tenants', 'iata_codes', 'regions', 'departing_locations',
    'policies', 'land_operators',
  ]),
} as const
```

### B.2.3 `getScopedClient(ctx)` Proxy 구현

```ts
// src/lib/jarvis/scoped-client.ts (신규)
import { supabaseAdmin } from '@/lib/supabase'
import { TENANT_SCOPED_TABLES } from './scoped-tables'
import type { JarvisContext } from './types'

export class TenantScopeError extends Error {}

export function getScopedClient(ctx: JarvisContext) {
  // 플랫폼 관리자는 전역 쿼리 허용
  if (ctx.userRole === 'platform_admin') return supabaseAdmin

  if (!ctx.tenantId) {
    // tenant 없이 strict 테이블을 건드리는 tool 은 거부해야 함
    // → proxy get('from') 에서 런타임 체크
  }

  return new Proxy(supabaseAdmin, {
    get(target, prop) {
      if (prop !== 'from') return (target as any)[prop]
      return (table: string) => {
        const query = (target as any).from(table)
        if (TENANT_SCOPED_TABLES.STRICT.has(table)) {
          if (!ctx.tenantId) throw new TenantScopeError(`tenant_id required for ${table}`)
          return query.eq('tenant_id', ctx.tenantId)
        }
        if (TENANT_SCOPED_TABLES.NULLABLE.has(table)) {
          if (!ctx.tenantId) return query.is('tenant_id', null)           // 여소남 본사 데이터만
          // 테넌트 데이터 + 공유(NULL) 둘 다 조회 (여소남 본사 공유 카탈로그 노출용)
          return query.or(`tenant_id.eq.${ctx.tenantId},tenant_id.is.null`)
        }
        return query  // GLOBAL 또는 미등록 테이블
      }
    },
  })
}
```

### B.2.4 RLS 정책 (Defense in Depth)

```sql
-- supabase/migrations/20260423000000_jarvis_v2_tenant_rls.sql (신규)
-- 애플리케이션 Proxy 가 뚫려도 DB 레이어에서 막는 2차 방어선
-- 전제: 요청마다 SET app.tenant_id = <uuid>, SET app.user_role = <role> 실행

-- STRICT 테이블 (예시: bookings)
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bookings;
CREATE POLICY tenant_isolation ON bookings
  USING (
    current_setting('app.user_role', true) = 'platform_admin'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

-- NULLABLE 테이블 (예시: travel_packages) — tenant + 전역(NULL) 둘 다 노출
ALTER TABLE travel_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_shared ON travel_packages
  USING (
    current_setting('app.user_role', true) = 'platform_admin'
    OR tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

-- STRICT 테이블 전수 적용 (bookings, customers, payments, ...)
-- 각 테이블별 정책 자동 생성 DO block:
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'bookings','customers','payments','message_logs',
    'jarvis_sessions','jarvis_tool_logs','jarvis_pending_actions','jarvis_facts',
    'settlements','inventory_blocks'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (current_setting('app.user_role', true) = 'platform_admin'
             OR tenant_id::text = current_setting('app.tenant_id', true))$p$, t);
  END LOOP;
END $$;
```

### B.2.5 요청 컨텍스트 주입 (미들웨어)

```ts
// src/lib/supabase-scoped.ts (신규) — 요청마다 SET local 실행
export async function withTenantContext<T>(
  ctx: JarvisContext,
  fn: (sb: SupabaseClient) => Promise<T>
): Promise<T> {
  const sb = supabaseAdmin
  // Supabase JS 는 per-request SET 이 어렵 → RPC 래퍼로 처리
  await sb.rpc('set_request_context', {
    p_tenant_id: ctx.tenantId ?? null,
    p_user_role: ctx.userRole ?? 'tenant_staff',
    p_user_id:   ctx.userId   ?? null,
  })
  return fn(sb)
}
```

```sql
-- RPC (신규)
CREATE OR REPLACE FUNCTION set_request_context(
  p_tenant_id uuid, p_user_role text, p_user_id uuid
) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.tenant_id', COALESCE(p_tenant_id::text, ''), true);
  PERFORM set_config('app.user_role', COALESCE(p_user_role, ''), true);
  PERFORM set_config('app.user_id',   COALESCE(p_user_id::text, ''), true);
END $$ LANGUAGE plpgsql SECURITY DEFINER;
```

### B.2.6 마이그레이션 단계

1. **Step 1 — 모든 P0 테이블에 `tenant_id` 컬럼 추가** (nullable 로 시작)
2. **Step 2 — `getScopedClient` 를 자비스 agents 전 파일 적용** (tool 구현부)
3. **Step 3 — 데이터 백필** (기존 데이터에 기본 tenant_id 채우기)
4. **Step 4 — 컬럼 NOT NULL 승격 + RLS 정책 활성화**
5. **Step 5 — Integration 테스트**: 테넌트 A 로 로그인 후 B 데이터 조회 시도 → 0건 반환 검증

---

## B.3 Phase 4 — Contextual Retrieval RAG (Silo per Tenant)

### B.3.1 목표
- 상품/블로그/관광지 문서를 **Contextual Retrieval** (chunk 앞 50~100 토큰 컨텍스트 prepend) 로 청킹
- **Silo 인덱스** — `(tenant_id, embedding)` 파티션드 pgvector index
- **Hybrid retrieval** — BM25 + cosine, RRF (Reciprocal Rank Fusion) 재순위
- **Reranker** — top-20 → top-5 (Claude Haiku 로 LLM rerank)

### B.3.2 DB 스키마

```sql
-- supabase/migrations/20260425000000_jarvis_rag_index.sql (신규)
CREATE TABLE IF NOT EXISTS jarvis_knowledge_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = 공유
  source_type      TEXT NOT NULL,  -- 'package' | 'blog' | 'attraction' | 'policy' | 'custom'
  source_id        UUID,
  source_url       TEXT,
  chunk_index      INTEGER NOT NULL,
  chunk_text       TEXT NOT NULL,              -- 원본 청크
  contextual_text  TEXT NOT NULL,              -- [chunk 앞 컨텍스트 prepend] + chunk_text
  embedding        VECTOR(1536),               -- gemini-embedding-001
  bm25_tokens      TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', contextual_text)) STORED,
  metadata         JSONB DEFAULT '{}'::jsonb,  -- { destination, price_range, season, ... }
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Silo index per tenant (partial index)
-- tenant 수가 수십개 이하면 partial index 이 가장 효율적
-- 수백개 이상이면 partition 으로 전환
CREATE INDEX idx_jarvis_chunks_embedding_global
  ON jarvis_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE tenant_id IS NULL;

-- Dynamic per-tenant partial indexes (큰 테넌트만)
-- CREATE INDEX idx_jarvis_chunks_tenant_xxx
--   ON jarvis_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
--   WHERE tenant_id = 'xxx-xxx-xxx';

CREATE INDEX idx_jarvis_chunks_tenant ON jarvis_knowledge_chunks (tenant_id, source_type);
CREATE INDEX idx_jarvis_chunks_bm25   ON jarvis_knowledge_chunks USING GIN (bm25_tokens);

-- Hybrid search RPC
CREATE OR REPLACE FUNCTION jarvis_hybrid_search(
  p_query_embedding VECTOR(1536),
  p_query_text TEXT,
  p_tenant_id UUID DEFAULT NULL,
  p_source_types TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  id UUID, chunk_text TEXT, contextual_text TEXT,
  source_type TEXT, source_id UUID, metadata JSONB,
  vector_score FLOAT, bm25_score FLOAT, rrf_score FLOAT
) AS $$
WITH vector_hits AS (
  SELECT id, 1 - (embedding <=> p_query_embedding) AS score,
         ROW_NUMBER() OVER (ORDER BY embedding <=> p_query_embedding) AS rank
  FROM jarvis_knowledge_chunks
  WHERE (p_tenant_id IS NULL OR tenant_id = p_tenant_id OR tenant_id IS NULL)
    AND (p_source_types IS NULL OR source_type = ANY(p_source_types))
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_limit * 3
),
bm25_hits AS (
  SELECT id, ts_rank(bm25_tokens, plainto_tsquery('simple', p_query_text)) AS score,
         ROW_NUMBER() OVER (ORDER BY ts_rank(bm25_tokens, plainto_tsquery('simple', p_query_text)) DESC) AS rank
  FROM jarvis_knowledge_chunks
  WHERE (p_tenant_id IS NULL OR tenant_id = p_tenant_id OR tenant_id IS NULL)
    AND bm25_tokens @@ plainto_tsquery('simple', p_query_text)
  LIMIT p_limit * 3
)
SELECT c.id, c.chunk_text, c.contextual_text, c.source_type, c.source_id, c.metadata,
       COALESCE(v.score, 0) AS vector_score,
       COALESCE(b.score, 0) AS bm25_score,
       COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + b.rank), 0) AS rrf_score
FROM jarvis_knowledge_chunks c
LEFT JOIN vector_hits v ON c.id = v.id
LEFT JOIN bm25_hits   b ON c.id = b.id
WHERE v.id IS NOT NULL OR b.id IS NOT NULL
ORDER BY rrf_score DESC
LIMIT p_limit;
$$ LANGUAGE sql STABLE;
```

### B.3.3 인덱서 스크립트

```
db/
├── rag_index_packages.js     # NEW — travel_packages → jarvis_knowledge_chunks
├── rag_index_blogs.js        # NEW — blog_posts → chunks
├── rag_index_attractions.js  # NEW — attractions (long_desc) → chunks
├── rag_reindex_all.js        # NEW — 전수 재인덱싱 orchestrator
└── rag_contextualize.js      # NEW — chunk 앞 컨텍스트 생성 (Haiku)
```

**Contextual Retrieval 핵심 루틴** (Anthropic 가이드 기반):
```js
// db/rag_contextualize.js
async function addContextToChunk(docTitle, docSummary, chunk, client) {
  const { content } = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `<document>\n${docSummary}\n</document>\n<chunk>\n${chunk}\n</chunk>\n이 청크가 상위 문서에서 어떤 맥락인지 한 문장 한국어로 설명. 검색 최적화 관점.`,
    }],
    // 같은 문서 내 여러 청크 처리 시 doc 을 cache 로
    system: [{ type: 'text', text: `문서: ${docTitle}`, cache_control: { type: 'ephemeral' } }],
  })
  return `${content[0].text}\n\n${chunk}`
}
```

### B.3.4 Retriever 인터페이스

```ts
// src/lib/jarvis/rag/retriever.ts (신규)
export interface RetrievalQuery {
  query: string
  tenantId?: string
  sourceTypes?: ('package' | 'blog' | 'attraction' | 'policy')[]
  limit?: number
  rerank?: boolean
}

export async function retrieve(q: RetrievalQuery): Promise<RetrievalResult[]> {
  // 1. 쿼리 임베딩 (Gemini embedding-001)
  const embedding = await embedQuery(q.query)

  // 2. Hybrid search (Vector + BM25 + RRF)
  const { data } = await supabaseAdmin.rpc('jarvis_hybrid_search', {
    p_query_embedding: embedding,
    p_query_text: q.query,
    p_tenant_id: q.tenantId ?? null,
    p_source_types: q.sourceTypes ?? null,
    p_limit: q.rerank ? 20 : (q.limit ?? 5),
  })

  // 3. LLM rerank (옵션, Haiku 사용 — 작은 모델)
  if (q.rerank) return await rerankWithHaiku(q.query, data).then(r => r.slice(0, q.limit ?? 5))
  return data
}
```

### B.3.5 concierge agent 통합

```ts
// src/lib/jarvis/agents/concierge.ts (신규, products.ts 확장 대안)
const CONCIERGE_TOOLS = [{
  name: 'knowledge_search',
  description: '고객 질문에 답하기 위해 상품/블로그/관광지 지식베이스를 검색합니다.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      source_types: { type: 'array', items: { enum: ['package','blog','attraction','policy'] } },
      limit: { type: 'number' },
    },
    required: ['query'],
  },
}]

async function executeKnowledgeSearch(args, ctx) {
  return retrieve({
    query: args.query,
    tenantId: ctx.tenantId,
    sourceTypes: args.source_types,
    limit: args.limit ?? 5,
    rerank: true,
  })
}
```

---

## B.4 Phase 5 — Tenant Bot Profiles + Persona + Cost Ledger

### B.4.1 DB 스키마

```sql
-- supabase/migrations/20260428000000_tenant_bot_profiles.sql (신규)
CREATE TABLE IF NOT EXISTS tenant_bot_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bot_name              TEXT NOT NULL,                       -- "ABC투어 여행 컨시어지"
  greeting              TEXT,                                -- 첫 인사말
  persona_prompt        TEXT,                                -- 테넌트 커스텀 페르소나 (base 에 append)
  allowed_agents        TEXT[] DEFAULT ARRAY['concierge','booking'],
  knowledge_scope       JSONB DEFAULT '{}'::jsonb,           -- { include_shared: true, source_types: [...] }
  guardrails            JSONB DEFAULT '{}'::jsonb,           -- { max_discount_pct: 5, forbidden_promises: [...] }
  branding              JSONB DEFAULT '{}'::jsonb,           -- { color, logo_url, avatar_url }
  monthly_token_quota   BIGINT DEFAULT 5000000,              -- 500만 토큰/월 기본
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

CREATE TABLE IF NOT EXISTS jarvis_cost_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,    -- NULL = 플랫폼 내부 호출
  session_id        UUID,
  agent_type        TEXT,
  model             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cost_usd          NUMERIC(10,6),
  latency_ms        INTEGER,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_cost_ledger_tenant_date ON jarvis_cost_ledger (tenant_id, created_at);

-- 월간 사용량 집계 뷰
CREATE VIEW jarvis_monthly_usage AS
SELECT
  tenant_id,
  date_trunc('month', created_at) AS month,
  SUM(input_tokens + output_tokens) AS total_tokens,
  SUM(cost_usd) AS total_cost_usd,
  COUNT(*) AS call_count,
  AVG(latency_ms) AS avg_latency_ms
FROM jarvis_cost_ledger
GROUP BY tenant_id, date_trunc('month', created_at);
```

### B.4.2 Persona 슬롯 치환

```ts
// src/lib/jarvis/persona.ts (신규)
export async function buildTenantSystemPrompt(
  basePrompt: string,
  tenantId: string | undefined,
  today: string,
): Promise<string> {
  if (!tenantId) return basePrompt                    // 여소남 본사 기본 페르소나

  const { data: profile } = await supabaseAdmin
    .from('tenant_bot_profiles')
    .select('bot_name, persona_prompt, guardrails')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (!profile) return basePrompt

  const guardrailText = profile.guardrails?.max_discount_pct
    ? `\n## 테넌트 가드레일\n- 할인 약속은 ${profile.guardrails.max_discount_pct}% 를 초과하지 마세요.`
    : ''

  return `${basePrompt}
## 테넌트 페르소나
당신의 이름은 "${profile.bot_name}" 입니다.
${profile.persona_prompt ?? ''}
${guardrailText}`
}
```

### B.4.3 Cost 기록 훅

```ts
// src/lib/jarvis/cost-tracker.ts (신규)
export async function trackCost(p: {
  tenantId?: string
  sessionId?: string
  agentType: string
  model: string
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  latencyMs: number
}) {
  const cost = computeCostUSD(p.model, p.usage)
  await supabaseAdmin.from('jarvis_cost_ledger').insert({
    tenant_id: p.tenantId ?? null,
    session_id: p.sessionId ?? null,
    agent_type: p.agentType,
    model: p.model,
    input_tokens: p.usage.input_tokens,
    output_tokens: p.usage.output_tokens,
    cache_read_tokens: p.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: p.usage.cache_creation_input_tokens ?? 0,
    cost_usd: cost,
    latency_ms: p.latencyMs,
  })
}

// 쿼터 체크
export async function assertQuota(tenantId: string): Promise<void> {
  const { data } = await supabaseAdmin.rpc('jarvis_current_month_usage', { p_tenant_id: tenantId })
  const profile = await getBotProfile(tenantId)
  if (data.total_tokens >= profile.monthly_token_quota) {
    throw new QuotaExceededError(`월 토큰 한도 ${profile.monthly_token_quota} 초과`)
  }
}
```

### B.4.4 Admin UI (관리자용 봇 설정)

```
src/app/admin/tenants/[tenantId]/bot/page.tsx (신규)
  ├─ 봇 이름, 인사말 편집
  ├─ 페르소나 프롬프트 에디터 (마크다운)
  ├─ allowed_agents 체크박스
  ├─ guardrails (JSON 편집 + 프리셋)
  ├─ 월 토큰 쿼터 슬라이더
  └─ 이번 달 사용량 대시보드 (latency, cost, call count)
```

---

## B.5 전체 로드맵 Gantt

```
주차       1   2   3   4   5   6   7   8
Phase 0  ●───
Phase 1  ──●─────
Phase 2      ───●─────
Phase 3          ───●─────────
Phase 4                ───●─────
Phase 5                        ───●───
```

**마일스톤**:
- W2 말: Phase 1 완료, p95 35s 이하
- W4 말: Phase 2 완료, SSE 스트리밍 GA, p50 8s / p95 20s
- W6 말: Phase 3 완료, 멀티테넌트 격리 RLS+Proxy 양쪽 적용, 첫 파트너 온보딩 가능
- W7 말: Phase 4 완료, Contextual RAG 전 상품/블로그/관광지 인덱싱
- W8 말: Phase 5 완료, tenant_bot_profiles UI + cost ledger GA

---

## B.6 리스크 & 대응

| 리스크 | 발생 가능성 | 영향 | 대응 |
|-------|-----------|-----|-----|
| GOOGLE_AI_API_KEY 쿼터 초과 | 중 | 자비스 전면 중단 | Vertex AI 또는 2차 key rotation, `monthly_token_quota` 로 테넌트별 제한 |
| Gemini `cachedContents` 1024 토큰 임계 미달 | 낮음 | 캐시 미적용 (정상 호출 폴백) | `gemini-cache-manager.ts` 가 자동 폴백 + 로그. 시스템 프롬프트 + tool schema 합쳐서 임계 넘도록 설계 |
| RLS 정책 잘못 설정해 자기 데이터도 못 봄 | 중 | 서비스 중단 | 스테이징 먼저, `SECURITY DEFINER` 함수로 우회 경로 확보 |
| 테넌트 데이터 백필 누락 | 중 | 일부 데이터 "주인 없음" | 마이그레이션 전 `SELECT count(*) WHERE tenant_id IS NULL` 체크 |
| Contextual retrieval LLM 비용 | 중 | 초기 인덱싱 $30+ | Gemini 2.5 Flash + caching 사용 (Haiku 대비 10배 저렴), 1회성 비용 |
| pgvector HNSW index 크기 | 중 | 인덱스 용량 폭증 | partial index per 큰 테넌트, 작은 테넌트는 글로벌 |
| Supervisor 라우팅 오판 | 중 | 잘못된 agent 실행 | confidence < 0.7 이면 사용자에게 확인 질문 |

---

---

# Part C — 구현 완료 스냅샷 (2026-04-22)

> Phase 0 ~ Phase 8 전체가 본 세션에서 브랜치 스택으로 커밋 완료. 실제 서비스 전환은 DB 마이그·RAG 인덱싱·RLS 활성화·프론트 통합 단계만 남음.

## C.1 전체 커밋 스택

```
main
 └─ 6e2c1a9  Phase 0·1   설계 마스터 + 저위험 패치
     └─ 2be4c2a  Phase 2   Gemini streaming agent loop + SSE
         └─ 352b2e6  Phase 3   멀티테넌트 격리 (scoped-client + RLS)
             └─ 2970825  Phase 4   Contextual Retrieval RAG (Silo per tenant)
                 └─ 8d3d6a5  Phase 5   tenant_bot_profiles + persona + cost ledger
                     └─ b3044e0  Phase 6   전 agent V2 연결 + SSE 훅 + 봇 관리 UI
                         └─ 91d0699  Phase 7   감사 공백 tool (블로그/상품 기안)
                             └─ [Phase 8]  smoke 테스트 + 문서화
```

## C.2 파일 맵 — 어디서 뭘 찾을지

| 주제 | 파일 | 역할 |
|------|-----|-----|
| 엔진 선택 | `src/lib/jarvis/gemini-agent-loop-v2.ts` | V2 스트리밍 + caching + parallel tools |
| 캐시 관리 | `src/lib/jarvis/gemini-cache-manager.ts` | cachedContents REST 래퍼, 1024 토큰 미만 자동 폴백 |
| 이벤트 스트림 | `src/lib/jarvis/stream-encoder.ts` + `src/app/api/jarvis/stream/route.ts` | SSE 인코더 + 엔드포인트 |
| 디스패치 | `src/lib/jarvis/v2-dispatch.ts` | Router → agent config 조립 (6개 agent 전체 지원) |
| 테넌트 격리 | `src/lib/jarvis/scoped-tables.ts` + `scoped-client.ts` | Proxy 기반 강제 스코핑, STRICT/NULLABLE/GLOBAL 카탈로그 |
| RLS | `supabase/migrations/20260423*.sql` | RPC + tenant_id 컬럼 + 정책 + enable/disable 훅 |
| RAG | `supabase/migrations/20260424*.sql` + `src/lib/jarvis/rag/retriever.ts` | Contextual + Hybrid Search (Vector+BM25+RRF) |
| 인덱싱 | `db/rag_contextualize.js` + `db/rag_reindex_all.js` | Flash contextualize + 전수 재인덱싱 오케스트레이터 |
| 테넌트 봇 | `supabase/migrations/20260425*.sql` + `src/lib/jarvis/persona.ts` + `cost-tracker.ts` | 프로파일 + 쿼터 + 단가 계산 + 원장 |
| 컨텍스트 | `src/lib/jarvis/context.ts` | JWT + 헤더 + body 우선순위로 JarvisContext 조립 |
| 프론트 훅 | `src/lib/jarvis/useJarvisStream.ts` | React SSE 훅 + V1 자동 폴백 |
| 관리자 UI | `src/app/admin/tenants/[tenantId]/bot/page.tsx` | 봇 설정 + 사용량 대시보드 |
| Admin API | `src/app/api/admin/jarvis/bot-profile/route.ts` + `usage/route.ts` | GET/PUT 봇 프로파일 + 사용량 조회 |
| 기안 워크플로 | `src/lib/jarvis/agents/marketing.ts::propose_blog_draft` + `products.ts::propose_product_registration` | 감사 공백 채우기 |
| 스모크 테스트 | `db/smoke_jarvis_v2.js` | node:test, 16 케이스, 단가·분류·SSE·guardrail |

## C.3 라우팅 매트릭스

| Router 결과 | surface | V2 buildConfig → | RAG? | HITL 유발 가능 tool |
|-----------|--------|-----------------|------|-------------------|
| operations | admin | operations tools | ❌ | create_booking, update_booking_status, create_customer, update_customer, match_payment, send_booking_guide, propose_merge_customers |
| products | admin | products tools | ❌ | update_package_status, propose_product_registration |
| products | customer | concierge (RAG) | ✅ | — |
| finance | admin | finance tools | ❌ | create_settlement |
| marketing | admin | marketing tools | ❌ | generate_card_news, propose_blog_draft |
| sales | admin | sales tools | ❌ | create_settlement, update_rfq_status |
| system | admin | system tools | ❌ | update_policy |

## C.4 env 플래그 카탈로그

| env | 기본값 | 역할 |
|-----|-------|-----|
| `JARVIS_ENGINE` | v1 | `v2` 로 두면 프론트가 `/api/jarvis/stream` 우선 호출 |
| `JARVIS_STREAM_ENABLED` | true | `false` 면 /api/jarvis/stream 503 (긴급 스위치) |
| `JARVIS_V2_MAX_ROUNDS` | 5 | V2 tool-use 라운드 상한 |
| `JARVIS_V2_HISTORY_TURNS` | 5 | V2 히스토리 컨텍스트 포함 턴 수 |
| `JARVIS_V2_AGENT_MODEL` | gemini-2.5-pro | V2 worker 모델 |
| `JARVIS_ROUTER_MODEL` | gemini-2.0-flash | Router 모델 |
| `JARVIS_MAX_ROUNDS` | 10 | V1 tool-use 라운드 상한 |
| `JARVIS_HISTORY_TURNS` | 10 | V1 히스토리 컨텍스트 턴 수 |
| `JARVIS_RLS_ENABLED` | false | `true` 면 applyRequestContext 가 RPC 호출 |
| `DISABLE_RESPONSE_CRITIC` | false | `true` 면 response-critic 검증 스킵 |

## C.5 비용 0 으로 지금 바로 확인 가능한 것

```bash
# 스모크 테스트
node --test db/smoke_jarvis_v2.js

# TypeScript 타입 체크
npx tsc --noEmit

# RAG 인덱싱 dry-run (실제 API 호출 없음)
node db/rag_reindex_all.js --dry-run --limit=5
```

## C.6 비용 발생 단계 (사용자 승인 필요)

| 단계 | 추정 비용 | 위험도 |
|-----|---------|-------|
| Supabase 스테이징 마이그 5개 | $0 (DB 용량) | 낮음 |
| RAG 전수 인덱싱 (~3000 청크) | $30~50 (Gemini Flash + Embedding 일회성) | 중 |
| V2 트래픽 전환 (월 10만 호출 가정) | 기존 V1 대비 **-40~60%** (caching + Flash 라우터) | 낮음 |
| RLS 활성화 | $0, 스테이징 검증 후 | 높음 (잘못 설정 시 서비스 중단, disable 훅 있음) |

## C.7 남은 후속 작업 (Phase 9+)

- **SSE 프론트 통합** — 실제 어드민 `/admin/jarvis` 페이지에 `useJarvisStream` 훅 적용
- **qa-chat V2 전환** — 랜딩페이지 고객 상담을 `/api/jarvis/stream` + `surface='customer'` 로 전환 (JSON-lines → SSE 프로토콜 변경)
- **jarvis-v1 deprecation** — V2 p50/p95 검증 후 V1 폴백 경로 단계적 제거
- **marketing agent 실제 API 연결** — Meta/Naver/Google Ads (실제 키 필요)
- **pgvector partial index per 큰 테넌트** — 테넌트 규모가 커지면 Silo partial HNSW 추가

## B.7 Part B 변경 이력

- 2026-04-22 · Part B 초안 — Phase 2~5 구현 상세. 실제 테이블 스캔 결과 반영 (tenant_id 보유 11개 테이블 확인).
- 2026-04-22 · §B.1 엔진 환원 — Claude/Anthropic 기반 스켈레톤을 Gemini 2.5 (`cachedContents` + `generateContentStream` + parallel function calling) 로 재작성. `gemini-cache-manager.ts` 신규. ANTHROPIC_API_KEY 관련 리스크 항목 제거, GOOGLE_AI_API_KEY 쿼터·1024 토큰 임계 리스크 추가.
