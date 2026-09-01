# Review: guarded blog model evaluation

## Evidence

- Promptfoo package and lock both pin `0.122.2`.
- Frozen fixture SHA-256 is `b86c6a073cad8e4cd045e874bdaf1267fdccaab9ba78f0658e62d28001870032` and resolves to exactly 33 cases.
- Smoke is the existing food-budget pass, unanswered negative, and dishonest-source negative trio.
- Provider code contains no Supabase or production provider-switch dependency.
- DeepSeek uses the official `/chat/completions` endpoint, a 1,200-token ceiling, and explicit non-thinking mode to match the production V5 judge.
- The OpenRouter request fixes `openai/gpt-oss-120b` and disables provider fallback.
- Child-process tests verify unrelated application and provider credentials are excluded.
- Offline contract check passes the unchanged V5 fixtures 33/33.
- New provider, assertion, retry, scrubbed-summary, and cost-nullability tests pass 10/10.
- Targeted ESLint and Node syntax checks pass for the changed execution files.
- LLM telemetry coverage and the all-files direct-secret audit pass.
- Full repository harness passes with 0 document findings, 30/30 deterministic contracts, and 20/20 harness tests.
- The live runner exits before any provider call without the exact cost confirmation, and summary promotion rejects a run directory outside the private evidence root.

## External evidence

- DeepSeek endpoint and model: https://api-docs.deepseek.com/
- NVIDIA hosted model and endpoint: https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1_5?nim=hosted
- OpenRouter concrete model: https://openrouter.ai/openai/gpt-oss-120b/pricing
- OpenRouter reproducibility guidance: https://openrouter.ai/docs/guides/routing/routers/latest-resolution
- Zapier Free allowance: https://help.zapier.com/hc/en-us/articles/32337438839565-What-s-included-in-Zapier-s-Free-plan
- Zapier MCP task rate: https://help.zapier.com/hc/en-us/articles/48308034391821-What-is-Zapier-MCP
- FluidVoice platform status: https://github.com/altic-dev/FluidVoice
- Conductor platform setup: https://www.conductor.build/docs
- Bytez hosted model endpoint: https://docs.bytez.com/http-reference/model/run

## Remaining gate

No provider credential or cost authorization was supplied to this worktree. No live
model call was made, so no quality winner or savings claim is recorded. The tracked
summary remains `not_run` and DeepSeek remains champion. The isolated Promptfoo CLI
is also not installed in this worktree; the preflight reports that fact without
installing anything automatically.
