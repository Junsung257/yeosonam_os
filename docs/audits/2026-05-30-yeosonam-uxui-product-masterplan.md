# 2026-05-30 여소남 OS UX/UI·제품·운영 마스터플랜

## 목적

이번 세션에서 수행한 전수 감사, 코드베이스 검증, 최신 여행/ERP/AI UX 자료 검토, 어드민 대시보드 점검, 누락 리스크 재검토를 하나의 개발 계획으로 통합한다.

여소남 OS는 단순 여행몰이 아니라 랜드사 → 플랫폼 → 여행사/고객을 잇는 B2B2C 여행 SaaS다. 따라서 최종 목표는 “예쁜 화면”이 아니라 고객 전환, 운영 생산성, 데이터 신뢰, 권한/PII 안전성, AI 자동화의 신뢰를 동시에 끌어올리는 것이다.

## 이번 세션 산출물

- 공개 도메인 UX/UI 감사: `docs/audits/2026-05-30-www-yeosonam-uxui-audit.md`
- 라이브 페이지/CTA 감사 JSON 및 스크린샷: `docs/audits/2026-05-30-live-domain-page-audit.json`, `docs/audits/2026-05-30-live-domain-customer-cta-audit.json`
- 인증 어드민 감사: `docs/audits/2026-05-30-authenticated-admin-uxui-audit.md`
- UX/UI 전략 및 로드맵: `docs/audits/2026-05-30-uxui-strategy-and-roadmap.md`
- 코드베이스 강점 반영 검증: `docs/audits/2026-05-30-uxui-plan-codebase-verification.md`
- 어드민 ERP IA/UX 최적화: `docs/audits/2026-05-30-admin-erp-uxui-optimization.md`
- 프론트/백엔드/어드민 전수 최종 감사: `docs/audits/2026-05-30-full-stack-admin-final-audit.md`
- 대시보드 디자인·데이터 안정화 계획: `docs/audits/2026-05-30-admin-dashboard-design-data-plan.md`
- 놓친 리스크 재점검: `docs/audits/2026-05-30-missed-risks-and-total-plan.md`
- 대시보드 로컬 렌더 감사: `docs/audits/2026-05-30-admin-dashboard-local-render-audit.json`

## 현재 상태 요약

### 강점

1. 여행 상품 상세는 이미 후기 요약, 사회적 증거, 가격 카드, 추천 이유, 여행 적합도, 취소 요약, 하단 CTA, tracking 구조를 갖고 있다.
2. 상품 목록은 검색/필터/카테고리/비교 모달/추천 이유 구조가 있다.
3. 블로그/큐레이션/목적지 콘텐츠, 제휴/코브랜딩, 마일리지, 게이미피케이션, 자비스/QA, tracking API 등 성장 자산이 이미 많다.
4. 어드민은 `AdminLayout` 재정렬로 운영, 상품·공급, 영업·제휴, 재무, 마케팅·콘텐츠, AI·자동화, 시스템의 ERP형 IA에 가까워졌다.
5. `/admin` 대시보드는 확정매출과 신규예약을 분리하고, Booking Pace, 취소율, 정산, AI 비용, Take Rate, 재방문, 데이터 품질, 긴급 액션 보드를 이미 갖고 있다.
6. 디자인 토큰은 `admin-card`, `rounded-admin-*`, `shadow-admin-*`, `text-admin-*`, density 토큰까지 준비되어 있다.
7. `npm run lint`, `npm run type-check`, `npm run build`, `audit:api-drift`, `audit:select-cols`, `check:perf` 등 검증 도구가 이미 많다.

### 핵심 문제

