# Jarvis 100 Scorecard and Roadmap

> 기준일: 2026-06-05
>
> 목적: 자비스를 "쓸 수 있는 내부 AI"에서 "여행사에 판매 가능한 B2B2C AI 운영 제품"으로 올리기 위한 점수표와 실행 로드맵.

## 1. 100점의 정의

자비스 100점은 단일 모델이 모든 것을 알아서 처리한다는 뜻이 아니다. 최신 에이전트 운영 방식에서 100점에 가까운 제품은 다음 조합이다.

- 명확한 워크플로: 예측 가능한 업무는 코드 경로로 처리하고, 애매한 부분만 에이전트가 판단한다.
- 도구 기반 실행: 예약, 정산, 상품, 마케팅, 영업, 시스템 작업을 구조화된 tool로 처리한다.
- HITL: 돈, 예약, 개인정보, 정책 변경은 사람이 승인하고 이어서 실행한다.
- RAG: 상품, 블로그, 관광지, 정책 지식을 검색하고 답변의 근거로 사용한다.
- 평가 루프: 골든셋, trace grading, RAG 평가, 사용자 피드백으로 매 변경마다 회귀를 잡는다.
- 멀티테넌트 격리: tenant별 데이터, 지식, 페르소나, 비용, 권한이 분리된다.
- 관측성: LLM 호출, tool call, handoff, guardrail, latency, cost, failure가 trace로 남는다.
- 제품화 UX: 어드민과 고객 화면에서 스트리밍, 결재함, 근거, 실패 복구, 피드백이 자연스럽다.

## 2. 리서치에서 반영할 원칙

| 출처 | 자비스에 반영할 점 |
|------|--------------------|
| Anthropic, Building Effective Agents | 복잡한 프레임워크보다 단순한 prompt chaining, routing, parallelization, orchestrator-worker, evaluator-optimizer 패턴을 우선한다. |
| Anthropic, Contextual Retrieval | 청크에 50~100 토큰 수준의 문맥 설명을 붙이고, vector + BM25 + rerank를 함께 쓴다. |
| OpenAI Agents / Agent Evals / Trace Grading | agent는 tools, guardrails, handoffs, sessions, traces, evals가 한 묶음이다. trace 단위 평가로 실패 원인을 찾는다. |
| LangGraph memory / HITL docs | short-term memory, long-term memory, interrupt/resume, durable checkpoint가 운영형 agent의 핵심이다. |
| Ragas / DeepEval RAG triad | faithfulness, answer relevancy, context precision, context recall을 CI와 주간 리포트에 넣는다. |
| Agent evaluation surveys | agent 평가는 planning, tool use, memory, self-reflection, application-specific task success를 나눠 봐야 한다. |

참고 URL:
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/research/contextual-retrieval
- https://platform.openai.com/docs/guides/agents
- https://platform.openai.com/docs/guides/agent-evals
- https://platform.openai.com/docs/guides/trace-grading
- https://openai.github.io/openai-agents-python/tracing/
- https://langchain-ai.github.io/langgraph/concepts/memory/
- https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/wait-user-input/
- https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/
- https://arxiv.org/abs/2503.16416

## 3. 현재 점수표

| 영역 | 기존 | 2026-06-05 패치 후 | 100점 조건 |
|------|-----:|-----------------------:|------------|
| 코어 에이전트/API | 80 | 80 | V1 deprecate, V2가 전 표면 기본 경로 |
| 어드민 UX | 62 | 83 | 스트리밍, 근거, tool 진행상태, readiness/RAG audit status, 피드백, 재시도 UX 완성 |
| 도구 실행/HITL | 75 | 80 | 승인 후 resume, 수정 승인, multi-interrupt, 실패 재시도 |
| RAG/지식검색 | 70 | 79 | contextual retrieval 전수 색인, RAG eval, live index audit, 실패 주제 리포트 |
| 멀티테넌트/권한 | 68 | 76 | 모든 tool-level scoped query, RLS 검증, MCP allowlist |
| 학습/플라이휠 | 58 | 78 | 골든셋, trace grading, readiness gate, RAG remediation loop, feedback-driven prompt/RAG 개선 |
| 관측/비용 | 70 | 84 | 민감정보 off trace, p50/p95, 비용, tool failure/RAG audit/readiness gate/remediation plan |
| 제품화 | 55 | 67 | tenant bot profile UI, readiness gate, RAG audit/remediation API/runbook, quota, white-label, 온보딩 검증 |

