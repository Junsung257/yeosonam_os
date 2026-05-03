# 여소남 OS — Concierge MAS 운영 런북

## 1) 목표

- 고객 응대 자동화는 유지하되, 고위험 요청은 반드시 승인 게이트로 정지(freeze)한다.
- 장애 시 즉시 안전 모드로 전환해 오답 확산을 막는다.

## 2) 운영자가 보는 핵심 API

- `GET /api/admin/agent/tasks` : 작업 상태 조회
- `GET /api/admin/agent/approvals` : 승인 대기/이력 조회
- `GET /api/admin/agent/incidents` : 사고/위반 로그 조회
- `POST /api/agent/approvals/[id]` : 승인/반려 처리

## 3) 즉시 대응 체크리스트

1. `critical` incident 급증 여부 확인 (`/api/admin/agent/incidents?severity=critical`)
2. `frozen` task 적체 확인 (`/api/admin/agent/tasks?status=frozen`)
3. 승인 대기 SLA 확인 (`/api/admin/agent/approvals?status=pending`)
4. 필요 시 `AI_SHADOW_MODE=true`로 즉시 전환

## 4) 장애 모드 전환

- `AI_SHADOW_MODE=true`
  - 고객에게는 점검 메시지 + 에스컬레이션 안내만 노출
  - 내부적으로는 trace/incident는 계속 기록

## 5) 승인 정책 (요약)

- `high`, `critical` 요청: 자동 실행 금지
- 승인 전 상태: `frozen`
- 승인 후: `resumed`
- 반려 시: `cancelled`

## 6) 배포 게이트

- GitHub Actions `Concierge Eval Gate` 통과 필수
- 기준: `CONCIERGE_EVAL_THRESHOLD` 미만 시 배포 차단

## 7) 복구 후 점검

1. 최근 1시간 incident 감소 확인
2. `failed` task 재처리 여부 확인
3. TTFT/응답 지연 회복 여부 확인
4. 승인 대기열 정상화 확인