1. 공개 도메인 일부 페이지의 500, 모바일 `/concierge` 깨짐, CTA 충돌, placeholder 이미지, H1 누락, CSP/Sentry 오류가 남아 있다.
2. 인증 어드민 감사에서 console issue, bad response, overflow, 일부 404/401/500 후보가 확인됐다.
3. `/admin` 대시보드는 기능은 많지만 일부 API가 6초대이고, 실패 격리가 완전하지 않다.
4. `/admin` 메인 대시보드 일부가 admin 토큰 대신 임의 radius/shadow/10px 텍스트/임의 색상을 사용한다.
5. admin API auth 후보, service role 사용, direct env 사용, RLS/tenant scope는 별도 보안 감사가 필요하다.
6. 이벤트 taxonomy가 명확히 고정되어 있지 않아 UX 개선 효과를 정량 비교하기 어렵다.
7. 접근성, 키보드, focus, target size, chart 대체 텍스트가 별도 품질 게이트로 묶여 있지 않다.
8. AI 기능은 많지만 근거, 검증, 승인, 비용 대비 효과 UX를 더 명확히 해야 한다.
9. 운영자 실수 복구, undo, dry-run, diff, per-row error 같은 ERP 안전장치가 화면마다 균일하지 않다.
10. 전수조사가 문서로는 남았지만, 계속 반복되는 자동 회귀 게이트로 완전히 묶이진 않았다.

## 마스터 원칙

1. 고객 화면은 가격, 일정, 조건, 신뢰, CTA를 가장 빠르게 이해시키는 구조로 만든다.
2. 어드민은 장식보다 밀도, 스캔성, drilldown, 즉시 처리, 실수 방지를 우선한다.
3. 모든 KPI는 산식, 출처, loadedAt, stale 여부, drilldown 없이 보여주지 않는다.
4. AI는 “대답”보다 근거, 미검증 claim, 승인 흐름, 비용 대비 효과를 보여준다.
5. 테넌트/권한/PII는 화면 단위 정책으로 관리한다.
6. 데이터 없음, 조회 실패, 권한 없음, stale, 부분 실패를 명확히 구분한다.
7. 디자인 토큰을 벗어난 임의 스타일은 점진적으로 제거한다.
8. UX 개선은 이벤트 taxonomy로 측정 가능해야 한다.
9. 상품/관광지/블로그 데이터 품질은 고객 UX의 일부로 본다.
10. “감사 완료”가 아니라 “감사가 자동으로 계속 도는 구조”를 목표로 한다.

## 개발 마스터플랜

### Phase 0. 안전화와 기준선 고정

목표: 지금 깨지는 것, 느린 것, 측정 불가능한 것을 먼저 멈춘다.

작업:

1. live 500 페이지, `/concierge` 모바일 깨짐, CSP/Sentry 오류, placeholder 이미지 우선 수정.
2. `/admin` 대시보드 fetch를 `Promise.allSettled` + safe JSON + 위젯별 error state로 전환.
3. `/api/dashboard`, `/api/agent-actions` 6초대 병목 분석 후 light endpoint 또는 view/RPC 추가.
4. `/api/auth/refresh` 401, `keyword_performance_daily` 404 같은 콘솔 노이즈 정리.
5. admin API auth 후보 21개 재검증 및 route별 guard matrix 작성.
6. 이벤트 taxonomy 초안 작성.
7. PII/tenant/role matrix 초안 작성.
8. 현재 전환, 문의, 예약, admin 처리 시간의 baseline 기간 설정.

검증:

- `npm run lint`
- `npm run type-check -- --pretty false`
- `npm run build`
- `npm run check:perf`
- 대시보드 endpoint contract smoke
- public critical pages smoke

### Phase 1. 고객 프론트 UX 전환 개선

목표: 여행 플랫폼 대형 서비스의 기본기인 탐색, 비교, 신뢰, 문의 전환을 강화한다.

작업:

1. 홈/상품목록/상품상세/컨시어지/RFQ/블로그/목적지 페이지의 H1, CTA, price/date/condition clarity 정리.
2. 상품 상세의 price card, 일정, 포함/불포함, 취소규정, 후기 요약, 여행 적합도 순서를 전환 기준으로 재배치.
3. 상품 목록에서 비교, 저장, 최근 본 상품, 추천 이유, 필터 URL 보존 강화.
4. 목적지/블로그/큐레이션 콘텐츠에서 상품 연결 CTA와 신뢰 정보 강화.
5. placeholder/저품질 이미지는 등록 품질 gate에서 차단.
6. 접근성: focus, target size, keyboard, image alt, chart/table 대체 텍스트 점검.

성과지표:

- 상품 상세 CTA 클릭률.
- lead submit rate.
- concierge message start rate.
- package compare open rate.
- RFQ start/complete rate.
- mobile bounce/scroll depth.

