# 2026-05-30 근거 기반 AI·UX/UI 마스터플랜 V2

## 결론

기존 마스터플랜은 좋은 1차 실행안이지만 “100점 설계”라고 부르기에는 기준이 더 높아야 한다. 2026년 최신 흐름을 반영하면 여소남 OS의 설계 중심은 단순 UX/UI 개선이 아니라 다음 문장으로 재정의된다.

> 고객은 AI로 여행을 발견하고, 신뢰할 수 있는 브랜드에서 예약하며, 운영자는 AI agent와 함께 일하되 모든 숫자·추천·자동 실행을 추적·설명·승인할 수 있어야 한다.

따라서 V2는 기존 계획을 다음 5개 원칙으로 재설계한다.

1. **Trust-first travel commerce**: AI 추천보다 예약 신뢰가 먼저다.
2. **Agentic ERP with human control**: AI가 제안하고, 사람은 근거를 보고 승인한다.
3. **Evidence-backed dashboards**: KPI는 산식·출처·시점·drilldown이 있어야 한다.
4. **Accessible dense UX**: 모바일/데스크탑 모두 WCAG 2.2 기준의 focus/target/keyboard를 만족한다.
5. **Continuous verification**: 전수조사는 일회성이 아니라 CI와 운영 대시보드에서 반복된다.

## 근거 자료와 설계 반영

### 1. 여행 AI 트렌드: 탐색은 AI, 예약은 신뢰

Expedia Group의 2026 AI Trust Gap 조사에 따르면 AI는 여행 discovery를 바꾸고 있지만, 실제 booking은 여전히 trust가 결정한다. Booking.com의 2026 Travel Predictions는 ultra-personalized journey와 AI-powered suggestions 수용성을 강조한다. Klook Travel Pulse는 젊은 여행자의 social media 기반 탐색과 experience 소비 확대를 보여준다. Airbnb의 2025 Summer Release도 숙박을 넘어 services/experiences로 확장했다.

설계 반영:

- 프론트는 “AI 추천”을 전면에 내세우되, 예약 CTA 주변에는 신뢰 근거를 더 강하게 배치한다.
- 상품상세의 핵심 순서는 `가격/출발일 → 포함·불포함 → 호텔/항공/일정 → 후기·검증 → 취소/환불 → CTA`로 고정한다.
- 추천 이유는 “AI가 추천함”이 아니라 `예산`, `출발월`, `여행 스타일`, `후기`, `가격 안정성`, `일정 난이도` 같은 사람이 검증 가능한 근거로 표시한다.
- social proof는 조작감 있는 숫자보다 실제 후기, 최근 문의, 잔여석/출발 확정 같은 검증 가능한 상태만 쓴다.
- 여행 경험 트렌드에 맞춰 패키지 상세에 `의미 있는 경험`, `현지 체험`, `가족/효도/커플/액티비티 적합도`, `JOMO/힐링/미식/야간경험` 태그를 데이터 기반으로 노출한다.

### 2. Agentic AI 트렌드: 자동화보다 governance

Gartner는 2026년까지 enterprise app의 task-specific AI agent 채택이 급증할 것으로 전망하고, agentic AI governance/security/FinOps를 주요 이슈로 본다. IBM은 기업 AI가 goal setting, progress validation, human approval 구조로 이동한다고 설명한다. Microsoft Copilot Studio는 trust, traceability, transparency를 enterprise agent의 기본으로 둔다. SAP Fiori AI/Joule 가이드는 transparency, explainability, user control, human oversight를 AI UX 원칙으로 제시한다.

설계 반영:

- 자비스/QA/자동화는 “챗봇”이 아니라 `agent action system`으로 설계한다.
- 모든 AI 제안은 `근거`, `사용 데이터`, `영향 범위`, `예상 변경`, `위험`, `취소 가능 여부`를 보여준다.
- AI 액션은 권한별로 `suggest-only`, `draft`, `execute after approval`로 분리한다.
- AI 비용 대시보드는 단순 비용이 아니라 `승인율`, `반려율`, `실패율`, `절약 시간`, `비용/처리건`을 KPI로 둔다.
- AI가 만든 카피/상품/정산/추천은 미검증 claim 수를 보여주고, 사람이 반려한 사유를 학습 이벤트로 저장한다.

### 3. Enterprise dashboard 트렌드: 숫자는 출처와 action이 있어야 한다

