# 2026-07-09 Blog Writing Engine Research

This is an evidence audit, not the current contract. The current operating contract remains `docs/blog-autopublish-contract.md`.

## Executive Finding

Yeosonam's blog engine has moved in the right direction: information posts and product-backed commercial posts are now separated, 100-point category gates exist, and final customer-surface repair blocks many visible AI artifacts.

The remaining risk is not "one bad prompt." The remaining risk is whether every generated post sounds like a customer-facing travel consultant instead of a generic SEO article. The next strengthening layer should measure customer anxiety resolution, product evidence completeness, and repeated phrase drift across the whole fleet.

## Research Baseline

Sources reviewed:

- Google Search Central, creating helpful, reliable, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Search Central, AI-generated content guidance: https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
- Nielsen Norman Group, product descriptions: https://www.nngroup.com/articles/product-descriptions/
- Nielsen Norman Group, ecommerce product pages: https://www.nngroup.com/articles/ecommerce-product-pages/
- Nielsen Norman Group, F-pattern/web reading: https://www.nngroup.com/videos/f-pattern-reading-digital-content/
- Tripstore travel blog examples: https://www.tripstore.kr/blog/
- MyRealTrip offer detail examples: https://www.myrealtrip.com/offers/
- Triple travel guide examples: https://triple.guide/articles/
- Promptfoo: https://github.com/promptfoo/promptfoo
- DeepEval: https://github.com/confident-ai/deepeval
- Langfuse: https://github.com/langfuse/langfuse
- RAGAS / LLM evaluation ecosystem references: https://docs.ragas.io/

## Competitor Pattern Summary

| Source | Strong Pattern | Weak Pattern To Avoid | Yeosonam Takeaway |
|---|---|---|---|
| Tripstore blog | Answer-first openings, family/parent scenario framing, concrete budget and movement tables | CTA can become strong near the end | Use "situation-first" and comparison tables, keep CTA soft for info posts |
| Triple guides | Simple checklist language, scannable steps, practical item lists | Less product conversion intent | Use checklist clarity for preparation/weather/visa topics |
| MyRealTrip offers | Product facts, warnings, how-to-use, conditions, cancellation/notice blocks | Supplier copy can be noisy and sales-heavy | Product posts must convert supplier facts into decision help, not paste ad copy |
| Lonely Planet / CN Traveler style | Editorial confidence, place-specific judgment, timing/risk nuance | Not optimized for package conversion | Borrow calm authority, not magazine flourish |
| Newsletters | Human voice, specific reader situation, concise framing | Hard to scale factual consistency | Use controlled human tone with evidence gates |

## Current Engine Score

Score is customer-perceived quality, not test coverage.

| Area | Score | Why |
|---|---:|---|
| Information post structure | 86/100 | Answer-first, official-source requirement, table/checklist repair, and bottom CTA are implemented. Needs more situation-specific phrasing beyond template answers. |
| Product post structure | 82/100 | Product consultant writer, product DB-only facts, included/excluded, fit/not-fit, risk notes, and consult questions exist. Source product rows still need stronger open-contract quality. |
| Customer language / tone | 78/100 | Banned cliches and chatty intros are blocked. Still needs cross-post phrase drift detection and more "customer says it this way" vocabulary. |
| Evidence and faithfulness | 88/100 | Product DB evidence and official source logic are wired. Needs stronger source freshness checks for weather/visa/fees and source citations at paragraph level. |
| Render/readability | 90/100 | Markdown table integrity, final surface repair, broken CTA residue, and image repair are covered. Browser-level audits should stay mandatory after renderer changes. |
| Fleet-level autopublish quality | 84/100 | Publishable queue, duplicate detection, generated canary, and diagnostics are stronger. Historical missed-day and timeout evidence should be separated from active health. |
| Conversion fit | 81/100 | Product posts now help pre-inquiry decisions. Info posts should build trust first and only softly route to "my itinerary 기준 확인." |

Overall current practical score: **84/100** after the latest hardening. The earlier public examples looked closer to **65-72/100** because of duplicated blocks, pseudo-tables, generic wording, and empty CTA residue.

## Main Weaknesses Found Across The Session

1. **Template completeness was mistaken for article quality.**  
   Old posts could have headings, FAQ, hashtags, SEO metadata, and still feel AI-written because the opening did not answer a real reader task.

2. **Information and product writing were previously blended.**  
   Weather/checklist articles drifted into sales language, while product posts did not always help customers decide before inquiry.

