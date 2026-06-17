# Jarvis RAG Improvement Plan

> Date: 2026-06-17
> Basis: 4h53m long-run test, live Supabase/Vercel env, current Jarvis code, and recent RAG research.

## Executive Summary

Jarvis is not blocked by missing keys anymore. The core blocker is production RAG reliability:

- `jarvis_hybrid_search` currently fails in production with `operator does not exist: extensions.vector <=> extensions.vector`.
- Fallback text search works but can over-retrieve irrelevant blog chunks.
- Customer operation questions lack grounded policy/ops knowledge: booking status, deposit check, Kakao handoff, refund/payment execution handoff, privacy deletion, passport/name corrections.
- Risk gating is mostly strong, but passport/name correction and approval-bypass prompt injection need tightening.

Target state:

- Retrieval must be measured before generation.
- Low-confidence retrieval must refuse or escalate, not answer with weak evidence.
- Product, policy, booking, payment, and handoff questions need separate retrieval policies.
- RAG evaluation becomes a release gate, not an occasional audit.

## Research Notes Applied

- Agentic RAG research argues that static, linear RAG is weak for multi-step real-world tasks; production Jarvis should route, retrieve, critique, and adapt by task class instead of one fixed retrieval path.
- RAGAS and ARES both separate context relevance, answer faithfulness, and answer relevance. Jarvis should score all three, not just "did retrieval return rows?"
- RankRAG shows that reranking is not optional once initial retrieval is noisy. Jarvis needs a rerank/selection stage before answer generation.
- GraphRAG is useful for global or sensemaking questions across a corpus. Jarvis should not use it for every customer question, but it fits destination comparisons, policy maps, supplier/package relationships, and "which trip is better for my situation?"
- Long-context research warns that simply stuffing many chunks into the prompt can degrade performance. Jarvis should use compact, ranked, source-diverse evidence rather than long unfiltered context.
- Supabase/pgvector guidance points to explicit vector extension/index correctness, plus HNSW/IVFFlat tuning when data scales.

## P0: Restore Production Hybrid RAG

Problem:

- Production RPC fails on vector operator resolution.
- The client currently passes a JS array to an RPC whose generated Supabase type expects `p_query_embedding: string`.

Plan:

1. Inspect production DB extension/operator state:
   - `pg_extension` for `vector`
   - `pg_type` for `jarvis_knowledge_chunks.embedding`
   - `pg_operator` for cosine operator `<=>`
   - function definition/search path for `jarvis_hybrid_search`
2. Patch RPC with explicit extension-safe operator use:
   - Prefer `c.embedding OPERATOR(extensions.<=>) p_query_embedding` if vector extension lives in `extensions`.
   - Add `SET search_path = public, extensions` on the function if needed.
3. Normalize client RPC parameter:
   - Convert embedding array to pgvector string format before `supabase.rpc`, for example `'[0.1,0.2,...]'`.
   - Keep `null` embedding path truly BM25-only, not zero-vector search.
4. Add tests:
   - Unit test for vector serialization.
   - Live smoke: `npm run audit:jarvis-rag:vercel` must produce nonzero hybrid hits for at least package/blog/attraction queries.

Acceptance:

- No `extensions.vector <=> extensions.vector` errors.
- Hybrid retrieval returns source-diverse hits.
- Long-run hybrid probes have `primaryHitCount > 0` for normal product/policy queries.

## P0: Policy/Ops Knowledge Coverage

Problem:

- Long-run failures were dominated by empty retrieval for customer operations questions.

Add first-class knowledge sources:

- `policy`: refund/cancel policy, payment cancel policy, deposit confirmation language, privacy deletion process, passport/name correction process.
- `handoff`: Kakao/phone escalation path, complaint intake, SLA language, owner queue.
- `booking_ops`: booking status lookup boundaries, date change boundaries, seat/name/passport correction boundaries.
- `payment_ops`: deposit check, unmatched payment, refund execution handoff.

Plan:

1. Add source documents as versioned markdown or DB seed rows.
2. Reindex into `jarvis_knowledge_chunks` with `source_type='policy'` or `custom`.
3. Require these scenarios to retrieve policy/ops chunks before answer generation.
4. Add "no direct execution" answer templates for critical requests.

Acceptance:

- Booking/payment/escalation scenarios no longer return empty retrieval.
- Refund/payment/privacy/passport/name requests cite policy/ops sources and escalate.
- Customer answer never promises completion of refund, cancel, price change, or data deletion.

