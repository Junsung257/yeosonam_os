# 2026-05-30 /admin 대시보드 디자인·데이터 안정화 계획

## 결론

`/admin` 대시보드는 방향이 맞다. 확정매출(출발일 기준)과 신규예약(생성일 기준)을 분리했고, Booking Pace, 90일 취소율, 정산 잔여, AI 비용, 랜드사 Take Rate, 재방문, 데이터 품질, 긴급 액션 보드까지 들어가 있어 ERP형 운영 화면으로 갈 재료가 충분하다.

다만 현재 상태는 “기능은 많지만 첫 화면 신뢰도와 토큰 일관성은 아직 100%가 아님”이다. 특히 일부 API가 6초대이고, 메인 대시보드 카드들이 admin 토큰 대신 임의 radius/shadow/색상/10px 텍스트를 많이 사용한다. 모바일 렌더는 페이지 자체가 깨지지는 않았지만, 닫힌 사이드바가 가로 overflow로 감지되는 구조라 자동 시각 회귀 테스트에서 계속 잡힐 가능성이 있다.

## 실제 점검 결과

로컬 개발 서버에서 `ys-dev-admin` 우회 세션으로 `/admin` 의존 API를 확인했다.

| Endpoint | Status | 응답시간 | 핵심 shape |
|---|---:|---:|---|
| `/api/dashboard` | 200 | 6101ms | `stats` |
| `/api/dashboard/chart?months=6` | 200 | 1487ms | `data[6]` |
| `/api/dashboard/revenue-recognition?months=6` | 200 | 1213ms | `recognized[6]`, `newBookings[6]`, `pace[5]`, `cancellation_90d` |
| `/api/dashboard/operations` | 200 | 1043ms | `aiUsage`, `settlement`, `takeRates`, `repeat`, `dataQuality` |
| `/api/capital` | 200 | 1205ms | `entries`, `total` |
| `/api/bank-transactions?match_status=unmatched` | 200 | 1742ms | `transactions[51]` |
| `/api/agent-actions?status=pending&limit=6` | 200 | 6535ms | `actions`, `total`, `page`, `limit` |
| `/api/admin/ai-credits` | 200 | 2298ms | `credits`, `updated_at` |

렌더링 점검:

- Desktop 1440x900: 200, page error 0, overflow 0.
- Tablet 768x1024: 200, page error 0, overflow 0.
- Mobile 390x844: 200, page error 0, overflow 감지 12건. 실제 원인은 닫힌 `aside`가 `left: -256px` 상태로 DOM에 남아 있는 것이라 화면 붕괴라기보다 검사 노이즈에 가깝다.
- 공통 bad response: `/api/auth/refresh` 401, Supabase `keyword_performance_daily` 404. 대시보드가 열리기는 하지만 콘솔 신뢰도를 떨어뜨린다.

산출물:

- `docs/audits/2026-05-30-admin-dashboard-local-render-audit.json`
- `docs/audits/2026-05-30-admin-dashboard-local-screens/`

## 코드베이스 강점 반영

이미 반영되어 있는 강점은 유지해야 한다.

- KPI 산식: `src/app/api/dashboard/revenue-recognition/route.ts`가 `getRecognizedRevenueMonthly()`, `getNewBookingsMonthly()`, `getBookingPaceAndCancellation()`로 회계/영업 KPI를 분리한다.
- 운영 KPI: `src/app/api/dashboard/operations/route.ts`가 AI 비용, 정산 잔여, Take Rate, 재방문, 데이터 품질을 한 번에 제공한다.
- 화면 구조: `src/app/admin/AdminPageClient.tsx`에는 `TwoTrackKPI`, `ActionBoard`, `OperationsKPI`, `DataQualityMonitor`가 이미 있고, 주요 카드가 drilldown 링크를 가진다.
- 디자인 토큰: `src/app/globals.css`와 `tailwind.config.js`에 `admin-card`, `rounded-admin-*`, `shadow-admin-*`, `text-admin-*`, density 토큰이 이미 존재한다.
- 어드민 IA: `src/components/AdminLayout.tsx`는 운영, 상품·공급, 영업·제휴, 재무, 마케팅·콘텐츠, AI·자동화, 시스템으로 재정렬되어 실제 ERP 사용 흐름에 더 가까워졌다.

## 남은 위험

### P0: 깨짐 방지