### Phase 2. 어드민 ERP UX 표준화

목표: 운영자가 매일 빠르게 처리하고 실수 없이 복구할 수 있는 업무 화면으로 만든다.

작업:

1. `/admin` 메인 대시보드 카드/폰트/색상/차트를 admin 토큰으로 통일.
2. `DashboardCard`, `MetricValue`, `KpiDelta`, `RiskBadge`, `DashboardSection` 공통 컴포넌트 도입.
3. 긴급 처리 → 경영 KPI → 운영 리스크 → 분석 → 바로가기 순서로 첫 화면 재정렬.
4. 고객, 예약, 결제, 상품, 관광지, 콘텐츠 목록에 공통 생산성 패턴 적용: 검색, 상태 필터, 날짜 필터, 저장된 뷰, URL query, bulk action, CSV export, column priority.
5. 위험 액션은 preview → diff → confirm → undo/dry-run 구조로 통일.
6. 모바일 sidebar overflow 노이즈 제거 및 mobile admin 핵심 플로우 재검증.

성과지표:

- admin first contentful useful state.
- 미매칭 입금 처리 시간.
- 상품 승인 처리 시간.
- 고객 문의 처리 시간.
- bulk action 실패율.
- undo/rollback 사용 건수.

### Phase 3. 데이터 신뢰·보안·권한 강화

목표: 숫자와 권한을 믿을 수 있게 만든다.

작업:

1. KPI마다 `basis`, `source`, `loadedAt`, `lastSuccessfulAt`, `stale`, `drilldownUrl` 표준화.
2. 확정매출/신규예약/마진/미수금/정산/AI 비용 산식 문서와 UI 도움말 연결.
3. PII 기본 마스킹: 고객명, 연락처, 여권, 결제, 상담 로그.
4. PII “보기” 액션은 admin activity log에 기록.
5. tenant scope와 role별 화면/route/API 권한 matrix 적용.
6. export/download/CSV에서 PII 최소화.
7. service role 사용 API를 route별로 분류하고, client 노출 위험 재감사.
8. PostgREST 1000 row cap 가능성이 있는 API는 range pagination 또는 count exact 비교로 통일.

성과지표:

- unauthorized/bad response 감소.
- PII view audit coverage.
- KPI stale warning 건수.
- API latency p95.
- drift audit warning 감소.

### Phase 4. AI·자동화 신뢰 UX

목표: AI가 “멋있게 보이는 기능”이 아니라 실제 운영 생산성을 높이는 승인형 시스템이 되게 한다.

작업:

1. 자비스/QA/상품 생성/마케팅 생성/정산 제안에 근거 링크와 원본 row 링크 제공.
2. AI 결과에 confidence 대신 검증된 근거 수, 미검증 claim 수, 사람 검토 필요 사유 표시.
3. suggest-only, draft, execute 권한을 role별로 분리.
4. AI action은 실행 전 diff와 dry-run 결과를 보여준다.
5. AI 비용은 모델별 비용뿐 아니라 성공률, 승인율, 실패율, 절약 시간 추정으로 확장.
6. AI 오류/환각/반려 사유를 platform learning events로 되먹임.

성과지표:

- AI 제안 승인율.
- AI 제안 반려 사유 TOP.
- AI 실행 실패율.
- AI 비용 대비 처리 건수.
- 사람 검토 후 수정률.

### Phase 5. 상품·콘텐츠 품질 게이트

목표: 고객 UX 문제를 원천 데이터 단계에서 막는다.

작업:

1. 상품 publish gate에 이미지, 가격, 출발일, 포함/불포함, 취소규정, 호텔/항공/관광지 매칭률, 고객 노출 금지 문구를 포함.
2. 관광지 사진/영문 alias/중복 설명/매칭률을 등록 단계에서 경고.
3. 블로그/목적지/SEO 페이지는 sitemap 포함 전 200/H1/meta/image/CTA 검증.
4. live domain synthetic monitor로 500, 404, CSP, H1, CTA, 모바일 overflow를 반복 검사.
5. post-register audit와 visual baseline을 상품 등록 완료 플로우에 더 강하게 결합.

성과지표:

- publish blocked/warnings 건수.
- 관광지 매칭률.
- placeholder image 비율.
- SEO 페이지 200 비율.
- 상품 상세 신뢰 정보 완성률.

### Phase 6. 자동 회귀 게이트와 운영 대시보드화

목표: 이번 감사가 일회성이 아니라 계속 유지되는 구조를 만든다.

작업:

1. `scripts/audit-admin-dashboard-contract.mjs`: 대시보드 8개 endpoint status, shape, latency 검사.
2. `scripts/audit-public-critical-pages.mjs`: 홈, 상품목록, 상품상세, 컨시어지, RFQ, 블로그, 목적지 검사.
3. `scripts/audit-admin-critical-pages.mjs`: dashboard, bookings, packages, payments, customers, upload, attractions, jarvis 검사.
4. `scripts/audit-admin-design-tokens.mjs`: admin 영역 임의 radius/shadow/hex/10px 텍스트 탐지.
5. `scripts/audit-event-taxonomy.mjs`: 정의되지 않은 event name 탐지.
6. `scripts/audit-pii-surface.mjs`: PII 필드 렌더/다운로드/API 응답 후보 탐지.
7. CI 또는 배포 전 체크리스트에 위 검사들을 단계적으로 연결.
8. `/admin/system-health`와 `/admin` 긴급 처리 영역에 감사 결과를 요약 표시.

성과지표:

- release마다 critical regression 0.
- visual overflow 0.
- endpoint contract fail 0.
- undefined tracking event 0.
- admin token violation 감소.

## 최우선 개발 순서

### 이번 주 P0

1. `/admin` 대시보드 fetch 안정화.
2. `/api/dashboard`, `/api/agent-actions` 응답시간 개선.
3. live 500/CSP/concierge mobile/keyword 404/auth refresh 노이즈 정리.
4. admin API auth 후보 21개 재검증.
5. 이벤트 taxonomy와 PII/권한 matrix 초안.
6. 대시보드/공개 핵심 페이지 smoke script 초안.

### 다음 2~3주 P1

1. `/admin` 대시보드 디자인 토큰화.
2. 공개 핵심 전환 화면 CTA/가격/일정/신뢰 정보 재배치.
3. 주요 admin list page 공통 패턴 적용.
4. 접근성 AA 기준 점검과 a11y 리포트 정리.
5. 상품/콘텐츠 publish gate 강화.

### 1~2개월 P2

1. 역할별 admin dashboard.
2. 고객 행동 기반 추천/개인화.
3. AI 근거·승인·비용 효과 UX 통합.
4. system health와 감사 결과 운영 대시보드화.
5. feature flag/A-B testing 운영화.

## 이번 세션에서 확인한 “아직 100%가 아닌 이유”

1. 일부 live 페이지 오류가 남아 있다.
2. 대시보드 API 일부가 6초대다.
3. 어드민 메인 디자인 토큰 일관성이 부족하다.
4. 접근성은 별도 게이트로 아직 묶이지 않았다.
5. 이벤트 taxonomy가 없으면 UX 개선 효과를 숫자로 증명하기 어렵다.
6. 권한/PII는 코드와 화면을 함께 보는 별도 감사가 필요하다.
7. AI 기능은 근거와 승인 UX를 더 강화해야 한다.
8. 전수조사 결과가 자동 회귀 게이트로 완전히 연결되지 않았다.

## 최종 판단

여소남 OS는 이미 많은 기능 자산을 갖고 있다. 그래서 새 기능을 무작정 더 만드는 것보다, 기존 자산을 “고객 전환”, “운영 처리”, “데이터 신뢰”, “자동 검증”의 흐름으로 재배치하는 게 가장 효율적이다.

이 마스터플랜의 첫 번째 성공 기준은 다음이다.

- 고객은 상품의 가격, 일정, 조건, 신뢰, 문의 방법을 즉시 이해한다.
- 운영자는 오늘 처리할 일을 첫 화면에서 바로 본다.
- 숫자는 산식과 출처를 설명할 수 있다.
- 권한과 PII는 화면/API/export 모두에서 안전하다.
- AI는 근거와 승인 흐름을 갖는다.
- 회귀는 사람이 기억하는 게 아니라 스크립트가 막는다.
