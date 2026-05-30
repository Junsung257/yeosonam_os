# 2026-05-30 놓친 것 재점검 및 전체 보강 계획

## 결론

기존 감사는 공개 페이지, 어드민 IA, `/admin` 대시보드, API/빌드/성능까지 넓게 봤지만, 아직 “사용자가 말하지 않았지만 운영 제품이라면 반드시 봐야 하는 영역”이 남아 있다. 특히 여소남 OS는 단순 여행몰이 아니라 B2B2C 여행 SaaS라서 UX/UI만으로는 100점이 될 수 없다.

이번 보강 계획은 다음 10개 축을 추가한다.

1. 접근성·키보드·터치 목표 크기.
2. 이벤트 taxonomy와 전환 측정.
3. 테넌트/권한/PII 노출 최소화.
4. 운영자 실수 방지와 되돌리기.
5. 장애·부분 실패·오프라인 대응.
6. 데이터 freshness와 산식 신뢰.
7. AI 기능의 설명 가능성·승인 흐름.
8. 검색/필터/대량 작업 생산성.
9. 콘텐츠·상품 데이터 품질 운영.
10. 회귀 테스트와 배포 관문.

## 내가 놓쳤거나 더 강하게 봐야 했던 것

### 1. 접근성은 별도 P0로 봐야 한다

기존 계획은 폰트 크기와 색상을 봤지만, WCAG 2.2 관점의 keyboard flow, focus visibility, target size, focus not obscured까지 충분히 분리하지 않았다. 특히 어드민은 장시간 반복 사용 화면이라 접근성은 “사회적 배려”가 아니라 생산성/실수 방지다.

추가 계획:

- 모든 admin 주요 버튼/아이콘의 최소 클릭 영역을 24px 이상, 모바일/터치 주요 액션은 44px 이상으로 점검.
- focus ring이 sticky header, modal, sidebar에 가려지지 않는지 확인.
- chart는 색상만으로 의미를 전달하지 않고 텍스트/표 대체값을 함께 제공.
- `npm run lint:a11y`를 전체 리포트로 돌리고 P0/P1를 분리.

참고: W3C WCAG 2.2는 Focus Appearance, Target Size 등 새 기준을 포함한다.

### 2. “예쁜 대시보드”보다 “의사결정 로그”가 더 중요하다

대시보드가 숫자를 보여주는 데서 끝나면 운영자는 왜 숫자가 변했는지 모른다. 여행 SaaS에서는 매출, 취소율, 미수금, 제휴 정산, AI 비용이 모두 의사결정에 연결되므로 “왜 이 숫자인지”와 “어디서 왔는지”가 필요하다.

추가 계획:

- 각 KPI에 `basis`, `source`, `loadedAt`, `stale`, `lastSuccessfulAt` 표시.
- 확정매출/신규예약/마진/미수금은 drilldown 시 같은 필터가 적용된 목록으로 이동.
- 숫자 변경 시 “전월 대비”, “원인 후보”, “처리 필요 항목”을 함께 제공.
- KPI 산식 문서를 화면 도움말과 `docs/`에 연결.

### 3. 이벤트 taxonomy가 아직 제품 성장의 병목이다

트래킹 API와 attribution 테이블은 있지만, 모든 UX 개선이 같은 이벤트 언어로 측정되는지는 별도 검증이 필요하다. 고객 행동분석을 하려면 이벤트 이름, 속성, session/user/tenant 연결, UTM, ref, product id가 일관돼야 한다.

추가 계획:

- 이벤트 taxonomy를 `docs/analytics-event-taxonomy.md`로 정의.
- 고객 여정 핵심 이벤트를 고정: `package_view`, `price_expand`, `date_select`, `compare_open`, `lead_submit`, `rfq_start`, `concierge_message`, `checkout_start`, `booking_confirmed`.
- admin 이벤트도 고정: `admin_kpi_drilldown`, `admin_payment_match`, `admin_package_approve`, `admin_ai_action_approve`, `admin_bulk_retry`.
- 이벤트마다 owner, required props, PII 금지 필드, 성공/실패 기준을 둔다.
- 대시보드 개선 후 A/B나 전후 비교를 할 수 있게 baseline 기간을 먼저 잡는다.

### 4. 테넌트/권한/PII UX가 더 중요하다