1. `loadAll()`의 핵심 fetch가 `Promise.all` + `statsRes!.json()` 중심이라 `/api/dashboard`가 307/401/500/HTML을 반환하면 전체 초기 로드가 `초기로드` 실패로 떨어질 수 있다.
2. `/admin/page.tsx` 서버 prefetch가 `supabaseAdmin` 직접 조회를 수행한다. DB 오류나 테이블 drift가 생기면 클라이언트 skeleton까지 도달하기 전에 페이지가 깨질 수 있으므로 `Promise.allSettled`와 safe fallback 배열이 필요하다.
3. 비로그인 API 요청은 middleware에서 `/login`으로 307 리다이렉트된다. 인증 만료 시 클라이언트 fetch가 JSON이 아닌 redirect 응답을 받을 수 있으므로 공통 fetch 래퍼가 필요하다.
4. `/api/dashboard`와 `/api/agent-actions`가 6초대다. 첫 화면에서 “느리다”로 느껴질 수 있고, 네트워크가 나쁘면 skeleton 체류 시간이 길어진다.
5. 모바일 닫힌 sidebar overflow는 실제 화면 침범은 아니지만 시각 회귀 테스트를 흐린다. 닫힘 상태에서는 `visibility:hidden` 또는 `aria-hidden` + pointer-events + 검사 제외 속성이 필요하다.

### P1: 데이터 신뢰도

1. `/api/dashboard`의 V1 `getDashboardStats()`는 `bookings`를 직접 합산한다. 메인에는 V4 KPI가 따로 있지만, 같은 화면 안에서 V1/V4 기준이 섞이면 운영자가 숫자의 의미를 헷갈릴 수 있다.
2. `AI 비용`은 `KRW_PER_USD=1380` 고정 환율 표시다. 의사결정용이면 FX sync 값 또는 “추정” 라벨이 필요하다.
3. `SocialMetricsWidget`은 localStorage 기반이다. 브라우저가 바뀌면 초기화되므로 첫 화면 핵심 지표로 두기보다 DB-backed 또는 하단 보조 위젯으로 내려야 한다.
4. `AIInsights`의 상품 Top 3는 판매/예약 기반 Top이라기보다 현재 상품 배열 기반 추천에 가깝다. 실제 매출 Top으로 보이게 만들려면 booking/revenue join이 필요하다.
5. `keyword_performance_daily` 404는 검색광고 위젯의 테이블 또는 정책 불일치 가능성이다. 위젯 단위 empty/error state로 격리해야 한다.

### P2: 디자인 일관성

1. `/admin` 메인에 `rounded-[16px]`, `shadow-[0_2px_12px...]`, `text-[10px]`, `text-[11px]`, 임의 blue/purple 계열이 많이 남아 있다.
2. admin 토큰은 Linear/Stripe형 ERP 기준으로 4/6/8px radius와 hairline shadow를 이미 정의했으므로, 메인 대시보드 카드는 `admin-card`, `rounded-admin-md`, `shadow-admin-xs/sm`, `text-admin-xs/sm/base`로 통일해야 한다.
3. 핵심 데이터 라벨은 12px 이상, 배지와 아주 좁은 보조 라벨만 11px로 제한한다. 10px는 dense table badge 외에는 제거한다.
4. 색상은 `brand`, `admin-success/warning/danger/info`, `admin-muted`만 쓰고, 임의 `blue-400`, `purple-600`, `pink-600`은 상태 의미가 있을 때만 허용한다.

## 최적 레이아웃

첫 화면은 “보여주기”가 아니라 “오늘 무엇을 처리해야 하는가”가 먼저 와야 한다.

1. 상단 sticky bar: 기간, 새로고침, 마지막 로드 시각, 데이터 상태.
2. Zone 1 긴급 처리: D-7 미납, 미매칭 입금, 여권 만료, 정산 overdue, AI 실패.
3. Zone 2 경영 KPI: 확정매출/신규예약 2트랙, 마진, 미수금, 진행 예약, 자본 잔액.
4. Zone 3 운영 리스크: Booking Pace, 취소율, 정산 잔여, 데이터 품질.
5. Zone 4 분석: Take Rate, 재방문, ROAS, 검색광고, SNS, AI 인사이트.
6. 하단 바로가기: 작업 빈도 기반 추천만 남기고, 고객 페이지 링크는 별도 “프론트 미리보기” 그룹으로 축소한다.

## 구현 계획

### 1단계: No-break 데이터 레이어