SAP Fiori, Microsoft Fluent, Atlassian형 enterprise UX는 dense but readable, task-oriented, role-based navigation, transparent status를 공통으로 가진다. 여소남의 `/admin`은 이미 확정매출/신규예약 분리, Booking Pace, 정산, AI 비용, Take Rate, 재방문, 데이터 품질이 있으므로 “더 많은 카드”가 아니라 “믿을 수 있는 카드”가 다음 과제다.

설계 반영:

- 모든 KPI는 `basis`, `source`, `loadedAt`, `lastSuccessfulAt`, `stale`, `drilldownUrl`을 가진다.
- 대시보드 첫 화면은 다음 순서로 고정한다.
  1. 긴급 처리: D-7 미납, 미매칭 입금, 여권 만료, 정산 overdue, AI 실패.
  2. 경영 KPI: 확정매출, 신규예약, 마진, 미수금, 진행 예약, 자본.
  3. 운영 리스크: Booking Pace, 취소율, 정산 aging, 데이터 품질.
  4. 분석: Take Rate, 재방문, ROAS, 검색광고, SNS, AI 성과.
- `/api/dashboard`와 `/api/agent-actions`는 6초대 병목이므로 대시보드 전용 light endpoint 또는 DB view/RPC로 전환한다.
- V1 직접 합산과 V4 회계/영업 분리 KPI가 화면에서 섞일 때는 라벨을 명확히 한다.

### 4. WCAG 2.2 접근성: 모바일/데스크탑 모두 품질 기준

W3C WCAG 2.2는 focus appearance와 target size 같은 실제 조작성 기준을 강화한다. 어드민 ERP는 장시간 반복 작업 화면이므로 접근성은 법적/윤리적 기준을 넘어 생산성 기준이다.

설계 반영:

- 모바일 터치 주요 액션은 44px 이상, 최소 target size는 WCAG 2.2 기준을 만족하도록 검사한다.
- focus ring은 sticky header, sidebar, modal, drawer에 가려지지 않아야 한다.
- chart는 색상만으로 의미를 전달하지 않고 표/텍스트 요약을 제공한다.
- 모든 icon-only button은 accessible name과 tooltip을 가진다.
- `lint:a11y`, Playwright keyboard navigation, contrast/target audit를 release gate로 둔다.

### 5. AI explainability 연구: 설명은 “모델 내부”가 아니라 사용자 행동에 맞아야 한다

Human-centered XAI 연구와 2026 AI UX 논의는 explainability가 사용자 신뢰, decision accuracy, cognitive load에 영향을 준다고 본다. 즉 여소남의 AI 설명은 기술 설명이 아니라 운영자가 결정을 내리는 데 필요한 설명이어야 한다.

설계 반영:

- 추천 설명은 3단계 progressive disclosure:
  - Level 1: 한 줄 이유.
  - Level 2: 근거 데이터 3개.
  - Level 3: 원본 row/문서/로그 링크.
- 반려/수정 UI는 AI feedback loop로 저장한다.
- “AI confidence 87%”보다 “원본 5개 중 4개 근거 일치, 미검증 claim 1개”처럼 행동 가능한 설명을 우선한다.
- agent가 스스로 안전하다고 말하는 구조를 믿지 않고, 별도 audit layer가 실행/비실행/숨긴 경고를 기록한다.

## 100점 기준 재정의

100점은 “자료를 많이 참고했다”가 아니다. 다음 12개 조건이 모두 충족되어야 한다.

1. 공개 핵심 페이지가 모바일/데스크탑에서 500/404/overflow 없이 동작한다.
2. 상품상세에서 가격, 일정, 포함/불포함, 취소, 후기, CTA가 즉시 이해된다.
3. 추천/개인화는 왜 추천됐는지 설명 가능하다.
4. `/admin` 첫 화면은 오늘 처리할 일을 10초 안에 보여준다.
5. 대시보드 KPI는 산식·출처·시점·drilldown을 가진다.
6. admin API는 권한/tenant scope/PII 정책이 route별로 명확하다.
7. AI 액션은 근거, 영향 범위, 승인, 감사 로그를 가진다.
8. 고객 행동 이벤트 taxonomy가 있고 개선 효과를 측정할 수 있다.
9. 접근성은 WCAG 2.2 AA 실무 기준을 통과한다.
10. 상품/관광지/블로그 데이터 품질 gate가 publish 전에 막는다.
11. 성능은 모바일 저속망과 admin heavy page 모두에서 예산을 가진다.
12. 위 조건이 CI와 운영 대시보드에서 반복 검증된다.

## V2 개발 로드맵

### P0. Trust & Stability Sprint

