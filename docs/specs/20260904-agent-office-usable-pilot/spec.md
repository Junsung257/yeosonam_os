# AI 운영실 사용 가능 Pilot 단계

## 결과

기존 `agent_tasks`/approval/trace 원장을 계속 권위로 유지하면서, 운영자가 `/admin`에서
운영실을 열고 Technology Scout의 계약 검증·런타임 호환성·차단 사유를 확인할 수 있게 한다.
Codex App Server는 실제 모델 턴을 시작하지 않는 프로토콜 attestation으로만 확인한다.

## 범위

- `/api/admin/agent/office/pilot-readiness` 읽기 전용 상태 API
- `/admin/agent-mas` Pilot readiness 패널
- 현재 Codex App Server의 read-only/ephemeral/no-network 호환성 attestation
- 30건 offline contract fixture 상태와 live pilot 승인 게이트 표시
- `agent_runs` Production migration·worker·Command·외부 Write는 포함하지 않음

## 안전 경계

- platform_admin만 API와 화면을 볼 수 있다.
- API는 DB 쓰기, task 생성, runtime start, 외부 네트워크 호출을 하지 않는다.
- attestation은 `thread/start`까지만 호출하고 `turn/start`는 절대 호출하지 않는다.
- raw prompt, account identity, token, tool arguments, PII를 응답·trace에 포함하지 않는다.
- live pilot은 공식 출처 20건/3 trial/사람 검토/preview migration 등 별도 게이트를 모두 통과하기 전에는 차단한다.