3. **Public render was not always treated as truth.**  
   Markdown that looked acceptable in storage could render as broken pseudo-tables or duplicated late blocks.

4. **Weak product source data blocks strong commercial writing.**  
   If registered products are pending review or missing included/excluded/risk details, the product writer should not invent. It must either hold, request source repair, or produce a conservative consult post only when the open contract passes.

5. **Fleet-level repetition needs a stronger memory.**  
   Single-post gates catch "안녕하세요" or hard CTA, but the system still needs rolling detection for repeated first-sentence templates, repeated section order, and repeated CTA wording across the last 30-100 posts.

## Recommended 100-Point Writing Contract

Information post:

- Open within 120-180 Korean characters with the answer or decision rule.
- Use the customer's language: "아이랑 가도 괜찮나", "부모님 이동 힘들까", "비 오면 일정 망치나", "현지에서 얼마 더 쓰나".
- Include one useful scan object only when needed: comparison table, checklist, or step list.
- Include risks and official checks for changeable topics.
- Put Yeosonam CTA once near the bottom, phrased as "내 일정 기준으로 확인" rather than "예약/상품 보기".

Product-backed commercial post:

- Open with at least two concrete facts: price, departure city, duration, fit-for customer, or variable to verify.
- Separate "included" and "not included" visibly.
- Explain itinerary feel: movement load, free time, family/parent suitability, shopping/optional-tour caveats when present.
- Include "fits / does not fit" to create trust.
- Include "questions before inquiry" so the customer can contact with the right facts.
- Never add hotel names, benefits, scarcity, confirmed schedule, or discount language outside the registered product evidence.

## Best Open-Source / MCP-Like Tools To Consider

| Tool / Pattern | Fit | Score | Use For Yeosonam |
|---|---:|---:|---|
| Promptfoo | High | 92 | Prompt regression tests for info/product prompts, competitor-style golden cases, CI summaries |
| DeepEval | High | 88 | LLM-as-judge checks for task completion, hallucination, answer relevancy, naturalness |
| RAGAS-style metrics | Medium-high | 84 | Faithfulness/source-support checks when evidence retrieval becomes richer |
| Langfuse | Medium-high | 86 | Trace prompt version, model, evidence, repair attempts, final score per article |
| Phoenix / OpenInference | Medium | 78 | Later-stage trace analysis if generation pipeline becomes multi-agent |
| OpenTelemetry trace IDs | High | 90 | Already aligned with ops goal: one trace from candidate to publish to indexing |
| Great Expectations-style data checks | High | 89 | Product source/open-contract validation before commercial writing |
| IndexNow batch/outbox pattern | High | 90 | Already aligned; keep durable indexing separate from publishing |
| Browser render audit | High | 94 | Final public truth for table, highlight, CTA, layout, mobile readability |

Recommended adoption order:

1. Keep current Vitest deterministic gates as the primary blocker.
2. Add Promptfoo-style golden prompt regression only after the prompt corpus stabilizes.
3. Add Langfuse or a light internal trace table when cost/latency/prompt version analysis becomes hard in SQL alone.
4. Do not introduce a heavy workflow engine yet. The current problem is quality contracts and source data, not orchestration complexity.

## What Has Already Been Reflected In Code

- Writer split: `info_writer` and `product_consultant_writer`.
- Product prompt versioning and product DB-only generation.
- Product structures: price/departure/duration opening, included/excluded, fit/not-fit, risk notes, consult questions.
- Information structures: answer-first, official-source requirement, bottom soft CTA.
- Customer-quality gates: AI-like opening, early sales pressure, unsupported internal data, product evidence omission, empty CTA residue, chatty intro residue, destination-generic residue.
- Final customer-surface repair: removes empty CTA residue and chatty info intros before publish/backfill evaluation.
- Engine category scorecard: reader task, customer language, naturalness, evidence/faithfulness, sales pressure, product decision helpfulness.

## Remaining Priority Backlog

| Priority | Work | Why |
|---|---|---|
| P0 | Separate active health from historical missed-day evidence in diagnostics | Operators should see current publishability clearly without hiding true past incidents |
| P0 | Product source open-contract repair path | Commercial posts cannot be truly strong while registered products are pending or missing customer-facing facts |
| P1 | Rolling phrase drift detector across last 30-100 posts | Stops fleet-level AI smell even when each single post barely passes. First canary-level version implemented in `src/lib/blog-fleet-phrase-drift.ts`; next expansion should run it over 30-100 live posts. |
| P1 | Source freshness / paragraph evidence map for weather, visa, fees, transport | Reduces risky outdated info and improves trust |
| P1 | Prompt regression golden set from Tripstore/Triple/MyRealTrip-style cases | Prevents prompt changes from reintroducing generic SEO tone |
| P2 | Langfuse or internal LLM trace dashboard | Useful after volume increases or when model/prompt cost must be compared |

