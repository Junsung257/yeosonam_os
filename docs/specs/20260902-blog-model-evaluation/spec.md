# Spec: guarded blog model evaluation

- [x] Promptfoo is pinned to 0.122.2 and the V5 33-fixture file is hash-pinned.
- [x] DeepSeek remains champion; one NIM and one OpenRouter concrete model are fixed.
- [x] Dynamic/free/latest model routers and provider fallbacks are blocked.
- [x] Execution is concurrency 1 with a 60-second timeout and at most two HTTP 429 retries.
- [x] Three smoke fixtures gate two complete 33-fixture runs.
- [x] Raw outputs are private and commit-safe output is aggregate/hash/cost/decision only.
- [x] Production provider policy, DB enum, publishing, and customer APIs are unchanged.
- [x] Zapier, FluidVoice, Conductor, Bytez, and Headcount decisions are fail-closed.
- [ ] An authorized operator supplies provider credentials and explicit cost confirmation.
- [ ] Live smoke and two full runs produce a reviewed aggregate summary.
