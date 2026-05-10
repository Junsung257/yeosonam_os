# 디자인 시스템 리뉴얼 진행 트래커

> 본 문서는 어드민/공개사이트 전체 디자인 리뉴얼의 **단일 진실 소스 (SSOT)**.
> Phase 별 산출물·잔여 작업·우선순위를 기록한다. 리뉴얼은 6개 Phase로 진행.

**시작:** 2026-05-10
**톤:** 어드민 = Linear/Stripe (rounded 6/8, hairline, tabular nums, 컴팩트), 공개사이트 = Toss (rounded 16/12, soft shadow, 친근) — **둘은 분리 관리**.

---

## ✅ Phase 0 — 어드민 전수 감사 (완료)

- 데스크톱 어드민 페이지 **106개**
- 모바일 어드민 페이지 **10개**
- 어드민 전용 컴포넌트 **35개** + UI primitive **5개** + 모바일 **6개**
- shadcn/ui 미설치 (자체 구현 유지)
- 다크모드 미지원 (CSS 변수 토큰만 준비, 활성화는 Phase 3 후)

---

## ✅ Phase 1 — Design Tokens (완료)

**산출물:**
- `tailwind.config.js` — Linear/Stripe 톤 admin 토큰 추가 (color 8단계, font 11종, radius 4종, shadow 7종)
- `src/app/globals.css` — admin CSS 변수 + admin-scope 본문 톤 + admin-data-table 통일 + admin-card / kbd / focus ring
- `docs/design-system/tokens.md` — 토큰 가이드

**핵심 토큰:**
- `text-admin-{2xs,xs,sm,base,md,lg,h1,h2,h3,display}` (10단계)
- `bg-admin-{bg,surface,surface-2}`
- `border-admin-{border,border-mid,border-strong}`
- `text-admin-{text,text-2,muted,muted-2}`
- `rounded-admin-{xs,sm,md,lg}`
- `shadow-admin-{xs,sm,md,lg,xl,focus,focus-danger}`

---

## ✅ Phase 2 — Primitive 컴포넌트 (완료)

전부 **컨텍스트 인식** 패턴 적용 (Tailwind `[.admin-scope_&]:` 임의 부모 선택자). 공개사이트에선 기존 톤, 어드민에선 Linear 톤 자동 적용.

| 컴포넌트 | 위치 | 변경 |
|---|---|---|
| AdminLayout (셸) | `src/components/AdminLayout.tsx` | admin-scope 루트 적용, hairline 사이드바, 14px 헤더, 톤 정리 |
| Button | `src/components/ui/Button.tsx` | admin 안에서 h-9, rounded-admin-sm, secondary는 outline |
| Modal | `src/components/ui/Modal.tsx` | admin 안에서 rounded-admin-md, shadow-admin-xl, hairline border |
| Input | `src/components/ui/Input.tsx` | admin 안에서 h-9, rounded-admin-sm, focus shadow ring |
| DataTable | `src/components/admin/ui/DataTable.tsx` | globals.css의 admin-data-table 룰 활용, zebra 클래스 |
| StatusBadge | `src/components/admin/ui/StatusBadge.tsx` | 이미 status 토큰 사용 — 변경 없음 |
| Toast | `src/components/ui/Toast.tsx` | admin 안에서 rounded-admin-md, shadow-admin-lg |
| Chip | `src/components/ui/Chip.tsx` | admin 안에서 rounded-admin-xs, uppercase tag 스타일 |

**자동 흡수 효과:** 위 primitive를 사용하는 어드민 페이지 ≈ 50개는 **소스 변경 0줄**로 새 톤이 즉시 적용된다.

---

## ✅ Phase 3 — 패턴 라이브러리 (완료)

**산출물:** `src/components/admin/patterns/index.tsx`

