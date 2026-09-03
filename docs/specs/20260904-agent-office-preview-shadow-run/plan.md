# 실행 계획

1. 기존 계약·Tasking·Run Ledger·Codex adapter를 조합한다.
2. 환경·migration·platform-admin을 실행 전 검사한다.
3. 고정된 30개 fixture 중 요청된 Case만 public artifact로 공급한다.
4. 실행 결과를 `agent_tasks.result_payload`에 `shadowOnly` 표식과 hash로 보존한다.
5. Unit·TypeScript·workflow contract·build 검증 후 PR을 만든다.
6. Preview migration 적용과 토글 활성화는 이 PR과 별도 운영 승인으로 둔다.