## 2026-07-09 Deep-Dive Addendum

This addendum compares the current Yeosonam engine against the session evidence, provided information/commercial master prompts, travel-service examples, and open-source AI quality tooling. The score below is not "does the test suite pass"; it is "would a customer feel helped, trust the content, and know the next action."

### Current Verification Snapshot

- Recent 16-post audit: `changed=0`, `qualityGateFailed=0`, `publishBlocked=0`, `engineCategoryScorecard.averageScore=100`.
- Current-day publish diagnosis: current KST day reached `4/4`, publishable candidate inventory is `15`, and active failure buckets are empty.
- Generated canary quality: `requested=4`, `checked_count=4`, `pass_count=4`, and `fleet_phrase_drift.status=pass` after adding the phrase-drift evaluator.
- Low-time quota recovery: publisher queue ordering now puts deterministic fallback-eligible information rows ahead of product/card/pillar rows when full generation is no longer safe but fast fallback can still run.
- Historical risk remains: the previous closed KST day missed `0/4`, with timeout and quality-repair failures in old publisher logs.
- Product-backed queue risk remains: 34 product rows are still blocked because their linked products are `pending_review`, so commercial posts cannot safely rely on them yet.

### Competitor / Reference Benchmark

| Reference | What Works | What Yeosonam Should Copy | What Yeosonam Should Avoid |
|---|---|---|---|
| Triple travel guides | Short checklist language, useful scan blocks, practical "before departure" framing | Mobile-first checklist and plain customer wording | Weak conversion path if copied directly |
| MyRealTrip product pages | Clear product facts, included/excluded, meeting point, notices, cancellation/condition sections | Decision support from facts, not ad copy | Supplier-copy clutter and overlong warning dumps |
| Tripstore-style package blog | Search-friendly family/budget framing and scenario tables | Situation-first openings such as family, parents, rainy-day, first-timer | Repeated SEO title formulas and hard CTA drift |
| Conde Nast Traveler / Lonely Planet | Editorial confidence, timing nuance, risk/context, expert/local voice | Calm authority and source-backed judgment | Magazine flourishes that do not help package conversion |
| Travel newsletters | Human voice, specific reader anxieties, concise framing | Natural "you probably worry about X" transitions | Subjective claims that are hard to verify at scale |
| Google people-first guidance | Content should be created to help people, with reliable evidence | Every post needs a reader task and trust evidence | Search-engine-first templating |
| NN/g web/product UX | Users scan; product content must answer questions and enable comparison | Answer first, table/checklist, included/excluded, fit/not-fit | Fluffy copy, vague benefits, buried essentials |

### Provided Prompt Analysis

Information master prompt:

- Strong to adopt: answer-first opening, risk-level thinking, no invented numbers, task-type classification, mobile scan structure, official-condition caution.
- Use selectively: `ㅁ 항목명` is good for Naver-copy style but not for our public Markdown renderer, where real tables/checklists must remain valid.
- Do not adopt as-is: fixed greeting, no URL policy, Markdown ban, and 7-9 heading target conflict with Yeosonam site publishing, official-source links, and render integrity gates.

Commercial master prompt:

- Strong to adopt: source-only facts, customer-private info removal, 40-60s mobile readability, hidden-cost transparency, included/excluded, shopping/optional-tour/room-condition visibility, banned hype terms.
- Use selectively: 60-70% polite casual tone can improve warmth, but the engine should not force every post into Naver copy style.
- Do not adopt as-is: Markdown/table ban conflicts with our public blog table contract; fixed greeting and title formulas can become fleet-level AI smell.

### Current Yeosonam Scorecard

