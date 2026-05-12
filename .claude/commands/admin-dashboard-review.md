---
name: admin-dashboard-review
description: 어드민 대시보드(/admin) 변경 시 강제 통과해야 할 디자인·KPI 산식 체크리스트. Few/Tufte/Stripe/IFRS 15 표준 박제.
---

# /admin 대시보드 리뷰 체크리스트

> 본 체크리스트는 **/admin 메인 페이지 또는 KPI 산출 로직(dashboard.ts) 수정 시 필수 통과**.
> 외부 레퍼런스 10선 (Few · Tufte · Borkin · Kaplan&Norton · Stripe · Booking.com · Airbnb · Linear · Tremor · shadcn-admin) 에서 추출.
> 작성: 2026-04-28 — 사장님 요구사항 "월별 수익 = 출발일 기준 / 월별 예약 = 생성일 기준" 분리 정책 시작.

---

## A. KPI 산식 정합성 (회계·통계 기준)

- [ ] **확정매출 (출발일 기준) ≠ 신규예약 (생성일 기준)** 두 지표를 절대 한 카드에 섞지 않는다.
  - 확정매출: `departure_date <= TODAY AND status != 'cancelled'` (IFRS 15 / ASC 606)
  - 신규예약: `created_at` 월별 카운트, 취소건도 표시
- [ ] **모든 매출 산출은 [`v_bookings_kpi`](../../supabase/migrations/20260428000000_v_bookings_kpi_unified_views.sql) 또는 동일 로직의 [`getRecognizedRevenueMonthly()`](../../src/lib/db/dashboard.ts) / [`getNewBookingsMonthly()`](../../src/lib/db/dashboard.ts) 만 사용**.
  - `bookings.total_price` 직접 SUM 금지 (V1/V3 산식 불일치 재발 방지).
- [ ] `is_deleted = true` 행은 모든 KPI에서 제외.
- [ ] 취소된 예약(`status='cancelled'`)은 별도 카운트로만 표시. 매출에서 자동 차감.
- [ ] `payment_status` 컬럼이 등장하면 한국어 값(`미입금`/`일부입금`/`완납`)을 정확히 매칭.
- [ ] `settlement_mode` (accrual/cash/confirmed) 가 결산 화면에 명시되어 있는지 확인.
- [ ] 시간대: KST(`Asia/Seoul`) 기준으로 월 경계를 자른다 (UTC 절대 금지).

## B. 단일 화면 원칙 (Stephen Few)

- [ ] 메인 `/admin` 은 **노트북 1뷰(높이 ~900px) 안에 핵심 KPI가 끝나야 한다**. 스크롤은 보조 정보용.
- [ ] **게이지 / 도넛 / 3D / 그라데이션 채움 금지** (Few 13가지 흔한 실수).
- [ ] 색상은 **카테고리 구분에만**. 강조 색은 화면당 **딱 1곳**(예: 미수금이 임계치 초과).
- [ ] 차트 그리드라인은 최소화, 데이터 라벨은 차트 끝에 직접 부착(범례 분리 X — Tufte).

## C. Data-Ink Ratio (Edward Tufte)

- [ ] 차트의 모든 픽셀이 데이터를 표현하는가? (테두리·박스·중복 라벨 제거)
- [ ] 같은 차원을 비교할 땐 **Small Multiples** 사용 (지역×월 매트릭스 등).
- [ ] sparkline 은 라벨 없이도 의미가 통하는가? (좌우 끝값만 노출)

## D. 정보 구조 — Stripe / Linear / Booking.com

- [ ] **모든 KPI 카드는 클릭 가능**. 클릭 시 해당 도메인 페이지로 점프 (drilldown URL 필수).
  - 미수금 → `/admin/payments?filter=outstanding`
  - 진행 예약 → `/admin/bookings?status=pending,confirmed`
  - 확정매출 → `/admin/bookings?mode=recognized`
  - 신규예약 → `/admin/bookings?mode=new`
- [ ] "5 of 23 미매칭" 식 **부분 노출 + drilldown** 패턴 (Stripe).
- [ ] 메인에서 OS의 다른 모듈(`/admin/jarvis`, `/admin/scoring`, `/admin/content-analytics`, `/admin/land-settlements`) 로 도달까지 **3-hop 이내**.
- [ ] **Cmd+K 팔레트** 에서 예약 ID / 고객명 / 상품 제목 으로 직접 점프 가능해야 함 ([search-providers.ts](../../src/lib/admin-commands/search-providers.ts) 참조).

## E. UX 안정성

