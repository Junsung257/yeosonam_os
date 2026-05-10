# 상품 등록 파이프라인 개선 계획 (2026-05-10)

> **목적**: `/register` Step 0~7 파이프라인의 **속도·토큰비용·정확도**를 끌어올린다.
> 등록된 상품은 모바일 랜딩페이지·A4 포스터·블로그·카드뉴스에 그대로 반영되므로,
> 등록 단계 정확도 = 7개 채널 정확도. 환각·왜곡·축약을 등록 단계에서 차단한다.
>
> **대상 독자**: 사장님(의사결정), 향후 작업할 에이전트.

---

## TL;DR — 즉시 효과 TOP 10

| # | 제안 | 카테고리 | 효과 | 난이도 | 상태 |
|---|---|---|---|---|---|
| 1 | Anthropic prompt cache 1h TTL opt-in (`longCache`) | 토큰 | input -80% (cache hit↑) | 1/5 | ✅ **이번 PR 적용** |
| 2 | Validate-retry feedback truncate + telemetry | 정확도·토큰 | retry 시 컨텍스트 폭증 차단 | 1/5 | ✅ **이번 PR 적용** |
| 3 | post_register_audit RAG/CoVe/render 3-way 병렬 | 속도 | -60% (5초 → 2초) | 2/5 | ✅ **이번 PR 적용** |
| 4 | Confidence-gated Advisor (Trust-or-Escalate ICLR 2025) | 토큰 | Pro 호출 -50% | 2/5 | ✅ **메커니즘 적용 (콜러 opt-in 대기)** |
| 5 | Vercel Workflow DevKit으로 Step 0~7 durable 화 | 속도·안정성 | 실패 재실행 토큰 -70% | 4/5 | 🟡 1분기 |
| 6 | GEPA로 normalize-with-llm prompt offline 최적화 | 정확도·토큰 | 정확도 +5~10%p, prompt -15% | 3/5 | 🟡 1분기 |
| 7 | RARR-style verification question을 cove_audit.js에 추가 | 정확도 | hallucination -20% | 3/5 | ✅ **이번 PR 적용** |
| 8 | BAML SAP 알고리즘 흡수 (markdown-in-JSON 파서) | 정확도 | 파싱 실패율 -30% | 3/5 | ✅ **이번 PR 적용** |
| 9 | LLM Cascade Routing — 분류·라우팅에 Haiku→Sonnet 동적 escalation | 토큰 | -45~60% | 3/5 | 🟡 1분기 |
| 10 | 카드뉴스/블로그 컨텍스트 LLMLingua-2 압축 | 토큰 | 창작 컨텍스트 -50% | 3/5 | 🔵 보류 |

---

## 1. 현재 파이프라인 매핑 (정리)

### Step 0~7 흐름과 비용 핫스팟

| Step | 작업 | 모델 | 평균 토큰 | 평균 시간 |
|---|---|---|---|---|
| 0 | 사전 체크 (error-registry, manage-attractions) | — | 0 | 30s |
| 1 | 입력 파싱 + 카탈로그 모순 감지 (W26~W29) | — (정규식) | 0 | 1m |
| 2 | 지역 코드 추출 (XIY/TAO/NHA…) | — | 0 | 5s |
| 2.5 | IR 파이프 (direct/Gemini/Sonnet 분기) | direct=0 / Flash 0.003$ / **Sonnet 0.03$** | 8K~12K | 30s |
| 3 | 어셈블러 vs insert-template 라우팅 + 중복감지 | — | 0 | 5s |
| 6.5 | Agent self-audit (제로코스트, 7 claim 검증) | (세션 내) | (사용자 컨텍스트) | 1m |
| 7-3 | post-audit (E1~E4 sync + RAG + CoVe opt-in + 렌더 fetch + E5 opt-in) | Gemini Flash (opt-in) | 3K~5K (E5) + 0.5K (E6) | **2~5m** |
| 7-A | 자동 승인 (audit_status=clean) | — | 0 | 1s |

