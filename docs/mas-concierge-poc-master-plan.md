# 여소남 OS — MAS 재설계 + 2주 Concierge PoC 실행안 (코드베이스 맞춤)

## 1) 결론

여소남 OS는 이미 `resolveSpecialist`, `v2-dispatch`, `response-critic`, `agent_actions`, `platform_learning_events`를 갖춘 **초기 MAS** 상태다.  
따라서 이번 설계의 핵심은 "새 프레임워크 도입"보다 **권한/승인/관측/복구 체계를 프로덕션 수준으로 보강**하는 것이다.

---

## 2) 외부 50개 제안의 코드베이스 적합성 필터

### A. 즉시 채택 (PoC에 바로 포함)

- 메모리 단·장기 분리 + 비동기 요약 (1, 4, 7)
- 공유 `task_context` 스키마 (2)
- PII 프록시 마스킹 강제 (6)
- 테넌트 격리/망각 API (8, 9)
- Prompt Injection 전처리 차단 (13)
- Circuit Breaker + Backoff (14, 39)
- Tool payload 타입 검증 강화 (12, 33)
- 속도 제한/비용 예산 (17)
- HITL freeze/resume 상태 전이 (21, 23)
- Dead Letter Queue 개념의 실패 큐 (24)
- 비동기 워커 분리 (26)
- Shadow mode (30)
- OpenTelemetry trace_id (37)
- Tool 실행 상태 스트리밍 UI (38)
- RAG 자동 평가 + 릴리즈 게이트 (41, 50)
- 프롬프트 버전 관리 레지스트리 (42)
- 사용자 피드백(thumbs) 수집 (44)
- 에이전트별 비용 대시보드 (45)
- 드리프트 알람 (46)
- 불변 감사 로그 강화 (47)

### B. 조건부 채택 (PoC 이후 단계)

- GraphRAG (3): 현재는 비용/복잡도 대비 과함. 대신 구조화 facts + 관계 필드로 시작
- Semantic cache 100% 절감 (5): 우선 FAQ hot cache만 적용
- Constitutional rules (16): Critic prompt에 도메인 헌법 주입으로 먼저 적용
- HHEM groundedness 실시간 점수 (18): 배치 평가로 먼저 시작
- 동적 모델 라우팅 프록시 (35): 현재 `llm-gateway` 라우팅 개선으로 대체
- Tool-level STS (36): 내부 JWT 기반 scoped action token으로 1차 구현
- Agent 메시징 ACL 표준 (27): JSON envelope 필드 표준화로 축소 적용
- 장기 워크플로우 Temporal급 구현 (28): DB state + cron wake-up으로 시작
- VIP 우선 라우팅 (29): 고객 등급 기반 queue priority로 축소 적용
- 단일 Agent BFF (40): 산재 REST를 점진적으로 `agent-executor` 경유로 통합
- A/B 자동 승격 (43): 수동 승인 + 반자동 승격부터
- 자동 레드팀 (48): 스크립트 기반 고정 시나리오로 먼저 시작
- TTFT 모니터링 (49): `agent_picked`~first token 시각부터 계측

### C. 보류/비채택 (현 단계 부적합)

- StreamingLLM attention sink (10): 현재 대화 길이/워크로드에서 우선순위 낮음
- 코드 생성 실행 샌드박스 (19): 현재 Concierge PoC 범위에 불필요 (추후 데이터 파이프라인 시 재검토)
- OpenAPI 동적 툴 바인딩 (31): 안정성 저하 위험. allowlist 기반 정적 도구 유지

---

## 3) 목표 아키텍처 (PoC 범위)

### 런타임 축

1. `Supervisor-lite`  
   - 입력 분류 + risk score + 담당자 배정
2. `Concierge`  
   - 고객 응대, 추천, FAQ, escalation 제안
3. `Critic`  
   - 근거성/정책 위반 점검 + block/gate
4. `Gate`  
   - 고위험 액션 freeze → 승인 후 resume
5. `Executor`  
   - tool allowlist + payload schema + idempotency

### 데이터 축

- 기존 유지: `conversations`, `intents`, `qa_inquiries`, `platform_learning_events`, `agent_actions`
- 신규 추가:
  - `agent_tasks` (요청 단위 상태머신)
  - `agent_approvals` (승인/거절/만료)
  - `agent_incidents` (환각·정책위반·실패)
  - `agent_trace_spans` (TTFT/latency 추적)

### 보안 축

- 입력 레벨 injection/PII 필터
- 툴 실행 전 스키마 검증(Zod)
- 액션별 risk 기반 승인 강제
- rate limit + token budget

---

## 4) 2주 Concierge PoC — 티켓 20개

## Week 1 — 안전한 실행 뼈대

### T01. task/approval/incident 스키마 추가
- 경로: `supabase/migrations/20260504xxxx00_agent_tasking_core.sql`
- 변경: `agent_tasks`, `agent_approvals`, `agent_incidents`, 인덱스/제약/RLS
- 완료 기준: 로컬 타입 생성 시 신규 테이블 반영, RLS 정책 통과

### T02. Supabase 타입 반영
- 경로: `src/types/supabase-database.generated.ts`
- 변경: 신규 테이블 타입 반영
- 완료 기준: 타입 에러 0

### T03. task envelope 타입 표준화
- 경로: `src/lib/agent/envelope.ts` (신규)
- 변경: `performative`, `task_context`, `risk_level`, `correlation_id`
- 완료 기준: 컴파일 통과, 단위 테스트 추가

### T04. Supervisor-lite 라우팅기
- 경로: `src/lib/jarvis/supervisor-lite.ts` (신규)
- 변경: 기존 `prepareDispatch` 앞단에 risk scoring + agent pick
- 완료 기준: 샘플 30문장 라우팅 스냅샷 테스트

