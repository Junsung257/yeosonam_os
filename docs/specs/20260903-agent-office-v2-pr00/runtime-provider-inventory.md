# Runtime And Provider Inventory

## Baseline Result

`node scripts/audit-llm-telemetry-coverage.mjs --json` reports:

| Measure | Count |
|---|---:|
| Direct-call candidate files | 30 |
| Shared OTel traced files | 2 |
| Grandfathered untraced files | 28 |
| New untraced files | 0 |
| Stale baseline files | 0 |

This is a file-pattern audit, not an invocation inventory. Three candidates are not model-generation callers: the AI credit route makes a provider balance request, and `llm-retry.ts` plus `llm-validate-retry.ts` contain usage examples in comments. The remaining 27 files contain one or more actual model or embedding invocation paths.

## Current Policy Boundary

- `AiProvider` is restricted to `deepseek | claude | gemini` in `src/lib/ai-provider-policy.ts`.
- `resolveAiPolicyRuntime()` applies enabled `system_ai_policies` rows before environment/code defaults and carries fallback and timeout fields.
- `llm-gateway.ts` uses that runtime resolver and common OTel tracing.
- Several legacy callers construct provider SDK clients or HTTP requests directly.
- `blog-ai-caller.ts` supports general provider behavior, but the Production Blog V4/V5 lane passes explicit DeepSeek models and forbids generic fallback by contract.
- No Codex subscription Runtime Adapter exists in this baseline.

## Delta Revalidation At `754f739569d03c65fd8e1c1573e415c389b017f2`

- The file-pattern telemetry audit remains 30 candidates, 2 shared-traced, 28 grandfathered, 0 new, and 0 stale.
- `src/lib/ai-provider-policy.ts`, `src/lib/blog-deepseek-orchestrator-v4.ts`, the `AiProvider` union, and Provider credential routing did not change.
- The legacy `programmatic-seo-generator` removed its `llmCall({ task: 'blog-generate' })` title/intro hint. It now delegates to deterministic `promotePendingTopics()` and adds no replacement model call.
- No Runtime, Provider, model, subscription worker, MCP, or external tool was added.
- The telemetry audit is still file-pattern based. Gateway call-site inventory must remain a separate strangler input; the removed route demonstrates why candidate-file counts alone are not a complete invocation map.

Result: Runtime/Provider compatibility decisions remain valid and the Blog boundary is stronger, not weaker.

## Candidate-File Inventory

`Timeout` means a provider/network deadline visible in the candidate file or common gateway. `Usage` distinguishes shared OTel from local-only counters.

| Candidate file | Task / runtime | Provider and model | Policy / fallback / timeout | Usage | Data risk |
|---|---|---|---|---|---|
| `src/app/api/admin/ai-credits/route.ts` | admin credit balance, Next server | DeepSeek balance endpoint; no generation | direct provider request; 5s | DB cost rows, not LLM trace | low; provider account metadata |
| `src/app/api/admin/invoice/parse/route.ts` | invoice OCR/extraction, Next server | Gemini `2.0-flash` | direct; no candidate-local model fallback/deadline found | none | **high**: invoice and ledger data |
| `src/app/api/concierge/search/route.ts` | concierge search loop, Next server | Gemini `2.5-flash` HTTP | direct; iterative tool response; no explicit request deadline found | none | possible customer intent/context |
| `src/app/api/cron/review-sentiment/route.ts` | review sentiment cron | Gemini `2.0-flash` | direct; per-row catch/fallback behavior belongs to route | none | possible customer text |
| `src/app/api/passport/ocr/route.ts` | passport OCR, Next server | Gemini `2.0-flash` | direct; no candidate-local deadline found | none | **critical PII**: passport image/MRZ |
| `src/app/api/products/scan/route.ts` | product source scan | DeepSeek `v4-flash` | direct; deterministic code mappings repair output | none | supplier/product business data |
| `src/app/api/qa/vision/route.ts` | visual extract plus sales answer | Gemini `2.5-flash`, two calls | direct; no shared router | none | image/customer context may contain PII |
| `src/lib/ai.ts` | marketing copy helpers | DeepSeek `v4-flash` | direct; deterministic copy fallbacks in some functions | none | product/marketing content |
| `src/lib/attraction-desc-gen.ts` | attraction descriptions | DeepSeek `v4-flash` | direct; source-description fallback | none | low |
| `src/lib/band-ai-analyzer.ts` | Band post extraction | DeepSeek `deepseek-chat` | direct; code normalization fallback | none | possible external-user text |
| `src/lib/blog-ai-caller.ts` | Blog/general content caller | DeepSeek, Claude, Gemini | sync policy/env or explicit model; configurable cascade and request timeout. Publication callers must pin DeepSeek and disable generic cascade | provider-neutral receipt/usage returned, no shared OTel | public-source/content; prompt evidence may be sensitive |
| `src/lib/card-news-html/critic.ts` | creative critique | DeepSeek `v4-flash` | direct; no fallback | local tokens and calculated cost | generated content/HTML |
| `src/lib/design-archetype-extractor.ts` | design-image analysis | Gemini `2.5-flash` | direct; provider secret helper only | none | uploaded image risk |
| `src/lib/destination-setup.ts` | destination bootstrap | DeepSeek `v4-flash` | direct; no fallback | none | low/business content |
| `src/lib/embeddings.ts` | embeddings | Gemini `embedding-001` | direct HTTP; 10s single and 20s batch | none | embedded text can contain source data |
| `src/lib/jarvis/claude-router.ts` | intent/specialist routing | DeepSeek `v4-flash` default | direct despite legacy filename; environment model override | none | possible customer intent |
| `src/lib/jarvis/deepseek-agent-loop-v2.ts` | Jarvis tool loop | DeepSeek `v4-flash` default | direct streaming; outer timeout helper and tool limits | local aggregate usage, latency, incidents | possible customer/booking context |
| `src/lib/jarvis/deepseek-agent-loop.ts` | legacy Jarvis loop | DeepSeek `v4-flash` default | direct; bounded turns | none | possible customer/booking context |
| `src/lib/jarvis/rag/indexer.ts` | RAG title/summary and embedding | Gemini `2.5-flash`, `embedding-001` | direct HTTP; 8s/10s | none | internal document content |
| `src/lib/jarvis/rag/retriever.ts` | RAG embedding/rerank | Gemini `embedding-001`, `2.5-flash` | direct HTTP; no candidate-local deadline found | none | query and retrieved internal snippets |
| `src/lib/ktkg-extractor.ts` | PII-redacted Kakao graph extraction | DeepSeek `v4-pro` default | direct; bounded retry | no shared OTel | input contract says PII-redacted, but chat remains sensitive |
| `src/lib/llm-cross-validator.ts` | independent extraction validation | Gemini `2.5-flash` default | direct SDK but shared traced wrapper; bounded retries | **shared OTel** tokens/latency | supplier/product source data |
| `src/lib/llm-gateway.ts` | common task gateway | DeepSeek primary/advisor, Gemini fallback, optional Claude | DB runtime policy then env/code; 60s client plus task deadline; provider-diversity rules | **shared OTel** tokens/cache/latency | task-dependent; prompt content not traced |
| `src/lib/llm-retry.ts` | retry utility documentation | no provider invocation in this file | example-only regex match | none | none |
| `src/lib/llm-validate-retry.ts` | validate/retry utility documentation | no provider invocation in this file | example-only regex match | none | none |
| `src/lib/multimodal-sdk.ts` | STT/multimodal helpers | Clova STT `latest_long`; Gemini `2.0-flash` | direct external HTTP; no common AI policy | none | audio/image can contain PII |
| `src/lib/normalize-with-llm.ts` | product normalization | DeepSeek `v4-pro` default | direct; explicitly no Gemini/Claude fallback in registration | local usage/cache and learning record | supplier/product source data |
| `src/lib/parser.ts` | product document parsing | common gateway plus direct Gemini `2.5-flash` vision/text fallback | mixed: gateway primary and direct Gemini fallbacks; deterministic regex fallback | partial/local provider usage | uploaded supplier documents; possible incidental PII |
| `src/lib/passenger-extractor.ts` | passenger extraction | DeepSeek `v4-flash` | direct, bounded retries | none | **critical PII**: raw passenger/passport fields |
| `src/lib/rfq-ai.ts` | group RFQ interview/translation | Gemini `2.5-flash` HTTP | direct; mock fallback when key absent; PII mask on communication paths | none | customer/group and supplier conversation |