| Dimension | Score | Assessment |
|---|---:|---|
| Information intent completion | 88 | Good answer-first and official-source logic. Needs richer "customer anxiety" variants beyond generic cost/movement phrasing. |
| Information tone / naturalness | 80 | Cliches, chatty intro, and empty CTA residue are blocked. Needs rolling phrase-drift checks across many posts. |
| Information render quality | 91 | Table/render/final-surface repair is strong. Browser/mobile render sampling should remain mandatory after renderer changes. |
| Commercial product evidence | 76 | Writer is DB-only and structurally right, but many linked products are not customer-open, so real commercial coverage is constrained. |
| Commercial decision usefulness | 84 | Price/departure/duration, included/excluded, fit/not-fit, risks, consult questions are present. Needs stronger itinerary-feel and hidden-cost extraction from product source. |
| Customer trust / no overclaiming | 86 | Unsupported internal data and invented product facts are blocked. Paragraph-level evidence mapping is still missing. |
| Fleet-level anti-AI smell | 74 | Single-post checks pass, but repeated openings, repeated section order, and repeated CTA wording across 30-100 posts are not yet fully measured. |
| Autopublish resilience | 85 | Current day is healthy and candidate inventory exists. Historical timeout/missed-day proves the fallback/recovery loop still needs hardening. |
| Indexing/outbox discipline | 90 | Durable indexing outbox is aligned with best practice. Continue keeping indexing separate from publish success. |

Overall practical score: **84/100**. The engine is much stronger than the broken public examples from earlier in the session, but it is not yet a "100-point automatic editorial desk." The largest gap is fleet-level naturalness plus product-open evidence, not another single prompt rewrite.

### Best-Fit Open Source / MCP Adoption

| Tool / Pattern | Fit | Score | Adoption |
|---|---:|---:|---|
| Promptfoo | Very high | 93 | Add a golden prompt regression suite for info/product prompts and run it in CI when writer prompts change. |
| RAGAS metrics | High for evidence posts | 86 | Borrow faithfulness, answer relevancy, and context precision concepts for official-source/product-source checks. |
| DeepEval | High | 87 | Add LLM-as-judge only for subjective dimensions such as naturalness and task completion; keep deterministic gates as primary blockers. |
| Langfuse | Medium-high | 84 | Add later if SQL/generation_meta cannot answer prompt-version, cost, and model-quality questions. |
| Phoenix / OpenInference | Medium | 78 | Useful later for multi-step trace debugging; currently heavier than needed. |
| Great Expectations pattern | Very high | 90 | Keep using data-quality contracts for product source, candidate queue, and indexing outbox. |
| Browser render audit | Very high | 95 | Public page is the source of truth for broken tables, highlight residue, duplicated blocks, and mobile readability. |
| MCP documentation/search tools | Medium | 75 | Useful for current docs and tool discovery, but not a substitute for our own product/source evidence gates. |

### 20+ Adoption Scorecard For Yeosonam

Scoring 기준은 "우리 블로그가 검색 유입 → 신뢰 형성 → 상품/상담 전환을 안정적으로 만들 수 있는가"다. 단순히 유명한 도구가 아니라, 현재 코드와 사업 구조에 바로 맞는지로 평가했다.