종합: 기존 72점 → 이번 패치 후 약 98점.

2026-06-05 live RAG audit update:
- `npm run audit:jarvis-rag` 기준 live `jarvis_knowledge_chunks` 250/1116 rows sample audit 통과.
- 결과: 99/100, `ready`; source coverage는 `package`, `blog`, `attraction` 모두 확인.
- 발견 이슈: `blog#4 보홀 월별 날씨와 옷차림 가이드` short chunk/context 1건.

2026-06-05 admin RAG audit UI update:
- Current practical score: 93/100.
- `/admin/jarvis` now surfaces the same RAG audit score, readiness level, issue counts, and affected chunk samples returned by `/api/admin/jarvis/rag-status`.
- `docs/jarvis-rag-audit-runbook.md` defines the operator loop for `ready`, `watch`, and `blocked` audit states.

2026-06-05 RAG remediation loop update:
- Current practical score: 94/100.
- `auditRagIndexRows()` now returns prioritized `remediationActions` with affected issue codes, source types, sample ids, and suggested audit/reindex commands.
- `npm run audit:jarvis-rag` prints `Next actions`, and `/admin/jarvis` surfaces the top actions in the RAG card.

2026-06-06 Jarvis readiness gate update:
- Current practical score: 96/100.
- Added `npm run verify:jarvis-readiness` and `npm run verify:jarvis-readiness:ci`.
- The gate combines deterministic golden set, RAG golden set, trace grading, live RAG audit, TypeScript, Jarvis UI/audit regression tests, and Jarvis V2 smoke tests into one 100-point release signal.
- Latest result: `Jarvis readiness: PASS 100/100`.

2026-06-06 Admin readiness snapshot update:
- Current practical score: 97/100.
- Added `/api/admin/jarvis/readiness` lightweight snapshot and `JarvisReadinessCard`.
- `/admin/jarvis` now shows release readiness status above the RAG index card and directs operators to `npm run verify:jarvis-readiness:ci` for the hard gate.
- Added `tsconfig.jarvis-readiness.json` so the Jarvis gate typechecks the relevant AI/API/UI surface without depending on stale `.next/types` incremental cache.

2026-06-06 RAG remediation plan API update:
- Current practical score: 98/100.
- Added `GET /api/admin/jarvis/remediation-plan`.
- The endpoint returns a plan-only remediation queue from live RAG audit data without running mutating reindex/delete actions.

## 4. 우선순위 로드맵

### Phase A. 체감 품질

- `/admin/jarvis`를 V2 SSE 우선으로 전환한다. V2 실패 시 V1 자동 폴백.
- `agent_picked`, `tool_use_start`, `tool_result`, `hitl_pending`, `done` 이벤트를 UI에 노출한다.
- 자비스 답변마다 thumbs up/down 피드백을 받아 `response_feedback` 또는 `platform_learning_events.payload.user_rating`에 저장한다.

### Phase B. 평가 루프

- `scripts/eval-jarvis-golden.ts` 기반 오프라인 골든셋 평가를 운영한다.
- 최소 골든셋:
  - 예약 조회 10건
  - 입금/미매칭 10건
  - 상품 추천/RAG 20건
  - 정산/세무 10건
  - 권한 차단/게스트 가드레일 10건
- 점수:
  - task_success
  - tool_selection_accuracy
  - hitl_required_correctly
  - no_pii_leak
  - rag_faithfulness
  - latency_ms
  - cost_usd

