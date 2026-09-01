# Verification: guarded blog model evaluation

```bash
npm run check:blog-model-eval
npm run eval:blog-model:preflight
npm run eval:blog-editorial:promptfoo
npm run audit:llm-telemetry:ci
npm run lint:secrets:all
npm run generate:system-inventory
npm run check:harness
```

The preflight makes zero provider calls and reports only whether each credential is
present. The live command additionally requires:

```bash
npm run eval:blog-model:live -- --confirm-cost BLOG_MODEL_EVAL_V1
```

Do not run the live command without operator cost authorization. Do not promote a
summary unless all raw files remain in the private ignored directory and the explicit
`COMMIT_AGGREGATE_ONLY` scrubber succeeds.

Current preflight result: Promptfoo live CLI not installed, all three provider keys
absent, live calls 0. The unchanged offline V5 assertion still passes 33/33 through
`check:blog-model-eval`; this is not represented as a live-model result.