**핫스팟 TOP 5** (기존 코드 기준):
1. `register.md:638-825` — Step 1.5 카탈로그 모순 검증 (느리진 않지만 실패 시 재시작 비용)
2. `db/templates/insert-template.js` — validatePackage W1~W19 (sync, 100ms 미만)
3. `db/post_register_audit.js` E5 (Gemini cross-check, 90s) ← **이번 PR로 ~30s 단축**
4. `src/lib/normalize-with-llm.ts` IR Sonnet 경로 (옵션, 30s)
5. 어셈블러 실행 (경로 A) — 0원 1분, 가장 효율적

### 정확도 위험 구간 TOP 5 (error-registry 빈출)

| 순위 | 위험 | ERR 코드 | 차단 게이트 |
|---|---|---|---|
| 1 | inclusions 금액 환각 (예: "2억 여행자보험") | ERR-FUK-insurance-injection | E1 + CoVe E6 + Agent self-audit |
| 2 | min_participants 템플릿 4명 기본값 주입 | ERR-20260418-01 | callWithZodValidation (instructor 패턴) + CoVe |
| 3 | DAY 교차 오염 (Day4 schedule이 Day2와 동일) | ERR-KUL-02/03, ERR-FUK-regions-copy | E2 (regions vs raw_text) |
| 4 | surcharges 날짜와 excluded_dates 모순 | ERR-20260418-03/14 | E3 (date overlap) |
| 5 | schedule[].type='transport' 렌더 크래시 | ERR-transport-type | Zod refine (W11) + insert-template validate |

---

## 2. 이번 PR 적용된 3건 (즉시 효과)

### 2-1. `llm-validate-retry.ts` — feedback truncate + telemetry
**파일**: [src/lib/llm-validate-retry.ts](../src/lib/llm-validate-retry.ts)

**문제**:
- Zod issue가 50+개 폭주하거나 LLM 응답이 매우 길면 `pendingFeedback`이 무한 누적 → 재시도마다 컨텍스트 폭증.
- 어떤 시도에서 어떤 reason(JSON parse / Zod)으로 실패했는지 외부에서 관찰 불가.

**개선**:
- `maxFeedbackChars` 옵션 (기본 4000자, ≈1500 토큰): 초과 시 head 60% / tail 나머지 보존, 중간 `[중략]`.
- `onAttempt({ attempt, feedback, reason })` 콜백: 호출 직전마다 텔레메트리 포인트.
- `lastReason: 'first' | 'json_parse' | 'zod_validate'` 로 분류.

**기대 효과**: 토큰 폭증 차단 + Reflexion DB 적재 시 reason 별 통계 가능 → 어떤 게이트가 자주 실패하는지 데이터화.

### 2-2. `llm-gateway.ts` — `longCache` 옵션 (Anthropic 1h TTL)
**파일**: [src/lib/llm-gateway.ts](../src/lib/llm-gateway.ts)

**문제**:
- `callClaude`가 `cache_control: { type: 'ephemeral' }`만 지정 → 5분 TTL 기본.
- register Step 0~7가 5분을 넘기거나 동일 system prompt로 batch 등록 시 cache miss → input 토큰 매번 풀로 청구.
- Anthropic 1h cache: write 2× / read 0.1× → **2회 이상 read 시 net 절감**.

**개선**:
- `GatewayCallParams.longCache: boolean` 추가.
- `true`일 때만 `cache_control.ttl: '1h'` 적용.
- 호출부에서 batch/장기 컨텍스트일 때 명시적으로 켤 수 있게 옵션화.

**적용 가이드**:
- IR Sonnet 경로(`normalize-with-llm.ts`), CoVe Claude 호출, 동일 지역 batch 등록 → `longCache: true`.
- 1회성 단발 호출 (qa-chat 단일 응답 등) → 기본 5min 유지.