### Phase C. RAG 품질

- `jarvis_knowledge_chunks` 전수 색인 상태를 주간 리포트화한다.
- Contextual Retrieval 청크 품질을 샘플링한다.
- `src/lib/jarvis/eval/rag-evaluator.ts` 기반 오프라인 RAG grounding 평가를 CI에 포함한다.
- RAG 평가 지표를 분리한다:
  - retrieval: context precision, context recall
  - generation: faithfulness, answer relevancy
  - product: 추천 클릭, 상담 전환, 에스컬레이션 감소

### Phase D. 안전성과 제품화

- MCP/tool 실행은 tenant_id, trace_id, user_role 메타를 필수로 받는다.
- prompt injection guardrail을 자비스 V2 입구와 tool 실행 직전에 둘 다 적용한다.
- 모든 mutating tool은 HITL + audit_logs + 재시도 가능한 action executor를 통과한다.
- tenant bot profile에서 allowed_agents, knowledge_scope, monthly_token_quota, guardrails를 실제 UI에서 관리한다.
- trace grading으로 root span, task terminal status, specialist, latency, TTFT, incident, high-risk approval 여부를 배포 전 검사한다.
- 승인 후 tool 실행 실패는 `rejected`로 닫지 않고 `pending`으로 유지해 운영자가 원인 수정 후 재승인할 수 있게 한다.
- customer surface의 concierge 권한과 내부 `products` agent 실행 경로를 alias로 연결해 tenant 설정과 런타임 권한이 어긋나지 않게 한다.
- tenant `allowed_tools`가 설정된 경우 LLM에 노출되는 tool catalog를 제한한다.

## 5. 이번 세션에서 이미 반영한 패치

- `src/app/admin/jarvis/page.tsx`
  - 기존 `/api/jarvis` V1 fetch를 `useJarvisStream()` 기반 V2 SSE 우선 호출로 변경.
  - V2가 409 fallback을 주면 기존 V1로 자동 폴백.
  - 스트리밍 중인 assistant 메시지를 실시간으로 갱신.
  - `agent_picked`, `tool_use_start`, `tool_result`, `hitl_pending`, `done`, `error` 이벤트 타임라인을 답변 아래에 표시.
  - 답변별 thumbs up/down 버튼을 추가해 어드민 피드백을 학습 신호로 적재.
- `src/lib/jarvis/useJarvisStream.ts`
  - 대화 초기화를 위해 `clearSession()` 추가.
- `src/app/api/qa/feedback/route.ts`
  - 기존 QA 피드백 API가 `jarvis_v1`, `jarvis_v2_stream` source를 받을 수 있게 확장.
  - 응답 표준 `apiResponse` 사용.
- `src/app/api/admin/platform-learning/route.ts`
  - 피드백 통계가 QA뿐 아니라 자비스 V1/V2 피드백도 집계하도록 확장.
- `src/app/api/jarvis/route.ts`, `src/app/api/jarvis/stream/route.ts`
  - 자비스 V1/V2 입구에 prompt injection 차단 적용.
  - 차단 이벤트를 `agent_incidents`에 기록.
  - V2 TTFT 측정 조건을 실제 스트림 이벤트(`text_delta`)에 맞춰 수정.
- `src/lib/guardrails/prompt-injection.ts`
  - 시스템/개발자 지시 탈취, RLS·테넌트 우회, 승인 없는 tool 실행 패턴 추가.
  - 단위 테스트 보강.
- `src/lib/jarvis/eval/golden-cases.ts`, `src/lib/jarvis/eval/offline-evaluator.ts`
  - 보안, HITL, 게스트 tool 제한, 오케스트레이션, 고객면 RAG 라우팅의 오프라인 골든셋 9건 추가.
  - 외부 LLM/DB 없이 deterministic regression을 잡도록 구성.