| 패턴 | 용도 |
|---|---|
| `PageHeader` | 제목 + breadcrumb + 액션 — 모든 페이지 상단 |
| `SectionCard` | 본문 섹션 카드 (제목·액션·body) |
| `KpiCard` | KPI 단일 지표 (display 숫자 + delta + 아이콘) |
| `FilterBar` | 표 위 필터/검색바 |
| `EmptyState` | 빈 상태 (아이콘 + 제목 + 액션) |
| `DetailDrawer` | 우측 슬라이드 — 표 → 상세 패턴 |
| `FormRow` | 라벨 + 입력 + 힌트 + 에러 |
| `StatNumber` | tabular-num + 통화/퍼센트/카운트 포맷 |

---

## ✅ Phase 4-A — 어드민 전체 bulk 토큰 치환 (완료)

**산출물:** `scripts/migrate-admin-tokens.mjs`

**범위:**
- `src/app/admin/**/*.{ts,tsx}` (데스크톱 어드민)
- `src/app/m/admin/**/*.{ts,tsx}` (모바일 어드민)
- `src/components/admin/**/*.{ts,tsx}` (어드민 컴포넌트)

**결과:** **168+ 파일 / 6,706개 치환** (1차 sweep 6,040 + 2차 radii/shadow 666). TypeScript 클린.

### 1차 sweep — 색상 토큰 (시각 무변화, SSOT 통일)
- `text-slate-{300..900}` / `text-gray-{300..900}` → `text-admin-{muted-2,muted,text-2,text}`
- `border-slate-{100,200,300}` / `border-gray-{100,200,300}` → `border-admin-{border,border-mid,border-strong}`
- `bg-slate-{50,100}` / `bg-gray-{50,100}` → `bg-admin-{bg,surface-2}`
- `hover:` 변형 동일 처리

### 2차 sweep — 라디우스 / 쉐도우 (Linear/Stripe 톤 시각 변화)
- `rounded-xl` (12px) → `rounded-admin-md` (8px) — 503건
- `rounded-2xl` (16px) → `rounded-admin-lg` (10px) — 47건
- `shadow-sm` → `shadow-admin-xs` (crisp hairline) — 69건
- `shadow-md` → `shadow-admin-sm` — 4건
- `shadow-lg` → `shadow-admin-md` — 22건
- `shadow-xl` → `shadow-admin-lg` — 21건

**효과:** 어드민 116페이지 + 모든 어드민 컴포넌트가 즉시 Linear/Stripe 톤으로 전환. `admin-scope` 안의 primitive 자동 흡수와 결합되어 **첫 화면부터 톤이 바뀐다**.

---

## 🔄 Phase 4-B — 페이지별 패턴 적용 (선택 작업, 진행 중)

각 페이지의 **page header / KPI 박스 / 표 / 폼** 같은 인라인 마크업을 `<PageHeader />`, `<KpiCard />`, `<DataTable />`, `<FormRow />` 패턴으로 교체. **시각·구조 둘 다 개선**되는 깊은 마이그레이션. 페이지당 15~30분.

이 작업은 **선택**이다 — Phase 4-A 만으로도 톤은 바뀐다. 4-B는 "정밀 마무리".

### 완료된 페이지 (18개 — 2026-05-10)

**운영 (8개)**
- [x] `/admin/inbox` — `<PageHeader />` + 헬스 칩 + 우선순위 탭 + 필터칩 + TaskCard 톤 일관
- [x] `/admin/booking-guide` — `<PageHeader />` + 인쇄 액션 + 상품 select 폼 admin-card 안으로
- [x] `/admin/alerts` — `<PageHeader />` + 4× `<KpiCard />` + 필터 admin-card + EmptyState
- [x] `/admin/escalations` — `<PageHeader />` + 탭 admin tone + Button primitive
- [x] `/admin/ops` — `<PageHeader />` + Button 액션 (헤더 부분)
- [x] `/admin/reviews` — `<PageHeader />` + 3× `<KpiCard />` (헤더·KPI 부분)
- [x] `/admin/gdpr` — `<PageHeader />` + `<FormRow />` + `<Button variant="danger">` + 확인 다이얼로그 + 삭제 결과 카드
- [x] `/admin/applications` — `<PageHeader />` + 필터 칩 + 거절 모달 admin tone