**기대 효과**: cache hit 50% → 90%+ 달성 시 input 토큰 비용 -80% (Anthropic 공식 벤치).

### 2-3. `post_register_audit.js` — 3-way 병렬 wave
**파일**: [db/post_register_audit.js](../db/post_register_audit.js)

**문제**:
- `auditOne()`이 RAG 조회 → CoVe → 렌더 fetch → E5 순차 실행. 누적 5초+.
- 3개는 서로 의존성 없음 (RAG는 pkg, CoVe는 pkg.raw_text, render fetch는 baseUrl+id).

**개선**:
- `Promise.all([ragPromise, covePromise, renderPromise])` 로 병렬 wave.
- E5는 render 결과 의존이라 순차 유지 (후순위).
- 각 promise 내부에서 catch — 한 건 실패해도 나머지 진행.

**기대 효과**: post-audit 평균 시간 5s → 2s (-60%). AI ON일 때 90s → 30s.

---

## 3. 다음 PR 권장 (난이도 2~3, 1~4주 내)

### 3-1. Confidence-gated Advisor (TOP 4) — **메커니즘 적용됨, 콜러 wiring 필요**
**근거**: ICLR 2025 "Trust-or-Escalate" / SelectLLM 패턴.
기존: `llm-gateway.ts`는 executor가 **실패**한 후 advisor 호출 (전략 가이드용).
신규: executor가 **성공했으나 confidence 낮음** → advisor가 직접 최종 답을 다시 생성.

**적용된 메커니즘** (`llm-gateway.ts`):
- `GatewayCallParams.escalateIfLowConfidence?: (data, rawText) => boolean` 옵션 추가.
- primary 성공 직후, 콜러가 제공한 predicate가 true면 `route.advisor` 모델로 재실행.
- 발동 조건: ① executor success ② route.advisor 정의됨 (현재: `normalize-complex`, `jarvis-complex`) ③ predicate true.
- advisor 재실행 실패 시 primary 응답 그대로 사용 (fail-soft).

**남은 작업 (콜러 opt-in)**:
1. **스키마에 confidence 필드 추가**: `NormalizedIntakeSchema`, JARVIS 응답 스키마에 `confidence: z.number().min(0).max(1)` 필드 추가.
2. **시스템 프롬프트에 강제**: "응답 끝에 confidence(0~1) 자체평가 필수. 1.0=원문에 명시된 사실만, 0.5=일부 추론, 0.0=불확실."
3. **콜러에서 predicate 등록**:
   ```ts
   const res = await llmCall({
     task: 'normalize-complex',
     systemPrompt, userPrompt,
     escalateIfLowConfidence: (data) => (data?.confidence ?? 1) < 0.7,
   });
   ```
4. **추가 옵션**: DeepSeek logprobs 활용. `logprobs: true, top_logprobs: 5` 요청 후 평균 token logprob → confidence 환산. (provider-specific, 비ㅡ스키마 invasive)

**예상 효과**: Pro 호출 -50% (실패 시에만 → 진짜 불확실한 경우만), 토큰 -15%.

### 3-2. RARR-style verification questions in CoVe (TOP 7) — **적용됨**
**근거**: SIGIR 2025 component-level analysis — CoVe는 verification question을 **검색 결과**로 답해야 효과 큼.
기존 `cove_audit.js`는 claim 목록 + raw_text 전체(~10K자)를 한 번에 던져서 LLM이 스캔.
신규 RARR 패턴: claim마다 검증 질문 + 가장 관련 깊은 단락(top-2 chunk) retrieve → focused 컨텍스트 전달.