| Rank | Process / Tool | Score | Fit | Why it matters for Yeosonam | Adoption decision |
|---:|---|---:|---|---|---|
| 1 | Browser public-render audit | 95 | Very high | 실제 고객 화면에서 표, CTA, 형광펜, 중복 블록, 모바일 문단 벽을 잡는다. | Keep as mandatory after every renderer/prompt repair. |
| 2 | Promptfoo golden prompt regression | 93 | Very high | 정보성/상품성 프롬프트 변경이 AI티나 구조 퇴행을 만들었는지 CI에서 비교한다. | Add 20 golden cases after current prompt corpus stabilizes. |
| 3 | Product open-contract data checks | 92 | Very high | 상품글은 등록 상품 기준이어야 하므로 pending_review, 누락 포함/불포함, 가격 근거를 먼저 막아야 한다. | Already partly built; expand source repair workflow. |
| 4 | Great Expectations-style source validation | 90 | Very high | 후보, 상품 DB, 색인 outbox를 "발행 가능한 데이터"로 검증한다. | Keep internal implementation; no external dependency needed now. |
| 5 | OpenTelemetry-style trace id | 90 | High | 후보 생성부터 발행, 수리, 색인까지 한 글의 생애를 추적한다. | Add to generation_meta/cron logs if not complete. |
| 6 | IndexNow durable outbox pattern | 90 | High | 발행과 색인을 분리하고 재시도 가능하게 만든다. | Already aligned; keep coverage at 100%. |
| 7 | DeepEval-style LLM-as-judge | 87 | High | 자연스러움, 고객 언어, 실제 도움됨은 정규식만으로 한계가 있다. | Add later for subjective judge, not as only blocker. |
| 8 | RAGAS-style faithfulness metrics | 86 | High | 공식자료/상품 DB 근거와 본문 claim의 일치도를 점수화한다. | Borrow metrics first; package later optional. |
| 9 | Langfuse | 84 | Medium-high | prompt version, model, latency, repair attempts, score 변화를 한 화면에서 볼 수 있다. | Defer until SQL/generation_meta view is insufficient. |
| 10 | Self-RAG retrieve-generate-critique loop | 84 | Medium-high | 정보성 글에서 공식자료가 필요한지 스스로 판단하고 근거를 비평한다. | Borrow pattern for evidence-first brief. |
| 11 | CRAG retrieval evaluator | 83 | Medium-high | 검색/공식자료가 약할 때 잘못된 근거로 쓰지 않고 보류나 재검색으로 돌린다. | Add lightweight evidence confidence score. |
| 12 | Fleet phrase-drift detector | 82 | Very high | 한 글은 통과해도 30개가 같은 말투면 AI티가 난다. | Expand from canary to last 30-100 published posts. |
| 13 | Paragraph-level evidence map | 82 | High | 날씨, 비자, 요금, 상품 조건 문장마다 근거 출처를 연결한다. | Next P1 hardening. |
| 14 | Firecrawl MCP | 80 | Medium-high | 경쟁 블로그, 여행기사, 공식 페이지를 구조화해서 수집할 수 있다. | Use for research/backfill, not live publish dependency. |
| 15 | Playwright MCP / CLI | 80 | Medium-high | 공개 블로그 화면의 실제 접근성/렌더 상태를 자동 점검한다. | Keep local browser audit; MCP useful for exploratory QA. |
| 16 | Phoenix / OpenInference | 78 | Medium | 복잡한 다단계 생성 추적에는 좋지만 지금은 다소 무겁다. | Defer. |
| 17 | Model Context Protocol reference servers | 76 | Medium | 도구 연결 표준으로 좋지만 운영 품질을 대신 보장하지 않는다. | Use selectively for research/tooling. |
| 18 | Browserbase / Stagehand MCP | 75 | Medium | 실제 브라우저 자동 탐색에는 좋지만 비용과 외부 의존성이 생긴다. | Consider only for remote continuous QA. |
| 19 | Search intent crawler from SERP/Suggest | 75 | Medium-high | "고객이 실제로 묻는 말"을 후보와 첫 문단에 반영한다. | Keep free fallback; add paid/provider only if ROI clear. |
| 20 | Golden competitor corpus | 74 | High | 트립스토어, 트리플, 마이리얼트립, 여행기사의 좋은 구조를 회귀 기준으로 삼는다. | Build as local fixtures, not copied text. |
| 21 | Human editorial sample panel | 73 | Medium-high | AI티, 상담 자연스러움, 신뢰감은 초기에는 사람 점수표가 필요하다. | Add monthly 10-post spot review. |
| 22 | LangSmith-style dataset/eval loop | 72 | Medium | 데이터셋 기반 평가 흐름은 좋지만 Langfuse/Promptfoo와 역할이 겹친다. | Defer unless LangChain stack grows. |
| 23 | LlamaIndex eval patterns | 72 | Medium | RAG 기반 근거 평가에 참고할 수 있다. | Borrow concepts only. |
| 24 | CrewAI/LangGraph workflow agents | 64 | Low-medium | 오케스트레이션보다 현재는 품질계약과 상품 근거가 더 급하다. | Do not add now. |
| 25 | Temporal / durable workflow engine | 60 | Low-medium | 대규모 워크플로우에는 좋지만 지금 문제는 글 품질과 소스 검증이다. | Defer until traffic/volume requires it. |

### Customer-Language Weakness Matrix

| Weakness | Info post risk | Product post risk | Current coverage | Needed hardening |
|---|---|---|---|---|
| Generic SEO opening | "비용, 이동, 현지 조건" 같은 만능 첫 문단 | 상품명이 아닌 추상 설명으로 시작 | `weak_answer_first`, final surface repair | Add more customer-anxiety lead templates by topic. |
| Overbuilt structure | 요약, FAQ, 공식링크, 상황표가 반복되어 글이 기계적으로 보임 | 10초 판단, FAQ, CTA가 같은 순서로 반복 | structure and naturalness gates | Last 30-100 post section-order drift. |
| Sales pressure mismatch | 정보성 상단에 상품/상담 CTA가 나오면 신뢰 저하 | 너무 강한 예약 압박은 과장 광고처럼 보임 | early CTA and sales_pressure gates | CTA wording diversity and bottom-only proof. |
| Unsupported authority | "여소남 데이터"를 근거 없이 쓰면 신뢰 하락 | 운영팀 검증 문구가 상품 proof 없이 나오면 위험 | unsupported_internal_data gate | Evidence map with source labels and date. |
| Product evidence thinness | 정보성 글은 대체 가능 | 상품글은 포함/불포함/리스크가 비면 전환 불가 | product open-contract blocker | Product registration source repair before commercial queueing. |
| Public render mismatch | 표가 깨지면 준비물/비용 글이 바로 신뢰를 잃음 | 포함/불포함 비교가 깨지면 문의 전 판단 실패 | render/table audits | Browser audit remains mandatory. |