**마스터 데이터 (5개)**
- [x] `/admin/departing-locations` — `<PageHeader />` + admin-card 폼 + admin-data-table + 인라인 에디트 + EmptyState + 토스트
- [x] `/admin/land-operators` — `<PageHeader />` + admin-card 폼 + admin-data-table + 인라인 에디트 + EmptyState + 토스트
- [x] `/admin/destinations` — `<PageHeader />` + 필터 admin tone + 자동생성 진행률 brand
- [x] `/admin/attractions` — `<PageHeader />` + 액션 그룹 + 필터 admin-card
- [x] `/admin/tenants` — `<PageHeader />` + 카드 그리드 admin tone + 슬라이드 패널 + FormRow

**AI · 시스템 (8개)**
- [x] `/admin/prompts` — `<PageHeader />` + `<FilterBar />` + `admin-data-table` 표 통일
- [x] `/admin/platform-learning` — `<PageHeader />` + 새로고침 Button + admin-card 이벤트 리스트
- [x] `/admin/agent-mas` — `<PageHeader />` + 탭 네비 admin tone + Button primitive
- [x] `/admin/qa` — 챗봇 헤더 admin tone + 메시지 버블 brand + 입력 폼 + 사이드 여정 패널
- [x] `/admin/extractions/corrections` — `<PageHeader />` + 4× `<KpiCard />` + 필터 admin-card + 시스템 약점 패널
- [x] `/admin/jarvis` — 헤더 (J 아바타) + 탭 admin tone + 채팅 메시지 버블 brand + 빠른명령 chip + 입력창
- [x] `/admin/jarvis/rag` — PageHeader + 검색 폼 admin-card + Button primitive + hit 결과 카드 톤
- [x] `/admin/generate` — PageHeader + FormRow 설정 + admin-card 결과 패널 + Button primitive

**정산·재무 (5개)**
- [x] `/admin/settlements` — `<PageHeader />` + 4× `<KpiCard />` + admin-data-table + 마감 패널
- [x] `/admin/land-settlements` — `<PageHeader />` + 필터칩 + admin-data-table + 펼침 행 톤
- [x] `/admin/tax` — PageHeader + 4× KpiCard + To-Do 경고 + admin-data-table
- [x] `/admin/invoice` — 인라인 styles 객체를 admin token (Linear/Stripe) 톤으로 매핑
- [x] `/admin/free-travel/settlements` — PageHeader + 4× KpiCard + 업로드 dropzone + admin-data-table

**영업·제휴 (4개)**
- [x] `/admin/affiliates` (AffiliatesPageClient) — PageHeader + 4× KpiCard + admin-data-table + 등록 슬라이드 패널 톤 + 진행 바 brand
- [x] `/admin/affiliate-promo-report` — PageHeader + admin-data-table CSV 액션
- [x] `/admin/partner-preview` (Client) — PageHeader + admin-card 폼 + URL 복사 패널 admin tone
- [x] `/admin/rfqs` — PageHeader + 4× KpiCard + 탭 admin tone + admin-data-table

**상품 검수 (3개)**
- [x] `/admin/ir-preview` (page + Client) — PageHeader + draft 카운트 칩 + admin-card 행 + Button primitive + 펼침 3-열 톤
- [x] `/admin/products/from-mrt` — PageHeader + 검색 폼 admin-card + 결과 카드 + Button primitive + brand 강조
- [x] `/admin/products/stub` — PageHeader + FormRow 폼 + admin-card 최근 stub 리스트 + EmptyState