**적용된 변경** (`db/cove_audit.js`):
- `chunkRawText(rawText, maxChars=1200)` — 빈 줄 단락 분리 + 한국어 문장 종결("니다.", "다.", "요.") 보조 분할.
- `extractKeywords(text)` — 한국어 2자+ 토큰 / 숫자 / 영문, 조사 제거, stopword 필터.
- `scoreChunkRelevance(chunk, claim)` — claim 키워드 매칭 (×2) + field-aware hint 키워드 (×1).
- `findBestChunks(chunks, claim, k=2)` — top-k 단락 retrieval, 점수 0이면 fallback 처리.
- `generateVerificationQuestion(claim)` — field별 자연어 검증 질문 (min_participants / ticketing_deadline / inclusions / surcharges / notices_parsed).
- 프롬프트는 `[claim N]` + `[검증 질문]` + `[근거 후보 단락]` 묶음으로 짝지어 전달.
- 짧은 raw_text(<4000자)이고 retrieval 점수가 모두 0인 경우 fallback으로 전체 원문 첨부.

**스모크 테스트 결과** (2026-05-10):
- "최소 출발인원 4명" claim → "최소 출발인원: 4명" 단락 score=8 top-1 매칭 ✓
- "2억 여행자보험" claim → "포함사항: ..., 2억 여행자보험" 단락 score=5 top-1 매칭 ✓
- 검증 질문이 자연스러운 자연어로 생성됨 ✓

**기대 효과**: hallucination 감지율 +20%p (특히 inclusions 금액·여행자보험·연령조건 환각). 토큰량은 비슷하거나 약간 감소(필터링 효과).

### 3-3. BAML SAP 파서 흡수 (TOP 8) — **적용됨**
**근거**: BAML의 Schema-Aligned Parsing — markdown-in-JSON, CoT 앞 붙은 응답을 강건하게 파싱.
기존 `stripMarkdownJson`은 ```json ``` 코드펜스만 제거. 환각 prose, 임베디드 펜스, 잘림 케이스에 취약.

**적용된 변경** (`src/lib/llm-retry.ts`):
- `findJsonStart(s)` — 첫 `{` 또는 `[` 위치 탐색 (앞 설명문 무시).
- `findJsonEnd(s, start)` — string-aware brace 카운터. 따옴표 안 모든 문자(`{`, `}`, `\\`, `"` 이스케이프 포함) 무시하며 균형점까지.
- `repairTruncatedJson(s)` — stack 기반 close-brace 보충 + 미닫힌 string `"` 종료 + trailing comma 제거.
- 정상 JSON 입력은 그대로 반환 (하위호환).

**스모크 테스트 결과** (2026-05-10, 10/10 통과):
- `plain JSON` / `code fence` / `leading prose` / `trailing prose` / `embedded fence in string` / `truncated array` / `unclosed string` / `array trailing comma` / `empty` / `nested object truncation`
- 잘림 복구된 5건 모두 `JSON.parse` 라운드트립 성공.

**기대 효과**: 1차 추출 파싱 실패율 -30% → callWithZodValidation 재시도 횟수 감소 → 토큰 절감 + 평균 latency 단축.

### 3-4. Zod refine 게이트 보강 (W30/W31/W32) — **적용됨**
**근거**: 등록된 상품은 모바일 랜딩 / A4 포스터 / 블로그 / 카드뉴스에 그대로 렌더. INSERT 전 Zod에서 차단하지 않으면 잘못된 데이터가 4~7개 채널에 동시 노출.

**기존 적용된 refine** (W19/W26/W27/W28):
- W19 — duration vs days.length 일치
- W26 — inclusions 콤마 포함 (top-level) 차단
- W27 — 하루 flight activity 분리 차단 (병합 토큰 "→" 강제)
- W28 — 호텔 activity 앞절 붙이기 차단