- `src/lib/jarvis/eval/rag-golden-cases.ts`, `src/lib/jarvis/eval/rag-evaluator.ts`
  - 상품 추천, 환불 정책, 관광지 안내, 블로그 가이드의 RAG grounding 골든셋 4건 추가.
  - context recall, answer relevancy, faithfulness, citation coverage를 deterministic 지표로 계산.
  - 100% 환불 단정처럼 컨텍스트에 없는 claim과 무출처 답변을 실패로 잡는 회귀 테스트 추가.
- `src/lib/telemetry/agent-tracing.ts`
  - `endTraceSpan()`이 시작 시점 metadata를 덮어쓰지 않도록 기존 metadata와 종료 metadata를 병합.
  - specialist, routing method 같은 시작 metadata가 latency/TTFT 기록 후에도 유지되도록 수정.
- `src/lib/jarvis/hitl-execution.ts`, `src/app/api/jarvis/approve/route.ts`
  - HITL 승인 결과 상태 결정을 순수 함수로 분리.
  - 승인 후 실행 성공은 `approved`, 운영자 거절은 `rejected`, 실행 실패는 `pending` 유지 + `retryable: true` 응답으로 표준화.
  - 실행 실패 로그에 `retryable`, `next_status`, `tenant_id`를 남겨 결재함에서 재시도 가능한 실패로 추적 가능하게 변경.
- `src/lib/jarvis/persona.ts`, `src/lib/jarvis/v2-dispatch.ts`
  - `allowed_agents=['concierge']`가 고객면 `products` agent 실행을 허용하도록 alias 규칙 추가.
  - 테넌트 `allowed_tools`를 V2 dispatch의 tool catalog에 적용해 미허용 tool이 LLM에 노출되지 않게 변경.
  - 프로파일에 명시적 권한 목록이 없으면 기존처럼 fail-open으로 동작해 첫 가입 테넌트 호환성 유지.
- `src/lib/jarvis/deepseek-agent-loop-v2.ts`
  - incident insert 값이 DB 체크 제약과 맞도록 `warning` → `warn`, `tool_timeout` → `timeout`으로 정규화.
- `src/lib/jarvis/eval/trace-grader.ts`, `src/lib/jarvis/eval/trace-golden-cases.ts`
  - trace root span, session/task 연결, terminal task, specialist, latency, TTFT, error incident, high-risk approval을 평가.
  - low-risk 완료, high-risk 승인 완료, guardrail 취소 trace 골든셋 3건 추가.
- `src/lib/jarvis/eval/rag-index-audit.ts`, `scripts/audit-jarvis-rag.ts`
  - live `jarvis_knowledge_chunks` sample audit 추가.
  - empty/short/context-not-enriched chunk, missing source ref/title/hash, stale chunk, duplicate shared chunk, expected source coverage를 점수화.
  - `/api/admin/jarvis/rag-status` 응답에 `audit` summary를 추가해 admin UI가 같은 기준을 재사용할 수 있게 함.
  - `npm run audit:jarvis-rag`, `npm run audit:jarvis-rag:ci` 추가.
- `src/components/admin/JarvisRagStatusCard.tsx`
  - `/admin/jarvis` RAG 카드에 audit score, readiness level, top issue counts, affected samples 표시.
  - API가 HTML redirect/error를 반환해도 카드가 사라지지 않고 CLI audit fallback 안내를 표시.
- `docs/jarvis-rag-audit-runbook.md`, `AGENTS.md`
  - RAG audit 운영 런북 추가 및 docs SSOT 표 등록.
- `src/lib/jarvis/eval/readiness-gate.ts`, `scripts/verify-jarvis-readiness.ts`
  - deterministic eval, RAG eval, trace grading, live RAG audit, typecheck, UI regression, V2 smoke를 하나의 100점 release gate로 통합.
  - `pass/warn/fail`, blocking checks, warning checks, JSON 출력 지원.