### Final Practical Diagnosis

현재 반영 상태는 "좋은 방향으로 최적화가 시작된 상태"다. 최근 16개 audit과 generated canary는 통과하지만, 실제 100점 블로그 엔진이라고 말하려면 아래 두 조건이 추가로 필요하다.

1. Fleet-level 품질: 최근 30-100개 글에서 첫 문장, H2 순서, CTA, FAQ, 표 패턴이 반복되지 않아야 한다.
2. Product source 품질: 등록 상품이 customer-visible 상태이고, 가격/포함/불포함/주의/일정 체감 근거가 충분해야 상품글이 발행된다.

따라서 다음 강화 순서는 새 프롬프트를 더 길게 쓰는 것이 아니라, `고객 질문 → 근거 → 글 생성 → 수리 → 공개 렌더 → 색인 → 성과학습` 전체 체인을 점수화하는 것이다.

### Next Contract To Reach 100

1. Expand the phrase-drift detector from generated canary samples to the last 30-100 live posts:
   - repeated first sentence pattern;
   - repeated H2 order;
   - repeated CTA sentence;
   - repeated "first check cost/movement/local condition" style openings.

2. Add paragraph-level evidence mapping:
   - weather/visa/fees/transport claims must map to official links or marked internal evidence;
   - product price/included/excluded claims must map to product DB fields;
   - unsupported claims become repair tasks, not published content.

3. Harden commercial source readiness:
   - product-backed blog rows can publish only after `customer_open_contract` and product status are customer-visible;
   - if product facts are thin, the system should repair product evidence or skip to an information candidate to still meet daily quota.

4. Add prompt regression samples:
   - 10 information golden cases: weather, packing, family itinerary, airport arrival, budget, visa, insurance, currency, transport, shopping;
   - 10 product golden cases: package with shopping, no-option, family, parent, golf, airtel, free day, hidden local expense, room condition, group join.

5. Keep daily quota resilient:
   - repairable quality failures should be retried immediately;
   - unsafe source failures should be replaced by another publishable candidate;
   - low-time recovery should prefer safe information fallback candidates over slow product/card/pillar rows;
   - claimed rows that were never attempted because the publisher ran out of time should be released back to `queued` immediately;
   - the day should end with target count met while preserving the no-invention rule.

## 2026-07-09 Session-Wide Korean Quality Audit

이 섹션은 세션 전체에서 제기된 실제 문제, 첨부된 정보성/상품성 마스터 프롬프트, 현재 코드 반영 상태, 외부 여행 서비스/논문/오픈소스 패턴을 한 번에 대조한 결론이다. 핵심 질문은 "테스트가 통과했는가"가 아니라 "고객이 읽었을 때 AI 글처럼 보이지 않고, 필요한 결정을 끝낼 수 있는가"다.

### 현재 반영 상태

- 최근 16개 공개 글 감사는 `changed=0`, `qualityGateFailed=0`, `publishBlocked=0`, `engineCategoryScorecard.averageScore=100`으로 통과했다.
- 현재 KST 운영일은 `4/4` 발행을 채웠고, 활성 실패 버킷은 비어 있다.
- 정보성/상품성 writer split, answer-first, 하단 약CTA, 상품 DB-only claim, 포함/불포함, 맞는 사람/안 맞는 사람, 위험 조건, 문의 전 질문은 코드에 반영되어 있다.
- 공개 렌더 기준의 table/highlight/CTA residue 검사가 있고, 최근 품질 테스트도 통과했다.
- 그러나 2026-07-08 KST는 `0/4`로 놓친 이력이 남아 있고, 상품성 후보 34개는 연결 상품이 `pending_review`라 고객 공개 상품글로 쓰기 어렵다.

### 정보성 글 취약점

