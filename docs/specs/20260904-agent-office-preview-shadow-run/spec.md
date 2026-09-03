# Preview Technology Scout Shadow Run

## 결과

`research.technology_scout` 하나를 운영자가 직접 1건 실행할 수 있는 Preview 전용
경로를 추가한다. 실행은 기존 `agent_tasks` 업무 원장과 승인된 `agent_runs` Shadow
RPC를 재사용하고, 결과는 공개 근거 기반 Work Product로만 저장한다.

## 범위

- `POST /api/admin/agent/office/pilot/shadow` 수동 단일 Case 실행
- `GET` 동일 경로의 최근 Shadow 결과 메타데이터 조회
- Task 생성·Business idempotency·Run lease·Runtime start·결과 hash·Task 종료
- `/admin/agent-mas`에서 Preview 실행 잠금과 최근 결과 표시

## 금지

- Production 실행, DB migration 적용, 자동 위임, Queue/Cron dispatch
- Command/Approval/Publish/Payment/Booking/Customer/External Write
- 임의 URL·Prompt·Tenant 입력, raw prompt/PII 저장, 공유 관리자 토큰의 승인 주체 사용

## 게이트

Preview에서 `AGENT_OFFICE_SHADOW_PILOT_ENABLED=1`, `agent_runs` migration,
Supabase service credential, Codex App Server read-only attestation이 모두 필요하다.
Vercel Preview는 허용하지만 `VERCEL_ENV=production`은 항상 차단한다.
