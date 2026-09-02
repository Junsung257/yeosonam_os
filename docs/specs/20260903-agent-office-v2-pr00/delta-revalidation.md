# PR-00 delta-only revalidation

Revalidated: 2026-09-03

| Item | Value |
|---|---|
| Original audited baseline | `739647696b4568aded3fd765fd7db4122fa9be26` |
| Revalidated baseline | `754f739569d03c65fd8e1c1573e415c389b017f2` |
| Delta commits | `aa905716d` and `754f73956` |
| Delta size | 26 files, 1,225 insertions, 366 deletions |
| Scope | Blog programmatic refill and dispatch-ready private shadow proof |
| Agent Office Core decision | unchanged |

## Required five-surface review

| Surface | Delta evidence | Decision |
|---|---|---|
| Blog DeepSeek-only contract | `docs/blog-autopublish-contract.md` adds research-ready refill and dispatch-proof requirements. `src/lib/blog-deepseek-orchestrator-v4.ts` and the provider-policy core did not change. The former programmatic compatibility route no longer calls `llmCall`; it delegates to deterministic `promotePendingTopics()`. | **Preserved and strengthened.** Generic Runtime Adapter remains unable to override the Blog lane. |
| Inngest Event Inventory | `src/inngest/client.ts`, `src/inngest/index.ts`, and `src/inngest/functions/**` have no delta. The dispatcher still sends `blog/pipeline.requested` and reports `modelCalls: 0`; only candidate selection and shadow evidence verification changed. | **No event/function/schema/idempotency inventory change.** |
| LLM invocation inventory | The telemetry audit remains 30 candidate files, 2 shared-traced, 28 grandfathered, 0 new/stale. One gateway invocation was removed from `programmatic-seo-generator`; no provider/model caller was added. The audit remains file-pattern based and is not an exhaustive gateway call-site inventory. | **No new Runtime/Provider exposure; one legacy model call removed.** |
| Generated System Inventory | Repository script count changes from 335 to 336 through `scripts/verify-blog-shadow-generation-v4.ts`. API route, page, migration, and workflow counts are unchanged. | **Inventory refreshed; no Agent Office primitive added.** |
| Runtime/Provider Compatibility Matrix | `src/lib/ai-provider-policy.ts`, `src/lib/blog-deepseek-orchestrator-v4.ts`, current provider union, provider credentials, and policy precedence did not change. | **Compatibility decisions unchanged.** |

## Behavioral changes that matter to the future Foundation

- The legacy `programmatic-seo-generator` no longer creates model-generated title/intro hints or writes the queue through its own path. It uses the shared fail-closed promotion service.
- `blog-generate` reuses the same publishable-candidate selector as operations diagnostics before emitting the existing Inngest event.
- Protected release no longer treats event acceptance as sufficient shadow success. It must read back a private `approved_for_slot` run, approved attempt, unpublished creative, and zero indexing outbox side effects.
- These changes demonstrate a useful Foundation pattern: deterministic preconditions and read-back evidence around a shadow workflow. They do not authorize Agent Office to reuse Blog's domain tables or release workflow.

## Delta conclusion

The two commits are Blog-domain hardening. They do not add an Agent Office event, Role/Task registry, Run ledger, Runtime Adapter, Provider, Command, MCP, external Skill, or Office write surface. The original compatibility, threat, and rollout conclusions remain valid subject to the Foundation-only GO recorded in `review.md`.

No full PR-00 rerun was necessary. The fixed baseline for this packet is now `754f739569d03c65fd8e1c1573e415c389b017f2`.