**블로그 (8개)**
- [x] `/admin/blog` (page + BlogFilterTabs) — PageHeader + 4× Button (시스템·큐·카테고리·새글) + 탭 admin tone
- [x] `/admin/blog/topical` — PageHeader + 4× KpiCard + 컨트롤 admin-card + Pillar 카드 + 매트릭스 진행 바
- [x] `/admin/blog/rankings` — PageHeader + 3× KpiCard + 기간 탭 + 경보 패널 + admin-data-table + Movers Up/Down
- [x] `/admin/blog/categories` — PageHeader (breadcrumb 포함) + admin-data-table + 폼 패널 톤
- [x] `/admin/blog/BlogDataFetcher` — admin-data-table + brand 링크 + admin-num 페이지네이션
- [x] `/admin/blog/policy` — PageHeader + admin-card 폼 + Button + SEO 가이드 톤
- [x] `/admin/blog/ads` — PageHeader + admin-card 폼 + 필터 탭 + admin-data-table + 활성 토글

### 다음 후보 (사장님 지시 대기)
- `/admin` 메인 대시보드 (1729줄, 가장 임팩트 큼)
- `/admin/bookings` (2492줄, 표·필터 정밀 작업 필요)
- `/admin/customers` (1221줄)
- `/admin/payments` (1625줄)
- `/admin/scoring` (693줄), `/admin/upload` (654줄), `/admin/control-tower` (629줄)
- `/admin/destinations`, `/admin/attractions` 같은 마스터 데이터 (master-data CRUD 패턴 동일하게 빠른 처리 가능)
- `/admin/blog/*` 12개 페이지
- `/admin/marketing/*` 16개 페이지

### 한 페이지당 평균 소요 시간 (실측)
- **마스터 데이터 CRUD** (departing-locations, land-operators) — **약 3~5분**
- **단순 리스트** (alerts, prompts, reviews, applications) — **약 5~8분**
- **폼·다이얼로그 포함** (gdpr) — **약 7~10분**
- **복잡 페이지** (1000줄+) — **세션당 1~2개만 안정적**

### 마이그레이션 룰 (모든 페이지 공통)

| Find | Replace |
|---|---|
| `bg-white` (어드민 카드/패널) | `bg-admin-surface` |
| `bg-slate-50` / `bg-gray-50` | `bg-admin-bg` 또는 `bg-admin-surface-2` |
| `text-slate-500` / `text-gray-500` | `text-admin-muted` |
| `text-slate-700` / `text-gray-700` | `text-admin-text-2` |
| `text-slate-900` / `text-gray-900` | `text-admin-text` |
| `text-slate-400` | `text-admin-muted-2` |
| `border-slate-200` / `border-gray-200` | `border-admin-border-mid` |
| `border-slate-100` / `border-gray-100` | `border-admin-border` |
| `rounded-xl` (어드민 카드) | `rounded-admin-md` |
| `rounded-2xl` (어드민 모달) | `rounded-admin-lg` |
| `rounded-lg` (어드민 작은 요소) | `rounded-admin-sm` |
| `shadow-sm` (어드민) | `shadow-admin-xs` |
| `shadow-md` (어드민) | `shadow-admin-sm` |
| `shadow-lg` (어드민) | `shadow-admin-md` |
| 인라인 `font-bold text-xl` (페이지 제목) | `<PageHeader />` 패턴 |
| 인라인 KPI 숫자 박스 | `<KpiCard />` 패턴 |
| 인라인 표 (<table>) | `<DataTable />` 또는 admin-data-table 클래스 |

### 우선순위 큐 (임팩트 순)

#### Week 1 — 사장님 매일 보는 화면
- [ ] `/admin` 메인 대시보드 (`page.tsx` + `AdminPageClient`)
- [ ] `/admin/inbox` Inbox 액션
- [ ] `/admin/bookings` 예약 목록 + `BookingsPageClient`
- [ ] `/admin/bookings/[id]` 예약 상세 + `BookingDetailClient`
- [ ] `/admin/bookings/new` 신규 예약
- [ ] `/admin/bookings/[id]/edit` 예약 수정

