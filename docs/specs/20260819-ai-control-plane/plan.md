# Plan: AI Control Plane P0

1. DeepSeek durable blog 호출을 하나의 control-plane adapter로 연결한다.
2. reserve/receipt/idempotency/retry-owner 계약과 direct-call static guard를 테스트한다.
3. migration manifest와 rollback hash를 검증하고, production apply·credential provisioning·enablement는 별도 승인으로 남긴다.
4. Blog V4 release gate와 type-check/lint/build evidence를 기록한다.

이 계획은 provider fallback, production 환경변수 변경, migration apply를 포함하지 않는다.
