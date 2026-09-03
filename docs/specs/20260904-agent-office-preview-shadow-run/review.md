# 검토

## 구현된 것

- 실행 route는 Production 또는 토글 미설정·Supabase 미구성·`agent_runs` 미적용
  상태에서 Task를 만들기 전에 차단한다.
- 요청은 30개 pinned fixture의 `caseId`만 허용하며 URL·Prompt·Tenant를 받지 않는다.
- 기존 `agent_tasks`가 업무 상태의 권위이고 `agent_runs`는 shadow evidence로만 남는다.
- Runtime child는 allowlisted env, ephemeral thread, no tools, no network,
  task-bound short-lived read-only capability를 사용한다.
- 결과는 content hash와 `shadowOnly` marker를 가진 기존 `result_payload`에 저장한다.

## 남은 위험/운영 조치

- 현재 Production에는 `agent_runs` migration을 적용하지 않는다.
- 실제 Codex 모델 20건, 동일 입력 3 trial, 사람 Review 영수증이 쌓이기 전에는
  Pilot을 전체 활성화하지 않는다.
- `result_payload`는 KPI·Retry·Authorization·Command 권위로 승격하지 않는다.
