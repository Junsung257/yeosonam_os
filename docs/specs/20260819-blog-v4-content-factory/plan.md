# Plan: Blog V4 Durable Content Factory

1. verified demand를 immutable operation으로 materialize하고, representative/package snapshot을 pin한다.
2. durable workflow의 retry, fencing, DeepSeek attempt cap, quality repair, draft-only side-effect 계약을 검증한다.
3. publication controller와 indexing outbox를 generation readiness와 분리한다.
4. targeted/full Blog tests, type-check, lint, build, release exact-set, migration dry-run evidence를 기록한다.
5. production migration/deploy, environment mutation, automatic publication, push/merge는 별도 승인 게이트로 유지한다.