#### Week 2 — 상품
- [ ] `/admin/packages` 상품 관리 + `PackagesPageClient`
- [ ] `/admin/products/stub` Stub 등록
- [ ] `/admin/products/review` 검수 게이트
- [ ] `/admin/upload` 업로드
- [ ] `/admin/ir-preview` IR 미리보기 + `IrPreviewClient`
- [ ] `/admin/products/from-mrt` MRT 상품 임포트
- [ ] `/admin/products/[id]/distribute` 배포 설정

#### Week 3 — 고객 + 마스터데이터
- [ ] `/admin/customers` 고객 목록
- [ ] `/admin/customers/[id]` 고객 상세
- [ ] `/admin/payments` 입금 관리 + `PaymentsPageClient`
- [ ] `/admin/payments/[id]` 입금 상세
- [ ] `/admin/payments/reconcile` 입금 조정
- [ ] `/admin/booking-guide` 예약 안내문
- [ ] `/admin/land-operators` 랜드사
- [ ] `/admin/attractions` 관광지
- [ ] `/admin/attractions/unmatched` 미매칭 관광지
- [ ] `/admin/destinations` 여행지
- [ ] `/admin/departing-locations` 출발지

#### Week 4 — 정산/세금
- [ ] `/admin/settlements` 정산 대시
- [ ] `/admin/land-settlements` 랜드사 정산
- [ ] `/admin/ledger` 통합 장부
- [ ] `/admin/tax` 세무
- [ ] `/admin/invoice` 송장
- [ ] `/admin/concierge` 컨시어지
- [ ] `/admin/concierge/transactions/[id]` 트랜잭션 상세
- [ ] `/admin/free-travel` 자유여행 + `FreeTravelPageClient`
- [ ] `/admin/free-travel/settlements` 자유여행 정산

#### Week 5 — 마케팅·블로그·콘텐츠
- [ ] `/admin/marketing` 마케팅 대시
- [ ] `/admin/marketing/card-news` + `CardNewsListPageClient`
- [ ] `/admin/marketing/card-news/[id]` 카드뉴스 상세
- [ ] `/admin/marketing/card-news/[id]/v2` 카드뉴스 에디터 v2
- [ ] `/admin/marketing/campaigns` 캠페인
- [ ] `/admin/marketing/creatives` 크리에이티브
- [ ] `/admin/marketing/published` 발행 완료
- [ ] `/admin/marketing/auto-publish` 자동 발행
- [ ] `/admin/marketing/blog-export` 블로그 → 카드뉴스
- [ ] `/admin/marketing/brand-kits` 브랜드 키트
- [ ] `/admin/blog` 블로그 목록
- [ ] `/admin/blog/write` 블로그 에디터
- [ ] `/admin/blog/[id]` 블로그 상세
- [ ] `/admin/blog/queue` 발행 큐 + `BlogQueueClient`
- [ ] `/admin/blog/categories` 카테고리
- [ ] `/admin/blog/rankings` 순위
- [ ] `/admin/blog/system` 시스템
- [ ] `/admin/blog/topical` 토픽
- [ ] `/admin/blog/ads` 광고
- [ ] `/admin/blog/policy` 정책

#### Week 6 — AI·운영심화·시스템
- [ ] `/admin/jarvis` 자비스
- [ ] `/admin/jarvis/rag` RAG
- [ ] `/admin/generate` AI 생성
- [ ] `/admin/qa` Q&A
- [ ] `/admin/platform-learning` AI 플라이휠
- [ ] `/admin/agent-mas` MAS
- [ ] `/admin/extractions/corrections` AI 교정
- [ ] `/admin/prompts` + `[key]` 프롬프트 레지스트리
- [ ] `/admin/control-tower` OS 관제탑
- [ ] `/admin/ops` 크론
- [ ] `/admin/escalations` 에스컬레이션
- [ ] `/admin/scoring/page` + `funnel` + `trends` 점수
- [ ] `/admin/alerts` 운영 알림
- [ ] `/admin/gdpr` GDPR
- [ ] `/admin/affiliates` + `[id]` + `affiliate-analytics` + `affiliate-promo-report`
- [ ] `/admin/applications` 파트너 신청
- [ ] `/admin/partner-preview`
- [ ] `/admin/rfqs` + `[id]`
- [ ] `/admin/competitor-prices`
- [ ] `/admin/analytics`
- [ ] `/admin/content-hub` + `[cardNewsId]`
- [ ] `/admin/content-queue`
- [ ] `/admin/content-analytics`
- [ ] `/admin/content-gaps`
- [ ] `/admin/search-ads`
- [ ] `/admin/tenants` + `[tenantId]/bot`
- [ ] `/admin/tenant-tokens`
- [ ] `/admin/reviews`
- [ ] `/admin/flight-alerts`
- [ ] `/admin/kakao-import`
- [ ] `/admin/band-import`
- [ ] `/admin/tmp-pipeline`
- [ ] `/admin/settings/integrations`