## P0: Low-Confidence Retrieval Guard

Problem:

- Fallback retrieval can return irrelevant blog chunks for nonsense or unrelated queries.

Plan:

1. Add retrieval confidence object:
   - hit count
   - top score
   - source diversity
   - query/source type match
   - exact policy match for operational questions
2. Add a hard rule:
   - If confidence is low, Jarvis asks a clarifying question or escalates.
   - It must not cite fallback blog chunks as if they answered the user.
3. Add "empty retrieval safe response" for customer chat V2.

Acceptance:

- Unknown destination and junk input do not get irrelevant package/blog citations.
- Operational requests with no policy hit produce safe handoff, not hallucinated policy.

## P1: Rerank And Evidence Selection

Plan:

1. Always retrieve more than needed: vector top 20 + BM25 top 20.
2. Rerank to top 5 with a cheap LLM or dedicated reranker.
3. Enforce source diversity:
   - Product recommendation: at least one package hit.
   - Policy request: at least one policy/ops hit.
   - Destination guide: blog/attraction allowed.
4. Build answer context from compact snippets:
   - title
   - source type
   - source URL/ref
   - 300-500 char excerpt
   - confidence score

Acceptance:

- Repeated same-blog retrieval drops sharply.
- Customer answer source citations match the question type.

## P1: RAG Evaluation Gate

Metrics:

- Context relevance
- Faithfulness
- Answer relevance
- Citation coverage
- Refusal correctness for unsafe/low-confidence questions
- Escalation correctness for operations questions

Plan:

1. Convert long-run scenarios into a typed golden set.
2. Add expected source type and expected action:
   - answer
   - clarify
   - escalate
   - block
3. Add an evaluator command:
   - `npm run eval:jarvis-rag-live`
4. Store nightly summaries in `logs/jarvis-long-run` and fail CI/staging promotion on regression.

Acceptance:

- Live RAG gate must pass before enabling customer auto-answer.
- Failures produce actionable rows by scenario and source type.

## P1: Risk And Prompt-Injection Hardening

Fixes:

- Passport/name correction: always high risk.
- Approval bypass: block before retrieval, not just mark critical.
- RLS/customer-data exfiltration: block and log security event.
- Critical requests: answer only with handoff/refusal template unless staff approval exists.

Acceptance:

- Long-run `passport-change` is high risk and approval-required.
- Approval-bypass prompts are blocked, not retrieved.

## P2: GraphRAG For Travel And Ops Sensemaking

Use GraphRAG where naive retrieval is weak:

- Destination comparison: Danang vs Nha Trang vs Phu Quoc.
- Product/package relationships: destination, airline, hotel grade, free options, shopping count.
- Policy process map: refund -> approval -> payment cancel -> customer notice.
- Handoff graph: channel -> owner -> queue -> SLA.

Do not use GraphRAG for every chat turn. Use it for global/comparison/multi-hop questions.

Acceptance:

- "베트남 처음이면 어디가 좋아?" retrieves structured destination comparison evidence.
- "환불 절차가 어떻게 흘러가?" retrieves a process graph summary, not random policy chunks.

## P2: Long-Context Strategy

Plan:

- Keep chunks small enough for precise retrieval.
- Add parent document summaries for broader context.
- Use parent-child retrieval:
  - retrieve child chunks
  - attach parent summary
  - rerank final evidence
- Avoid dumping many chunks into the prompt.

Acceptance:

- Answers use fewer, better snippets.
- Long policy or itinerary docs retain global context without "lost in the middle" behavior.

## Rollout Sequence

Day 1:

- Fix hybrid RPC/operator/client vector serialization.
- Add regression for vector RPC.
- Run 1-hour live long-run with hybrid enabled.

Days 2-3:

- Add policy/ops knowledge seed.
- Reindex RAG.
- Add low-confidence guard.
- Re-run long-run.

Days 4-5:

- Add rerank/evidence selection.
- Expand eval gate with source-type expectations.
- Add answer/refusal/escalation templates.

Week 2:

- Add GraphRAG-lite entity/process tables.
- Add nightly live RAG report.
- Add admin UI display for retrieval confidence and source evidence.

## Ship/No-Ship Rule

Do not turn on full customer auto-answer until:

- Hybrid RAG is error-free.
- Operational policy queries retrieve proper policy/ops evidence.
- Long-run pass rate is above 95%.
- Critical customer requests always refuse or escalate.
- Admin can inspect answer source evidence.