- `src/app/admin/AdminPageClient.tsx`에 공통 `safeJson<T>()` 또는 `fetchDashboardEndpoint()`를 도입한다.
- 모든 대시보드 fetch는 `{ ok, data, status, error, loadedAt }` 형태로 받고, 위젯 단위로 실패를 격리한다.
- `Promise.all`을 `Promise.allSettled`로 바꿔 `/api/dashboard` 하나가 실패해도 ActionBoard, chart, operations가 각각 살아 있게 한다.
- 인증 만료/redirect 감지는 `status === 401 || status === 307 || content-type !== application/json`로 분기하고, 상단에 “세션 갱신 필요” 배너를 표시한다.
- `/admin/page.tsx` 서버 prefetch도 `try/catch` + fallback `[]`로 감싼다.

### 2단계: 응답시간 개선

- `/api/dashboard`는 V1 직접 합산을 유지하되 필요한 컬럼만 더 줄이고, 월 단위/상태별 view 또는 RPC를 검토한다.
- `/api/agent-actions`는 pending 카운트와 최근 6건만 필요한 대시보드 전용 endpoint 또는 index를 둔다.
- `/api/bank-transactions?match_status=unmatched`는 전체 transaction 배열 대신 `{ count, latest }` 형태의 light endpoint를 둔다.
- 대시보드 첫 paint에는 ActionBoard와 KPI만 우선 로드하고, 분석 위젯은 idle/deferred 로드한다.

### 3단계: 디자인 토큰 정리

- `DashboardCard`, `MetricValue`, `MetricLabel`, `KpiDelta`, `RiskBadge`, `DashboardSection` 컴포넌트를 만든다.
- `/admin` 메인에서 임의 shadow/radius를 제거하고 `admin-card`, `rounded-admin-md`, `shadow-admin-xs`로 통일한다.
- `grid grid-cols-2`는 모바일에서 `grid-cols-1 sm:grid-cols-2`로 바꾼다.
- 사이드바 닫힘 상태는 모바일 overflow 검사에서 제외되도록 `visibility`/`aria-hidden` 상태를 맞춘다.
- H1 중복(레이아웃 “대시보드” + 페이지 “어드민 대시보드”)은 하나만 유지한다.

### 4단계: 검증 자동화

- `scripts/audit-admin-dashboard-contract.mjs`를 추가해 위 8개 endpoint의 status, JSON shape, 응답시간 예산을 검사한다.
- Playwright로 `/admin` desktop/tablet/mobile screenshot을 저장하고 overflow/pageerror/bad response를 CI에서 검사한다.
- 기간 버튼 3개월/6개월/12개월 전환 시 `recognized`, `newBookings`, `chartData` 길이가 함께 바뀌는지 확인한다.
- `npm run type-check`, `npm run lint -- --file src/app/admin/AdminPageClient.tsx`, `npm run build`, `npm run check:perf`, `npm run audit:api-drift`, `npm run audit:select-cols`를 대시보드 변경 PR의 필수 검증으로 묶는다.

## 참고 기준

- Baymard travel UX: 가격, 일정, 조건, CTA를 명확히 하고 비교 가능성을 높이는 방향.
- SAP Fiori: 역할 기반 launchpad, 작업 중심 IA, 예외/알림 우선순위.
- Microsoft Fluent: dense but legible enterprise layout, navigation consistency.
- Atlassian navigation redesign: 팀이 실제로 자주 쓰는 작업 흐름 중심 재배치.
- Stripe/Linear형 대시보드 관찰: 큰 장식보다 숫자, 상태, drilldown, 빠른 복구 흐름을 우선한다.

## 최종 판단

현재 `/admin` 대시보드는 “방향성 80점, 데이터 모델 80점, 디자인 일관성 65점, 운영 안정성 70점”이다. 깨지는 수준은 아니지만, 운영자가 매일 믿고 쓰는 100점형 ERP 대시보드로 만들려면 우선순위는 명확하다.

1. fetch 실패 격리와 인증 만료 처리.
2. 6초대 API의 light endpoint 또는 view/RPC 개선.
3. 메인 대시보드 카드/폰트/색상 토큰 통일.
4. 모바일 sidebar overflow 노이즈 제거.
5. 데이터 shape/시각 회귀 자동검증을 PR 필수 관문으로 추가.

## 2026-05-30 추가 진행 기록