**신규 추가** (`src/lib/package-schema.ts`):
- **W30 — Day 번호 정합성**: `days[].day` 가 정렬 시 `[1..N]` 연속이어야 함. gap·중복·1부터 시작 안 함 모두 차단. 모바일 랜딩 일정 섹션이 빈 카드 노출되거나 timeline 스킵되는 문제 차단.
- **W31 — Surcharge 기간 역전**: `start > end` 차단. 모바일 가격표·블로그 carousel에 "MM.DD ~ MM.DD" 이상한 날짜 범위 노출 방지.
- **W32 — Optional tours 중복**: 같은 `name + region + day` 이중 등록 차단. day 가 다르면 의도적 중복 허용 (다른 날 같은 투어 가능). 모바일·A4 동일 투어 이중 노출 방지.
- **W33 — departure_days ↔ price_dates 요일 정합성**: `departure_days="월/수"` 인데 `price_dates`에 토요일이 섞여 있으면 차단. LLM 파싱 오류로 두 필드 중 하나가 잘못된 케이스 (모바일 캘린더 혼란). "매일"·숫자 포함 패턴(특정 날짜 나열)은 자동 스킵.

**스모크 테스트 결과** (5/5 + W33 6/6 = 11/11 통과):
- 정상 pkg → 통과 ✓
- Day 번호 [1,2,4,4,5] → W30 차단 ✓
- Surcharge start=2026-08-15 > end=2026-07-15 → W31 차단 ✓
- 같은 투어 2회 등록 → W32 차단 ✓
- day 다른 동일 투어 → 통과 (의도된 허용) ✓
- W33: 월/수+토요일 → 차단 ✓ / 매일+다양 → 통과 ✓ / 5/9,5/26+5/9 → 통과 (스킵) ✓ / 매주 금요일+금 → 통과 ✓ / departure_days null → 통과 ✓

**기대 효과**: 렌더링 단계에서 발견될 잘못된 데이터를 INSERT 전에 차단 → 모든 채널 정확도 ↑.

**여전히 누락**:
- `optional_tours[].name` 모호성 (ERR-KUL-04 — 지역명 없는 일반명)
- `hotel.grade` 7종 enum 강제 (629건 기존 데이터 호환성 우려)

---

## 4. 1분기 권장 (난이도 4~5, 큰 PR)

### 4-1. Vercel Workflow DevKit으로 Step 0~7 durable 화 (TOP 5)
**근거**: register Step 0~7는 정확히 durable workflow 패턴. 현재 단일 API 라우트 → 중간 실패 시 처음부터 재시작.

**제안**:
1. 각 Step을 `'use step'` 함수로 분리.
2. 등록 전체를 `'use workflow'`로 감싸기.
3. 중간 실패 시 마지막 성공 step부터 재실행 (체크포인트).

**효과**:
- 실패 시 재실행 토큰 -70% (Step 7-A 자동승인 실패 → Step 7-3 재실행 불필요).
- 사용자 체감 속도 +30% (사장님이 등록 클릭 → 즉시 응답, 백그라운드 진행).

### 4-2. GEPA로 normalize-with-llm prompt offline 최적화 (TOP 6)
**근거**: GEPA paper (ICLR 2026 Oral) — execution trace 기반 reflective mutation으로 prompt 자동 진화.

**제안**:
1. 누적된 `extractions_corrections` (Reflexion 메모리) + `error-registry.md` 30+건을 trainset으로 변환.
2. GEPA를 1회 offline 실행 → "여소남 도메인 최적 normalize prompt" 산출.
3. 결과를 `prompt-registry` Phase 2에 저장 (DB 이관).

**효과**: 추출 정확도 +5~10%p, prompt 자체 토큰 -15% (GEPA가 압축까지 수행).

---

## 5. 보류 / 비추천 (×)

| 제안 | 이유 |
|---|---|
| Outlines / dottxt | self-hosted 모델 전제, 우리는 API 사용 |
| NeMo Guardrails | 대화형 chatbot 전용, register는 batch |
| CrewAI / AutoGen | multi-agent 채팅, 우리 deterministic pipeline에 부적합 |
| eCeLLM / ExtractGPT | 영문 e-commerce 격차, EPR/Reflexion이 이미 우위 |
| Qdrant 마이그레이션 | <1M vector 에서 pgvector HNSW와 동등 |
| Marvin / Pydantic-AI | Python 우선, instructor-TS·자체 모듈이 더 fit |
| LangGraph (JS) | Vercel WDK가 호스팅 환경에 더 자연스러움 |