#### 모바일 어드민 (`/m/admin`) — 별도 트랙
- [ ] `/m/admin` 모바일 대시
- [ ] `/m/admin/bookings` + `[id]`
- [ ] `/m/admin/payments` + `[id]`
- [ ] `/m/admin/notifications`
- [ ] `/m/admin/timeline/[bookingId]`
- [ ] `/m/admin/settings`
- [ ] `/m/admin/login`
- [ ] `/m/admin/offline`

---

## 🟢 Phase 5 — Customer Web (감사 완료, 안정 상태)

### 감사 결과
- **15개 공개 페이지** + **20개 customer 컴포넌트** (~4,173 lines)
- ✅ **GlobalNav 단일화** — 모든 공개 페이지에서 일관 사용
- ✅ **Admin 톤 누출 0건** — `text-admin-*` 가 customer 페이지에 사용된 곳 없음
- ✅ **text-price·rounded-card·rounded-btn customer 토큰 일부 사용 중** (PackageCard·HeroBanner·SearchBar 등)
- ✅ **Pretendard 폰트 글로벌 적용** (next/font/local)

### 권장 추가 작업 (선택, P0~P2)

| 우선순위 | 작업 | 임팩트 | 위험도 |
|---|---|---|---|
| **P0** | text-h1·text-h2·text-body·text-micro 미사용 페이지(예: DepartureCalendar)의 Tailwind 범용 → customer 토큰 전환 | 중 (일관성) | 낮음 |
| **P1** | 페이지 hero 영역 typography·spacing 일관 점검 | 중 (시각 정렬) | 낮음 |
| **P2** | 색상 hardcoded(`emerald-900` 등) → 공식 토큰화 | 낮음 | 중 (특수 그라디언트 보존 필요) |

**진행 방식:** 어드민 Phase 4-B 와 동일하게, 사장님이 페이지 묶음 지정 → 정밀 마이그레이션. **Customer Web 은 의도적으로 "Toss 톤" 이라 어드민과 분리 운영** — bulk 토큰 치환 같은 일괄 변경은 위험.

### 추가 결정 필요
- 모바일 랜딩 전면 재설계 (`feedback_landing_redesign` 메모리 — 모두투어/Voyager 스타일) 와 본 디자인 시스템 작업의 우선순위 정렬 필요

---

## 🛡 회귀 안전망

- **TypeScript:** `npm run type-check` — 매 PR 마다 통과
- **Visual:** `npm run test:visual` (Playwright) — Phase 4 페이지 마이그레이션 직전 baseline 갱신 권장 (`npm run test:visual:update`)
- **Lighthouse / Speed:** 어드민은 모니터링 제외 (내부 도구). 공개사이트는 LCP < 2.5s 유지

---

## 작업 진행 방법

1. 페이지 1개 선택 (위 우선순위 큐에서)
2. **마이그레이션 룰** 표대로 hardcoded → admin 토큰 치환
3. 페이지 상단을 `<PageHeader />` 로 교체
4. KPI 박스를 `<KpiCard />` 로 교체
5. 표를 `<DataTable />` 로 또는 admin-data-table 클래스 부여
6. `npm run type-check` + 시각 확인
7. 본 문서의 체크박스 ☑ 표시