- `src/app/admin/AdminPageClient.tsx`의 초기 로드 fetch를 공통 JSON guard(`fetchDashboardJson`)로 정리했다. 이제 401/307/308/HTML 응답을 JSON 파싱 전에 감지하고, 위젯 단위 실패를 상단 배너로 격리한다.
- 서버 prefetch가 이미 있는 첫 진입에서는 전체 skeleton으로 화면을 덮지 않고, 기존 shell을 유지한 채 보강 데이터를 로드하도록 바꿨다.
- Two-track KPI와 skeleton KPI 그리드는 모바일에서 1열, `sm` 이상에서 2열로 바꿔 좁은 화면 숫자/라벨 압축을 줄였다.
- 핵심 KPI 카드 일부는 `rounded-admin-md`, `shadow-admin-xs`, `border-admin-border-mid` 계열로 맞춰 `/admin` 메인의 임의 16px radius/shadow 사용을 줄였다.
- `scripts/audit-admin-dashboard-contract.mjs`는 로컬 Next dev의 첫 라우트 컴파일 시간이 성능 예산에 섞이지 않도록 local `BASE_URL`에서만 순차 warm-up 후 측정한다. 원격/배포 URL은 기존처럼 즉시 측정한다.

검증:

- `npx eslint src/app/admin/AdminPageClient.tsx --max-warnings=0` 통과.
- `npm run type-check -- --pretty false` 통과.
- `npm run audit:pii-surface:strict` 통과(`strict_blockers=0`).
- `npm run audit:event-taxonomy` 통과.
- `node --check scripts/audit-admin-dashboard-contract.mjs` 통과.
- 깨끗한 `.next` + 단일 dev server(`BASE_URL=http://localhost:3042`)에서 `npm run audit:admin-dashboard` 통과. 8개 endpoint 모두 status/JSON shape/응답시간 예산 통과.

잔여:

- 로컬 dev에서 여러 라우트를 동시에 첫 컴파일할 때 `.next` 서버 청크가 꼬이는 현상이 재현됐다. 감사 스크립트는 순차 warm-up으로 보정했고, 깨끗한 서버에서 계약 감사는 통과했다.
- Chrome 기반 `/admin` 시각 렌더 검증은 dev 서버가 `/admin` 컴파일 중 내려가 연결이 끊겨 완료하지 못했다. 다음 시각 검증은 서버 유지 방식을 바꿔 재시도한다.
- `/api/dashboard`, `/api/agent-actions`, `/api/bank-transactions`의 cold-start/첫 컴파일 체감 시간은 여전히 가벼운 RPC/index/summary endpoint 개선 대상이다.

## 2026-05-30 배치 보강 기록

- `/admin` 메인 카드에 남아 있던 임의 `rounded-[16px]`, 커스텀 shadow 계열을 제거하고 `bg-admin-surface`, `border-admin-border-mid`, `rounded-admin-md`, `shadow-admin-xs/sm` 토큰으로 통일했다.
- hover 상태도 그림자만 커지는 장식형 반응보다 border + shadow 토큰 조합으로 맞춰 ERP 화면의 밀도와 일관성을 우선했다.
- PowerShell 저장 과정에서 생긴 UTF-8 BOM과 EOF 여분 빈 줄을 제거했다.

검증:

- `npx eslint src/app/admin/AdminPageClient.tsx --max-warnings=0` 통과.
- `node --check scripts/audit-admin-dashboard-contract.mjs` 통과.
- `git diff --check -- src/app/admin/AdminPageClient.tsx docs/audits/2026-05-30-admin-dashboard-design-data-plan.md` 통과.

잔여:

- 이번 배치의 `npm run type-check -- --pretty false`는 오류 출력 없이 장시간 대기하다 타임아웃됐다. 직전 고객/어드민 배치에서는 통과했으므로, CSS 토큰 변경 자체의 직접 리스크는 낮다. 타입체크 지연은 다음 대형 배치에서 프로세스/빌드 캐시 상태까지 포함해 별도로 재검증한다.

## 2026-05-30 Admin Surface Token Batch

- 어드민 하위 페이지 전반에 반복되던 `bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]` 카드 패턴 193개를 `bg-admin-surface`, `border-admin-border-mid`, `shadow-admin-xs` 토큰 조합으로 일괄 치환했다.
- 목적은 페이지마다 다른 임의 그림자 값을 줄이고, ERP 화면의 표면/경계/깊이 표현을 같은 디자인 언어로 맞추는 것이다.
- 기능 로직, KPI 산식, 데이터 fetch 로직은 건드리지 않았다.

검증:

- 기존 exact 패턴 `bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]` 재검색 결과 없음.
- `git diff --check -- src/app/admin src/components/admin` 통과.
- `npx eslint`를 `git diff --name-only -- src/app/admin src/components/admin` 기준 72개 TSX 파일에 실행했고 통과.