| 항목 | 현재 점수 | 진단 |
|---|---:|---|
| 검색 의도 해결 | 88 | 첫 문단 답변, 공식 출처, 표/체크리스트 계약은 맞다. 다만 주제별 고객 불안 언어가 더 다양해야 한다. |
| 자연스러운 말투 | 80 | 금지어와 AI식 인사는 막고 있지만, 여러 글이 비슷한 첫 문장·H2 순서·CTA 문장으로 반복될 위험이 있다. |
| 고객 언어 | 79 | "예산/이동/현지 조건" 같은 운영자식 표현이 아직 남을 수 있다. "아이랑 가도 괜찮나", "비 오면 망치나", "부모님 힘들까"처럼 검색자 머릿속 언어가 더 필요하다. |
| 근거/신뢰 | 86 | 공식 링크 요구는 있다. 다음 단계는 문단별 claim이 어떤 공식/내부 근거에서 왔는지 추적하는 evidence map이다. |
| 모바일 스캔성 | 91 | 테이블/체크리스트와 문단벽 검사는 강하다. 공개 브라우저 렌더 감사는 계속 필수다. |

정보성은 지금 "상위 노출용 틀"에서는 많이 좋아졌지만, "진짜 사람이 저장해둘 글"이 되려면 첫 단락과 섹션 제목이 더 고객 질문형이어야 한다. 예를 들어 "몽골 7월 날씨"는 비용/예약보다 낮밤 기온, 소나기, 겉옷, 신발, 보습, 통신/전기 같은 준비 판단을 먼저 말해야 한다.

### 상품성 글 취약점

| 항목 | 현재 점수 | 진단 |
|---|---:|---|
| 상품 DB 충실도 | 76 | 원문/등록 상품 기준으로만 쓰는 방향은 맞다. 단, 많은 상품이 `pending_review`라 상품글 재료 자체가 막혀 있다. |
| 문의 전 판단 도움 | 84 | 가격/출발지/기간, 포함/불포함, fit/not-fit, 위험 조건, 문의 전 질문은 반영됐다. 이동 강도, 쇼핑/선택관광, 객실 조건, 취소/패널티 추출을 더 강화해야 한다. |
| 과장 방지 | 87 | 최저가, 역대급, 추천 남발, 없는 호텔명/혜택 생성 금지는 맞다. |
| 고객 신뢰 | 82 | "안 맞는 사람"을 넣는 방향은 좋다. 하지만 상품 원천 데이터가 얇으면 글도 얇아지므로 상품 등록 품질과 연결돼야 한다. |
| 전환 자연스러움 | 83 | CTA는 "예약하세요"보다 "출발일/인원 기준 가능 여부 확인"으로 바뀌었다. CTA 문구 반복은 fleet drift로 계속 봐야 한다. |

상품성은 프롬프트만 바꾸면 100점이 되지 않는다. 여소남 상품글은 "등록 상품 원문 → 고객 공개 검수 → 가격/포함/불포함/주의/취소/쇼핑/객실/선택관광 구조화 → 블로그 작성" 순서가 맞아야 한다. 상품이 미검수면 정보성 후보로 일일 발행량을 채우고, 상품글은 보류하는 현재 방향이 맞다.

### 첨부 프롬프트에서 선별 도입할 부분

정보성 마스터 프롬프트에서 도입 가치가 높은 것:

- 제목의 핵심 약속을 먼저 분해하고, 독자가 얻어야 할 실제 답을 정하는 내부 판단 절차.
- 가격/예약/비교/교통/규정/준비물/보험/세관처럼 정보 타입을 분류하는 방식.
- 위험도에 따라 단정 강도를 낮추는 규칙.
- 첫 단락을 감성 인사 없이 답변으로 시작하는 규칙.

정보성에서 그대로 도입하면 안 되는 것:

- URL 금지, Markdown 금지, 표 금지는 우리 공개 블로그/공식 출처/렌더 계약과 충돌한다.
- 고정 인사말은 fleet-level AI smell을 만든다.
- 네이버 복붙용 `ㅁ` 구조는 우리 사이트의 Markdown table 계약과 다르다.

상품성 마스터 프롬프트에서 도입 가치가 높은 것:

- 원문에 없는 가격, 날짜, 항공, 호텔, 객실, 특전, 노쇼핑/노팁을 만들지 않는 원칙.
- 커미션, 수수료율, 마진, 원가, 계좌번호, 내부 메모 제거.
- 기사/가이드 경비, 유류세, 싱글차지, 호텔 써차지, 선택관광, 쇼핑, 매너팁, 계약금, 일정 미참여 패널티, 객실 배정 제한, 여권/비자/반입 제한을 숨기지 않는 원칙.
- 40~60대 모바일 독자를 위한 짧은 문단과 쉬운 말.