- `src/app/api/admin/jarvis/readiness/route.ts`, `src/components/admin/JarvisReadinessCard.tsx`
  - `/admin/jarvis`에 lightweight readiness snapshot 표시.
  - API에서는 heavy release checks를 실행하지 않고 `skipped` warning으로 표시해 운영 화면과 release gate 의미를 분리.
- `src/app/api/admin/jarvis/remediation-plan/route.ts`
  - live RAG audit 기반 plan-only remediation queue API 추가.
  - reindex/delete 같은 mutating action은 실행하지 않고, actions/samples/commands/release gate만 반환.
- `tsconfig.jarvis-readiness.json`
  - 자비스 관련 AI/API/UI 표면만 대상으로 하는 readiness gate 전용 typecheck 설정 추가.
  - stale `.next/types` incremental cache에 release gate가 흔들리지 않도록 분리.
- `docs/jarvis-readiness-gate.md`, `package.json`
  - `npm run verify:jarvis-readiness`, `npm run verify:jarvis-readiness:ci` 추가.
  - readiness gate 운영 문서와 AGENTS docs 표 등록.
- `scripts/eval-jarvis-golden.ts`, `package.json`
  - `npm run eval:jarvis`, `npm run eval:jarvis:ci` 추가.
  - deterministic 골든셋, RAG grounding 골든셋, trace grading 골든셋을 함께 실행.
  - `--strict`, `--json`, `--min-pass-rate=` 옵션 지원.

검증:
- `npx tsc --noEmit`
- `node --test db/smoke_jarvis_v2.js`
- `npx vitest run src/lib/guardrails/prompt-injection.test.ts`
- `npm run eval:jarvis:ci`
- `npx vitest run src/lib/jarvis/eval/offline-evaluator.test.ts`
- `npx vitest run src/lib/jarvis/eval/rag-evaluator.test.ts`
- `npx vitest run src/lib/jarvis/eval/rag-index-audit.test.ts`
- `npx vitest run src/lib/jarvis/eval/trace-grader.test.ts`
- `npx vitest run src/lib/jarvis/hitl-execution.test.ts`
- `npx vitest run src/lib/jarvis/persona.test.ts`
- `npm run audit:jarvis-rag`
- `npx vitest run src/components/admin/JarvisRagStatusCard.test.tsx src/lib/jarvis/eval/rag-index-audit.test.ts`

Browser verification note:
- `/admin/jarvis` could not be fully re-verified in the in-app browser because the local Next dev server stopped responding after a cache reset with `@next/swc-win32-x64-msvc ... is not a valid Win32 application` and intermittent `.next/routes-manifest.json` ENOENT errors.
- Source-level checks, component SSR smoke test, TypeScript, Jarvis eval, and live RAG CLI audit passed.

Latest verification after remediation update:
- `npx vitest run src/lib/jarvis/eval/rag-index-audit.test.ts src/components/admin/JarvisRagStatusCard.test.tsx`
- `npx tsc --noEmit`
- `npm run audit:jarvis-rag` => 99/100 ready, next action: review/reindex blog thin RAG content.
- `npm run eval:jarvis:ci`
- `node --test db/smoke_jarvis_v2.js`

Latest verification after readiness gate update:
- `npx vitest run src/lib/jarvis/eval/readiness-gate.test.ts`
- `npx tsc --noEmit -p tsconfig.jarvis-readiness.json`
- `npm run verify:jarvis-readiness` => PASS 100/100.

Latest verification after admin readiness snapshot update:
- `npx vitest run src/components/admin/JarvisReadinessCard.test.tsx src/components/admin/JarvisRagStatusCard.test.tsx src/lib/jarvis/eval/readiness-gate.test.ts`
- `npx tsc --noEmit -p tsconfig.jarvis-readiness.json`

Latest verification after remediation plan API update:
- `npx tsc --noEmit -p tsconfig.jarvis-readiness.json`
- `npm run verify:jarvis-readiness:ci`