목표: 깨짐, 느림, 신뢰 저하 요소 제거.

- live 500, `/concierge` mobile, CSP/Sentry, `keyword_performance_daily` 404, `/api/auth/refresh` 401 정리.
- `/admin` fetch를 `safeJson` + `Promise.allSettled` + per-widget state로 전환.
- `/api/dashboard`, `/api/agent-actions` light endpoint 추가.
- admin API auth 후보 21개 guard 재검증.
- PII/tenant/role matrix 작성.
- event taxonomy 초안 작성.
- critical public/admin smoke script 작성.

### P1. Customer Trust Commerce Sprint

목표: 고객 페이지를 AI discovery + trusted booking 구조로 재배치.

- 상품상세 정보 순서 재정렬.
- 모바일 sticky CTA 충돌 제거와 touch target 정리.
- 추천 이유/가격/출발확정/취소규정/후기 근거 강화.
- 상품목록 필터 URL 보존, 비교, 저장, 최근 본 상품 강화.
- 블로그/목적지에서 상품 CTA와 신뢰 정보 연결.
- placeholder/저품질 이미지 publish 차단.

### P2. Agentic Admin Sprint

목표: 어드민을 agentic ERP로 고도화.

- AI 제안 카드 표준: 근거, 위험, 영향, 승인, rollback.
- 자비스 action queue를 role-based approval system으로 정리.
- AI 비용 위젯을 agent ROI 위젯으로 확장.
- admin action log와 undo/dry-run 패턴 통합.
- system health와 AI/cron/external API 상태를 `/admin` 긴급 처리와 연결.

### P3. Evidence Dashboard Sprint

목표: 대시보드 숫자를 믿을 수 있게 한다.

- KPI meta 표준화: basis/source/loadedAt/stale/drilldown.
- `DashboardCard`, `MetricValue`, `KpiDelta`, `RiskBadge`, `DashboardSection` 도입.
- admin token 위반 제거: 임의 radius/shadow/hex/10px 텍스트.
- chart 대체 텍스트와 table view 제공.
- role dashboard: 사장님/CS/상품/마케팅/재무별 첫 화면.

### P4. Continuous Verification Sprint

목표: 100점 조건을 자동으로 지킨다.

- `audit-admin-dashboard-contract`.
- `audit-public-critical-pages`.
- `audit-admin-critical-pages`.
- `audit-admin-design-tokens`.
- `audit-event-taxonomy`.
- `audit-pii-surface`.
- Playwright desktop/tablet/mobile visual regression.
- Lighthouse/Core Web Vitals budget.
- WCAG/a11y release gate.

## 설계 변경점: 기존 마스터플랜 대비

| 영역 | 기존 | V2 |
|---|---|---|
| 여행 AI | 추천/개인화 강화 | AI discovery + trusted booking 분리 |
| 어드민 AI | 자비스/QA 개선 | agentic ERP, 승인/감사/rollback 중심 |
| KPI | 산식/출처 보강 | KPI meta를 데이터 계약으로 표준화 |
| 접근성 | 개선 항목 | WCAG 2.2 AA release gate |
| 이벤트 | taxonomy 필요 | UX 개선의 성공/실패 판정 기준 |
| 보안 | auth/PII 감사 | route-role-tenant-PII matrix |
| 검증 | smoke/visual 제안 | 100점 조건을 CI로 반복 검증 |

## 참고 자료

- Expedia Group, “AI Trust Gap” 2026.
- Booking.com, “The Era of YOU” 2026 Travel Predictions.
- Klook Travel Pulse 2025.
- Airbnb 2025 Summer Release.
- Gartner, agentic AI enterprise adoption and governance.
- IBM Think 2026 AI trends.
- Microsoft Copilot transparency/trust/traceability guidance.
- SAP Fiori AI and Joule Design Guidelines.
- W3C WCAG 2.2.
- Human-centered XAI / human-in-the-loop agentic systems research.

## 최종 판단

이 V2는 “100점에 가까운 설계 기준”이다. 하지만 완벽하다고 확정하려면 구현 후 실제 데이터로 검증해야 한다. 최종 100점 판정은 다음 실측이 통과될 때 가능하다.

- 모바일/데스크탑 critical page visual pass.
- 주요 API p95 latency budget pass.
- 전환 퍼널 개선.
- admin 처리 시간 감소.
- AI 제안 승인율/반려율/실패율 추적.
- PII/권한 감사 pass.
- WCAG/a11y critical issue 0.
- regression gate가 배포 전 자동 통과.