이 레포는 멀티테넌시와 PII가 핵심이다. 디자인이 좋아도 권한이 틀리면 제품 신뢰가 무너진다. 기존 감사에서 admin API auth 누락 후보와 service role 사용을 봤지만, 사용자 화면 단위 권한 경험까지 충분히 설계하지는 않았다.

추가 계획:

- admin 화면마다 필요한 role, tenant scope, service role 사용 여부를 매트릭스로 만든다.
- 고객명, 연락처, 여권, 결제, 상담 로그는 기본 마스킹하고 “보기” 액션을 감사 로그에 남긴다.
- export/download/CSV/API response는 PII 필드 최소화.
- 테넌트 전환/파트너 preview 상태를 화면 상단에 명확히 표시.
- 권한 부족은 404처럼 숨길지, 403 안내를 줄지 정책 통일.

### 5. 운영자 실수 복구 UX가 부족할 수 있다

여행 운영은 승인, 입금 매칭, 정산, 상품 활성화처럼 되돌리기 어려운 액션이 많다. 지금도 일부 경고와 confirm은 있지만, 전체 UX 원칙으로는 덜 정리돼 있다.

추가 계획:

- 위험 액션은 “확인”보다 “preview → diff → confirm → undo window” 구조로 통일.
- 상품 승인, 정산 마감, 입금 매칭, AI 자동 실행은 모두 dry-run 결과를 먼저 보여준다.
- 최근 50개 admin mutation을 `admin_activity_log`로 묶어 되돌리기 가능 여부를 표시.
- bulk action은 예상 영향 건수, 실패 건수, per-row error 다운로드를 기본 제공.

### 6. 부분 실패를 제품 상태로 보여줘야 한다

현재 `/admin` 대시보드는 일부 API 실패를 배너로 보여주지만, 각 위젯의 stale/failed 상태가 정교하지 않다. 여행 플랫폼은 외부 API, 크론, AI, 광고, OTA, Slack/Kakao ingest가 많아 부분 실패가 정상 상태처럼 자주 일어난다.

추가 계획:

- 모든 위젯에 `loading`, `empty`, `stale`, `partial`, `error`, `unauthorized` 상태를 표준화.
- “데이터 없음”과 “조회 실패”를 시각적으로 구분.
- 외부 연동 위젯은 마지막 성공 시각과 다음 재시도 시각을 표시.
- Sentry/OTel/cron log를 `/admin/system-health`와 `/admin` 긴급 처리로 연결.

### 7. AI UX는 “답변”보다 “근거와 승인”이 핵심이다

자비스, QA, 추천, 자동화가 많다. 최신 enterprise UX 흐름은 AI를 멋진 챗봇으로 보이게 하는 것보다, 사용자가 결과를 신뢰하고 수정하고 승인할 수 있게 하는 쪽이다.

추가 계획:

- AI 출력에는 근거 문서/원본/DB row 링크를 붙인다.
- 자동 실행은 권한별로 suggest-only, draft, execute를 나눈다.
- AI가 만든 상품/카피/정산 제안은 confidence보다 “검증된 근거 수”, “미검증 claim 수”, “사람 검토 필요 사유”를 우선 표시.
- AI 비용 위젯은 모델별 비용만이 아니라 “비용 대비 절약 시간/승인율/실패율”로 전환.

### 8. 검색·필터·대량 작업 생산성을 따로 봐야 한다

ERP형 admin은 메뉴 구조보다 목록 화면 생산성이 더 중요하다. 고객, 예약, 결제, 상품, 관광지, 콘텐츠가 커질수록 검색/필터/저장된 뷰/대량 작업이 핵심 UX다.

추가 계획:

- 모든 주요 list page에 공통 패턴: 검색, 상태 필터, 날짜 필터, 저장된 뷰, CSV export, bulk action, column priority.
- URL query로 필터 상태를 보존.
- empty state는 “새로 만들기”보다 “필터 초기화 / 가져오기 / 샘플 보기”를 제공.
- 대량 목록은 PostgREST 1000 row cap을 전제로 pagination/range loop/count exact 정책을 명시.

### 9. 콘텐츠·상품 품질은 UX 앞단에서 제어해야 한다

공개 UX 문제 중 placeholder image, destination 500, detail data drift는 화면 디자인만으로 해결되지 않는다. 상품/관광지/블로그 데이터 품질이 곧 고객 UX다.

추가 계획:

- 상품 publish gate에 이미지, 가격, 출발일, 취소규정, 포함/불포함, 호텔/항공/관광지 매칭률을 합산한 quality score 추가.
- 관광지 사진/영문 alias/중복 설명은 등록 단계에서 경고.
- 블로그/SEO 페이지는 sitemap 포함 전 200/H1/meta/이미지/CTA 검증.
- live domain 500 페이지는 배포 후 synthetic monitor로 감시.

### 10. 검증 체계를 “한 번 검사”에서 “계속 지키는 구조”로 바꿔야 한다

이번처럼 전수조사를 해도 다음 PR에서 다시 깨질 수 있다. 따라서 UX/UI 개선의 최종 산출물은 문서가 아니라 CI gate와 운영 대시보드여야 한다.

추가 계획:

- `admin-dashboard-contract` smoke script: endpoint shape, latency, JSON, auth 상태 검사.
- `public-critical-pages` smoke script: home/packages/detail/concierge/group/rfq/blog/destination.
- `admin-critical-pages` visual script: dashboard/bookings/packages/payments/customers/upload/attractions/jarvis.
- `a11y` script: axe 또는 eslint-a11y 기반 P0 검사.
- `design-token` script: admin 영역에서 `rounded-[16px]`, 임의 shadow, 10px 텍스트, 임의 hex 사용 감지.
- `tracking-taxonomy` script: 정의되지 않은 event name 사용 감지.

## 통합 우선순위

### P0: 1주 안에 해야 하는 것

1. `/admin` 대시보드 fetch 실패 격리, `Promise.allSettled`, safe JSON, 인증 만료 배너.
2. `/api/dashboard`, `/api/agent-actions` 6초대 원인 개선 또는 light endpoint 추가.
3. live domain 500, CSP Sentry 오류, `keyword_performance_daily` 404, `/api/auth/refresh` 401 노이즈 정리.
4. admin API auth 후보 21개 재검증.
5. 모바일 sidebar overflow 노이즈 제거.
6. 이벤트 taxonomy 초안 작성.
7. PII 마스킹/권한 matrix 작성.

### P1: 2~3주

1. `/admin` 메인 대시보드 토큰화: 카드, 배지, 섹션, KPI, 차트.
2. 접근성 AA 기준 점검: focus, target size, keyboard, chart 대체 텍스트.
3. list page 공통 생산성 패턴 도입: saved views, URL filters, column priority.
4. 상품/관광지/블로그 publish gate 강화.
5. admin visual regression과 API contract script를 CI에 연결.
6. AI 제안/승인 UX에 근거·검증·비용·실패율 표시.

### P2: 1~2개월

1. 고객 행동 기반 개인화: 봤던 목적지, 비교한 상품, 예산/출발월 기반 추천.
2. 운영자별 role dashboard: 사장님, CS, 상품, 마케팅, 재무용 첫 화면 분리.
3. feature flag와 A/B testing 운영화.
4. 통합 system health: 크론, 외부 API, AI provider, Supabase, 광고, Slack/Kakao ingest 상태.
5. 데이터 품질 score를 운영 KPI로 승격.

## 최종 운영 원칙

- 디자인은 토큰으로 잠그고, 예외는 디자인 리뷰 대상.
- 숫자는 산식/출처/시점/drilldown 없이 보여주지 않는다.
- AI는 근거와 승인 흐름 없이는 실행 기능으로 보이지 않는다.
- 고객 UX 문제는 화면뿐 아니라 상품 데이터 품질에서 같이 잡는다.
- 모든 개선은 이벤트 taxonomy로 측정 가능해야 한다.
- “전수조사 완료”가 아니라 “전수조사가 자동으로 반복되는 구조”를 목표로 한다.

## 참고한 외부 기준

- W3C WCAG 2.2: focus appearance, target size 등 접근성 기준.
- SAP enterprise UX 흐름: AI 성공은 모델보다 신뢰·채택·업무 영향 UX가 좌우된다는 관점.
- Baymard travel UX: 가격/일정/조건/비교/CTA의 명확성.
- Atlassian/Fluent/SAP Fiori형 enterprise navigation: 역할 기반, 작업 흐름 기반, dense but readable UI.
- AI/HITL UX 연구 흐름: 정확도뿐 아니라 운영 지연, 적응 시간, 신뢰를 함께 봐야 한다는 관점.