## Findings

1. A provider switch and a runtime switch are currently conflated in many places. Codex subscription work is a Runtime, not another value to force into `AiProvider`.
2. The common policy exists but is not universal. New Agent Office roles must enter through one Runtime Adapter boundary; legacy call sites are strangled gradually, not rewritten in bulk.
3. Telemetry coverage is file-based and allows 28 grandfathered candidates. PR-01 must not increase that list.
4. Usage exists in several incompatible shapes: OTel attributes, local returned counters, generation ledgers, and DB cost rows. `agent_runs` should receive normalized totals only after source reconciliation.
5. High-PII callers must not be used as the first Codex Runtime pilot. `research.technology_scout` is intentionally public-source/read-only.
6. Blog publication remains isolated. Its champion, models, budget rows, evidence, and zero-fallback policy cannot inherit a generic runtime route.

## Target Runtime Contract

The first adapter surface is deliberately smaller than the durable envelopes:

```ts
interface AgentRuntimeAdapter {
  health(): Promise<RuntimeHealth>;
  start(input: RuntimeStartInput): Promise<RuntimeResult>;
  cancel?(runId: string): Promise<RuntimeCancelResult>;
}
```

`resume`, streaming, subagent control, write tools, and Production credentials are excluded from Foundation. `cancel` is optional and cannot be implemented by directly rewriting Task status.

```ts
type AgentRuntimeRequest = {
  runId: string;
  roleKey: string;
  taskKey: string;
  taskContractVersion: string;
  toolProfileVersion: string;
  inputArtifactRefs: string[];
  budgets: {
    maxElapsedMs: number;
    maxTurns: number;
    maxToolCalls: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxCostUsd: number | null;
  };
};

type AgentRuntimeReceipt = {
  runId: string;
  runtimeKey: string;
  runtimeVersion: string;
  providerKey: string | null;
  modelKey: string | null;
  outputArtifactRef: string | null;
  outputHash: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    elapsedMs: number;
    costUsd: number | null;
  };
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'orphaned';
  errorCode: string | null;
};
```

Provider credentials, raw prompts, raw tool arguments, and raw model output are not part of either durable contract.

## PR-01 Boundary

- Add a read-only Agent Office Runtime Adapter and existing-provider adapter interface.
- Add Codex only as an isolated, manually invoked read-only worker.
- Keep `AiProvider` and `system_ai_policies` unchanged initially.
- Do not migrate Blog Writer, passenger, passport, invoice, payment, booking, or customer-write lanes.
- Require a fixed Technology Scout eval before any runtime promotion.