### T05. Risk scorer
- 경로: `src/lib/jarvis/risk-scorer.ts` (신규)
- 변경: `low/medium/high/critical` 판정 규칙
- 완료 기준: 결제/환불/가격변경 케이스 high 이상 보장

### T06. Freeze/Resume 상태머신
- 경로: `src/lib/agent/task-machine.ts` (신규)
- 변경: `queued -> running -> frozen -> resumed -> done/failed/expired`
- 완료 기준: 전이 유효성 테스트

### T07. 승인 게이트 API
- 경로: `src/app/api/agent/approvals/[id]/route.ts` (신규)
- 변경: approve/reject + 감사로그 기록
- 완료 기준: 승인 시 task resume 이벤트 생성

### T08. Prompt injection 필터
- 경로: `src/lib/guardrails/prompt-injection.ts` (신규), `src/app/api/qa/chat/route.ts`
- 변경: 금칙 패턴/시맨틱 규칙 적용 후 block/escalate
- 완료 기준: 악성 프롬프트 테스트 통과

### T09. PII redaction 프록시 강제
- 경로: `src/lib/message-redact.ts`, `src/app/api/qa/chat/route.ts`, `src/app/api/jarvis/stream/route.ts`
- 변경: LLM 입력 전 마스킹 확정, 원문 미전달 보장
- 완료 기준: 여권/카드 패턴이 LLM 프롬프트에 존재하지 않음

### T10. Zod payload 검증 루프
- 경로: `src/lib/agent-action-executor.ts`, `src/lib/jarvis/agents/*.ts`
- 변경: 툴별 schema validate 실패 시 자동 교정 재요청
- 완료 기준: 잘못된 타입 입력 시 DB write 차단

## Week 2 — 운영/관측/평가

### T11. Circuit breaker + retry/backoff 공통 모듈
- 경로: `src/lib/resilience/circuit-breaker.ts` (신규), `src/lib/llm-retry.ts`, 외부 API 호출부
- 변경: 연속 실패 시 open, 지수 백오프
- 완료 기준: 실패 시 무한 재시도 없음

### T12. Rate limit + token budget
- 경로: `src/lib/simple-rate-limit.ts`, `src/app/api/qa/chat/route.ts`, `src/app/api/jarvis/stream/route.ts`
- 변경: 세션/아이피 단위 budget 초과 차단
- 완료 기준: 임계 초과 시 429 + 안내

### T13. Shadow mode 플래그
- 경로: `src/app/api/qa/chat/route.ts`, `docs/env-variables-reference.md`
- 변경: `AI_SHADOW_MODE=true` 시 사용자 미노출, 내부 로그만 기록
- 완료 기준: 관리자에서 AI 제안과 실제 답변 비교 가능

### T14. 핸드오프 observer 모드
- 경로: `src/app/api/qa/chat/route.ts`, `src/lib/customer-journey.ts`
- 변경: 사람 상담 개입 시 AI 자동응답 중지
- 완료 기준: handoff 상태에서 AI 발화 없음

### T15. TTFT + trace_id 계측
- 경로: `src/lib/telemetry/agent-tracing.ts` (신규), `src/app/api/jarvis/stream/route.ts`, `src/app/api/qa/chat/route.ts`
- 변경: `agent_picked`~first token 지연 수집
- 완료 기준: trace_id로 요청 체인 조회 가능

### T16. agent incidents 기록
- 경로: `src/lib/agent/incidents.ts` (신규), Critic/Gate/Executor 연결부
- 변경: hallucination, policy_violation, timeout 기록
- 완료 기준: `/admin`에서 최근 incident 조회

### T17. 사용자 피드백(👍/👎) 수집
- 경로: `src/components/customer/ChatWidget*`, `src/app/api/qa/feedback/route.ts` (신규)
- 변경: 응답별 rating 저장 + incident 연계
- 완료 기준: 싫어요 응답이 학습 이벤트로 적재

### T18. 평가 스크립트 (오프라인 100문항)
- 경로: `scripts/eval-concierge.mjs` (신규), `tests/evals/concierge-set.jsonl` (신규)
- 변경: groundedness/정확도/정책위반 자동 채점
- 완료 기준: 점수 리포트 JSON 생성

### T19. CI release gate
- 경로: `.github/workflows/concierge-eval-gate.yml` (신규)
- 변경: eval 점수 기준 미달 시 실패 처리
- 완료 기준: threshold 미달 커밋 배포 차단

### T20. 운영 문서/런북 마감
- 경로: `docs/mas-concierge-runbook.md` (신규), `docs/deploy-checklist.md`
- 변경: 장애 대응, kill switch, 승인 흐름, 롤백 절차
- 완료 기준: 비개발자 운영자가 문서만으로 대응 가능

---

## 5) 이행 순서 (반드시 이 순서)

1. 데이터 모델(T01~T02)
2. 상태/권한 코어(T03~T07)
3. 입력/출력 가드레일(T08~T10)
4. 복원력/제어(T11~T14)
5. 관측/학습/품질게이트(T15~T20)

---

## 6) PoC 성공 기준

- CS 자동응답의 환각 차단율 95% 이상
- 고위험 액션 무승인 실행 0건
- TTFT p95 2.5초 이하
- 수동 개입률 주차별 감소
- 배포 전 eval gate 통과율 95% 이상

---

## 7) 다음 단계 (PoC 이후)

- Procurement Agent를 동일 task/approval 프레임에 탑재
- Growth Agent는 비동기 워커 + A/B 실험 자동 승격으로 확장
- GraphRAG/동적 모델 라우팅은 비용 대비 효과 검증 후 도입