- [ ] 로딩 상태: skeleton 카드 (텍스트 fallback "—"가 아닌).
- [ ] 빈 상태: "데이터 없음" 텍스트만이 아닌, 다음 액션 힌트 제공 ("첫 예약 등록하기").
- [ ] 에러: try-catch 묵음 금지. 사용자에게 토스트 또는 인라인 메시지.
- [ ] localStorage 기반 위젯은 휘발 위험 명시 + DB 백업 경로 마련 (현 SocialMetricsWidget).

## F. 멀티테넌시·확장성

- [ ] 모든 쿼리에 `tenant_id` 필터를 끼워넣을 수 있는 구조인가? (`bookings.tenant_id` 컬럼 존재함)
- [ ] RLS 정책: "자신의 회사 데이터만 보는가?" 전제로 작성.

## G. OS 유기적 연결 (사장님 정책 2026-04-28)

대시보드는 **읽기 전용 표시판이 아니라 OS 신경 중추**. 다음을 매 PR 마다 검증:

- [ ] 새 KPI를 추가했다면, 해당 데이터 소스가 OS의 **다른 모듈에서도 동일 산식**으로 사용되고 있는가?
- [ ] 메인 대시보드 KPI 와 `/admin/affiliate-analytics`, `/admin/content-analytics`, `/admin/scoring`, `/admin/land-settlements`, `/admin/jarvis` 의 동일 명칭 지표가 **수치가 일치**하는가?
- [ ] 액션 버튼(잔금 안내, 미매칭 매칭, 자비스 결재) 은 메인에서 직접 트리거되는가, 아니면 별도 페이지로 이동만 하는가?
- [ ] 같은 사건(예약 1건 생성) 이 발생할 때 영향받는 KPI 목록을 **이벤트 로그(`os_event_signals` 등)** 로 추적 가능한가?

## H. 회귀 방지

- [ ] `npm run audit:api-drift` 통과
- [ ] `npm run audit:drift` (스키마 drift) 통과
- [ ] `npm run test:visual` 의 `/admin` 스냅샷이 깨지지 않았는가? (의도된 변경이면 baseline 갱신)
- [ ] CashflowChart 라벨 버그(`net_margin` → '예상 취소율' 오라벨) 같은 시각적 버그 재발 없는지 Tooltip 텍스트 직접 확인.

---

## I. 신규 페이지에 dual-basis 도입하기 (확장 가이드)

`/admin/affiliate-analytics` 가 두 회계 관점(예약 기준 vs 매출 인식 기준)을 토글로 모두 보여주는 패턴을 채택했다. 같은 패턴을 **다른 어드민 페이지로 확장할 때** 절차:

1. `import { type KPIBasis, DEFAULT_KPI_BASIS, getBasisMeta, parseBasis, bookingMonthByBasis, bookingPassesBasis } from '@/lib/kpi-basis'`
2. API route 에서 `parseBasis(request.nextUrl.searchParams.get('basis'))` 로 basis 파싱
3. 예약 행 집계 시 `bookingMonthByBasis(row, basis)` / `bookingPassesBasis(row, basis)` 만 호출 — 산식 분기는 라이브러리가 캡슐화
4. select 컬럼에 `BASIS_REQUIRED_COLUMNS` (`created_at`, `departure_date`, `status`) 모두 포함
5. 페이지 컴포넌트: `import KPIBasisToggle from '@/components/admin/KPIBasisToggle'` + `useState<KPIBasis>('commission')`
6. fetch 에 `?basis=${basis}` 부착 + useEffect 의존성에 `[basis]`
7. 토글 변경 시 페이지 전체가 깜빡이지 않도록 `refetching` 상태 분리

**산식 자체를 바꿀 일이 생기면 [src/lib/kpi-basis.ts](../../src/lib/kpi-basis.ts) 한 곳만 수정.**

## K. DB 트리거 작성·수정 규칙 (2026-04-29 박제)

KPI 산식의 정확성은 트리거 함수의 정합성에 달려 있다. **함수 본문과 트리거 정의의 컬럼 리스트가 어긋나면** 산식 자체가 옳아도 발화 안 해서 데이터가 망가진다 (ERR-2026-04-29: `trg_payment_status` `UPDATE OF paid_amount` 만 잡혀 있어 단가 변경 시 미발화. 36건 중 33건 모순 누적).

새 트리거 추가 또는 기존 트리거 수정 시 다음을 **동시에** 검토:

- [ ] **함수 본문의 컬럼 참조 목록과 `CREATE TRIGGER ... UPDATE OF (...)` 절의 컬럼 목록이 완전 일치한다.**
  - 함수에서 `NEW.<col>` 로 읽는 모든 컬럼이 `UPDATE OF` 에 포함되어야 발화 보장.
  - 누락 시 그 컬럼만 변경하는 UPDATE 에서 트리거 미발화 → 산식 결과가 stale 한 채로 저장.
- [ ] **`SET col = col` 백필이 안전한가** — 트리거 함수가 idempotent 한지 확인. 같은 INPUT 으로 재발화해도 동일 결과를 내야 함.
- [ ] **CHECK constraint 와 호환되는가** — 함수가 NEW 에 설정하는 모든 가능한 값이 CHECK 제약을 만족하는지.
- [ ] **다중 BEFORE 트리거 간 상호작용 검증** — 트리거는 함수명 알파벳 순으로 발화. 앞선 트리거가 NEW 를 변경하면 뒤 트리거가 변경된 NEW 를 본다. 의도치 않은 덮어쓰기 없는지 확인.
- [ ] **fallback 분기 명시** — 합산 결과가 0이거나 NULL 일 때 동작 정의 (예: `total_price` 직접 입력 케이스). 무조건 변경 안 함보다 명시적 분기가 안전.
- [ ] **수정 후 production 재발화** — 기존 데이터에 영향 주려면 명시적 `UPDATE bookings SET <trigger_col> = <trigger_col>` 으로 트리거 발화. no-op 이라도 PostgreSQL 은 SET 절 컬럼이 `UPDATE OF` 에 있으면 발화.

수정 PR 에는 다음을 포함해야 함:
1. `pg_get_functiondef(oid)` 출력 (수정 전·후)
2. `pg_get_triggerdef(oid)` 출력 (수정 전·후)
3. BEFORE/AFTER 데이터 카운트 (예: `payment_status='완납'` 갯수 변화)
4. 백필 SQL 과 그 영향 범위 (영향받은 row 수)

## J. 산식 정합성 점검 결과 (2026-04-28 기준)

| 페이지 | 위험도 | 상태 |
|---|---|---|
| /admin (메인) | ✅ | v_bookings_kpi SSOT 사용 |
| /admin/ledger | ✅ | dashboardstats v1 (출발일 기준) |
| /admin/affiliate-analytics | ✅ | dual-basis 토글 도입 (2026-04-28) |
| /admin/marketing | ✅ | dual-basis 토글 도입 (2026-04-28). 기본 accounting (snapshot 기준) |
| /admin/land-settlements | ✅ | 라벨 명확화 + 메인 대시보드와의 차이 캡션 추가 (2026-04-28) |
| /admin/content-analytics | 🟡 | content_roas_summary 뷰 부재. 스키마 재설계 필요 — P2 보류 |

---

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-04-28 | 초안 작성 — 외부 레퍼런스 10선(Few/Tufte/Borkin/Kaplan&Norton/Stripe/Booking.com/Airbnb/Linear/Tremor/shadcn-admin) + IFRS 15/ASC 606 회계 표준 + 사장님 매출 인식 분리 정책 박제 |
| 2026-04-28 | dual-basis 추상화 + KPIBasisToggle 컴포넌트 추가. affiliate-analytics 첫 적용. 확장 가이드 박제 |
| 2026-04-29 | DB 트리거 작성·수정 규칙(Section K) 박제 — 함수 컬럼 ↔ `UPDATE OF` 컬럼 일치 강제. ERR-2026-04-29 재발 방지 |

---

## 참고 링크

- IFRS 15 (IATA): https://www.iata.org/contentassets/4a4b100c43794398baf73dcea6b5ad42/iawg-guidance-ifrs-15.pdf
- ASC 606 (RevenueHub): https://www.revenuehub.org/common-asc-606-issues-airline-entities/
- Stephen Few: https://www.amazon.com/Information-Dashboard-Design-At-Glance/dp/1938377001
- Tufte 원칙: https://thedoublethink.com/tuftes-principles-for-visualizing-quantitative-information/
- Borkin et al. (IEEE InfoVis 2013): http://web.mit.edu/zoya/www/docs/InfoVis_borkin-128.pdf
- Balanced Scorecard (HBR): https://hbr.org/1992/01/the-balanced-scorecard-measures-that-drive-performance-2
- Booking.com Partner Analytics: https://partner.booking.com/en-us/help/growing-your-business/analytics-reports/understanding-your-analytics-space
- Linear UI 재설계: https://linear.app/now/how-we-redesigned-the-linear-ui
- Tremor: https://www.tremor.so/
- shadcn-admin: https://github.com/satnaing/shadcn-admin
