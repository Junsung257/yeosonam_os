# Plan: guarded blog model evaluation

1. Pin the existing Promptfoo runtime and frozen V5 fixture hash.
2. Keep DeepSeek as champion and allow exactly two fixed challengers.
3. Implement a serial, timeout-bounded, two-retry 429 client with minimal secret forwarding.
4. Gate the two 33-case runs behind a 3-case smoke pass.
5. Keep raw results private and expose only aggregate/hash/cost/advisory decision.
6. Record the remaining external-tool adoption boundaries without installing them.