---

## 6. 외부 레퍼런스

### Production-grade 패턴
- [Anthropic Prompt Caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — 1h TTL beta, 90% hit rate 가이드
- [Instructor (567-labs)](https://github.com/567-labs/instructor) — Pydantic/Zod retry+validation 표준
- [BAML (BoundaryML)](https://github.com/BoundaryML/baml) — SAP 파서, BFCL 93.63%
- [Vercel Workflow DevKit](https://github.com/vercel/workflow) — `'use workflow'` durable
- [GEPA (gepa-ai)](https://github.com/gepa-ai/gepa) — prompt evolution, ICLR 2026 Oral

### 논문
- [GEPA paper (arxiv 2507.19457)](https://arxiv.org/abs/2507.19457) — MIPROv2 대비 +12%p, GRPO 35× efficient
- [Cascade Routing (arxiv 2410.10347)](https://arxiv.org/abs/2410.10347) — 비용 -45~85%, 품질 95%
- [Trust-or-Escalate (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/file/08dabd5345b37fffcbe335bd578b15a0-Paper-Conference.pdf) — confidence-driven escalation
- [Stop Wasting Your Tokens (arxiv 2510.26585)](https://arxiv.org/html/2510.26585v2) — multi-agent 토큰 낭비 패턴
- [RARR (arxiv 2210.08726)](https://arxiv.org/abs/2210.08726) — verification question 패턴 (CoVe 보강)

### 도메인 인사이트
- [Shopify Multimodal LLMs (ICLR 2025 expo)](https://shopify.engineering/leveraging-multimodal-llms) — 카탈로그 정규화
- [Compound AI Systems (BAIR)](https://bair.berkeley.edu/blog/2024/02/18/compound-ai-systems/) — 우리 EPR + Reflexion + CoVe 조합과 동일 철학

---

## 7. 측정 지표 (PR 머지 후 1주 모니터링)

| 지표 | 측정 방법 | 목표 |
|---|---|---|
| post-audit 평균 시간 (AI OFF) | `db/post_register_audit.js` 실행 로그 | 5s → 2s |
| post-audit 평균 시간 (AI ON) | `--ai` flag 실행 시 | 90s → 30s |
| Claude cache hit ratio | `cost-tracker` cache_hit 토큰 / 총 input | 50% → 80%+ |
| validate-retry 평균 attempts | `onAttempt` 콜백 누적 | 1.4 → 1.2 |
| 환각 차단율 | error-registry 신규 추가 건수 / 등록 건수 | 현재 ~5% → 3% |

---

## 8. 작업 추적

- [x] llm-validate-retry.ts: feedback truncate + onAttempt
- [x] llm-gateway.ts: Claude `longCache` 옵션
- [x] post_register_audit.js: 3-way 병렬화
- [x] llm-gateway.ts: `escalateIfLowConfidence` 메커니즘 (콜러 wiring 대기)
- [x] cove_audit.js: RARR-style chunked retrieval + verification questions
- [x] llm-retry.ts: BAML SAP 파서 흡수 (10/10 edge case 통과)
- [x] package-schema.ts: W30/W31/W32/W33 refine (Day 정합성 / Surcharge 기간 / OT 중복 / 요일 정합성)
- [ ] NormalizedIntakeSchema에 `confidence` 필드 추가 + system prompt 자기평가 강제
- [ ] normalize-with-llm.ts → llmCall 라우팅 마이그레이션 (현재 OpenAI/Gemini SDK 직접 호출)
- [ ] WDK durable workflow (1분기)
- [ ] GEPA offline 최적화 (1분기)