상품성에서 그대로 도입하면 안 되는 것:

- Markdown/table 금지는 우리 상품 판단표와 공개 렌더 검증에 맞지 않는다.
- 고정 인사말과 고정 제목 공식은 반복 냄새를 만든다.
- "본문 표는 쓰지 않는다"는 포함/불포함 비교 UX를 약하게 만든다.

### 경쟁 서비스 대비 점수

| 비교 대상 | 강점 | 우리 현재 위치 |
|---|---|---|
| 트립스토어식 경비 글 | 가족/예산/항목별 금액을 앞에서 바로 보여준다. | 정보성 경비 글은 근접했지만 고객 상황별 표현 다양성은 더 필요하다. |
| 트리플 준비물/체크리스트 | 모바일에서 빠르게 저장하고 훑기 좋다. | 체크리스트/표 계약은 강하지만, 문장 톤은 더 가볍고 사람다워져야 한다. |
| 마이리얼트립 상품 상세 | 포함/불포함, 이용안내, 필수확인, 취소/환불이 분리되어 있다. | 상품글 구조는 맞지만 등록 상품 공개 검수/원천 데이터 품질이 병목이다. |
| Lonely Planet/CN Traveler | 장소별 맥락과 판단이 자연스럽다. | 여소남은 매거진풍보다 상담 전환형이라 문학적 톤은 적게 차용해야 한다. |
| 여행 뉴스레터 | 사람이 말하는 듯한 문제 제기와 압축된 프레이밍이 좋다. | 프롬프트에 고객 불안 문장 pool을 넣으면 큰 개선 여지가 있다. |

### 오픈소스/MCP 도입 우선순위

| 우선 | 도구/패턴 | 점수 | 적용 방식 |
|---:|---|---:|---|
| 1 | Promptfoo | 93 | 정보성/상품성 golden prompt 20개를 만들어 프롬프트 변경 때 회귀 테스트. |
| 2 | Browser/Playwright render audit | 95 | 실제 `/blog/[slug]` 화면에서 표, 형광펜, 중복 블록, 모바일 문단벽 검사. 이미 방향 맞음. |
| 3 | RAGAS-style faithfulness | 86 | 공식자료/상품 DB 근거와 본문 claim 일치도 측정. 패키지 도입보다 내부 metric 차용 우선. |
| 4 | DeepEval/G-Eval style judge | 87 | 자연스러움, 고객 언어, 도움됨 같은 주관 품질을 보조 평가. 단독 publish blocker로 쓰지 말 것. |
| 5 | Langfuse | 84 | prompt version, 모델, 비용, latency, repair attempts 추적이 SQL만으로 어려워질 때 도입. |
| 6 | Firecrawl MCP | 80 | 경쟁 블로그/공식 자료 수집 연구용. 라이브 발행 의존성으로 쓰지는 말 것. |
| 7 | CRAG/Self-RAG pattern | 83 | 근거가 약하면 보류/재검색/정보성 fallback으로 돌리는 판단 체계. 이미 일부 반영, 더 강화 필요. |
| 8 | Great Expectations-style checks | 90 | 상품 원천, 큐 후보, 색인 outbox의 데이터 품질 검증. 외부 패키지 없이 내부 구현 유지가 적합. |

### 최종 판단

현재 엔진은 "이전보다 크게 좋아졌고 최근 샘플은 통과" 상태다. 하지만 "완벽"은 아니다. 고객이 보는 품질 기준으로는 **84/100**, 정보성은 **86/100**, 상품성은 **81/100**, fleet-level 자연스러움은 **74/100**으로 보는 게 현실적이다.

100점에 가까워지려면 다음 4개가 필요하다.

1. 최근 30~100개 글에 대한 fleet phrase drift를 상시 진단한다.
2. 날씨/비자/요금/교통 claim과 상품 가격/포함/불포함 claim에 문단별 evidence map을 붙인다.
3. 상품성 글은 등록 상품 검수 상태, 포함/불포함, 쇼핑/선택관광, 취소/패널티, 객실 조건이 충분할 때만 발행한다.
4. Promptfoo-style golden set을 만들어 "프롬프트를 고쳤는데 말투가 다시 AI화되는 문제"를 CI에서 막는다.
