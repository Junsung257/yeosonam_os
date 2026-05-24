# 어드민 대시보드 개선 플랜

> **작성일:** 2026-05-24  
> **목표:** Supabase 키워드 성과 테이블 연동 + 사이드바 메뉴 확장 + 메인 대시보드 광고 KPI 위젯

---

## 0. 핵심 결정: 접근 방식

**결론: 현재 코드베이스 내에서 필요한 부분만 추가/수정**

세 가지 후보를 검토한 결과:

| 접근 방식 | 평가 |
|-----------|------|
| shadcnblocks.com 디자인 MCP 활용 | shadcnblocks는 **랜딩/마케팅 페이지용 컴포넌트**가 대부분. 어드민 대시보드(차트 밀집, 데이터 위주)에는 적합하지 않음. |
| GitHub 오픈소스 shadcn 대시보드 템플릿 | shadcn/ui 공식 `dashboard-01` 예제(sidebar + KPI + 차트)는 이미 현행 구조와 유사. 굳이 템플릿 전체를 도입할 필요 없음. |
| **현행 코드베이스 내 추가/수정** ✅ | keyword-stats 페이지(이미 존재) + search-ads 페이지(이미 존재) + 메인 대시보드(이미 8+ 위젯)를 Supabase와 연결만 하면 됨. **변경량 최소, 리스크 최소.** |

---

## 1. 전체 작업 분해

### Phase A — Supabase 연동 기반 정비 (하루, 2개 파일)

| # | 작업 | 파일 | 난이도 |
|---|------|------|--------|
| A1 | `keyword-brain.ts`의 `savePerformanceToDB()`를 클라이언트에서도 호출할 수 있게 분리. 현재 서버 전용(`supabaseAdmin`)이므로 `fetch('/api/admin/keyword-stats')`로 우회하거나, 서버 액션을 만든다. | `src/lib/keyword-brain.ts` | 중 |
| A2 | search-ads 페이지에서 키워드 동기화 후 Supabase에 자동 upsert하도록 `fetchAllPerformance()` 성공 시점에 `savePerformanceToDB()` 호출 추가 | `src/app/admin/search-ads/page.tsx` | 중 |

**상세:**  
- `keyword-brain.ts`의 `savePerformanceToDB()`는 현재 서버 환경 전용(import `supabaseAdmin`). 클라이언트에서 호출할 방법이 없음.  
- 가장 안전한 방법: `src/app/api/admin/keyword-stats/route.ts`에 `POST` 메서드 추가 — upsert 전용 엔드포인트.  
- search-ads 페이지에서 `fetchAllPerformance()` 완료 후 POST 요청. 이미 `yeosonam_keyword_archive` localStorage에도 저장하고 있으므로, 이 localStorage 데이터를 잠시 보존한 뒤 점진적으로 Supabase로 이전.

---

### Phase B — 메인 대시보드 광고 KPI 위젯 (2일, 3개 파일)

| # | 작업 | 파일 | 난이도 |
|---|------|------|--------|
| B1 | `AdMetricsWidget` 신규 컴포넌트 생성 — `/api/admin/keyword-stats` 호출, KPI 카드 4개 (일간 지출, 클릭, CTR, ROAS) | `src/components/admin/AdMetricsWidget.tsx` | 하 |
| B2 | `AdPerformanceSparkline` 신규 컴포넌트 생성 — 최근 7일 지출/ROAS 트렌드 sparkline (recharts) | `src/components/admin/AdPerformanceSparkline.tsx` | 하 |
| B3 | `AdminPageClient.tsx` Zone 2(현황 KPI) 또는 Zone 3(분석) 영역에 위젯 배치. 적절한 위치: **Zone 2 말미 또는 Zone 3 AIInsights 바로 아래** | `src/app/admin/AdminPageClient.tsx` | 하 |

**상세:**  
- `AdMetricsWidget`은 기존 `TwoTrackKPI`, `CashflowChart`와 동일한 카드 스타일 사용.  
- `/api/admin/keyword-stats`는 CRON_SECRET Bearer 인증 필요. **이 API는 어드민 페이지에서 그대로 호출할 수 없음** (`verifyCronOrAdmin()`이 요구하는 인증을 클라이언트가 가지고 있지 않음).  
  - **해결책 1 (권장):** `withAdminGuard()`를 적용한 별도 API 라우트 생성 → `GET /api/admin/keyword-stats`는 cron 전용 유지, 새 경로 `GET /api/admin/keyword-stats-dashboard`를 만들고 `withAdminGuard`로 보호.  
  - **해결책 2:** 기존 `keyword-stats` API에 `withAdminGuard`도 함께 허용하도록 `verifyCronOrAdmin()` 확장.  
  - Phase B1의 전제 조건으로 위 API 라우트 분리/수정이 필요함.

---

### Phase C — 사이드바 메뉴 정리 (0.5일, 1개 파일)

| # | 작업 | 파일 | 난이도 |
|---|------|------|--------|
| C1 | 마케팅 그룹 아래 `NavDivider '검색광고'` 서브그룹 추가. 기존 `search-ads` / `keyword-stats`를 이 서브그룹 아래로 이동. | `src/components/AdminLayout.tsx` | 하 |
| C2 | (선택) `optimization-log` 메뉴 추가 — `/api/admin/keyword-stats`의 `optimization_log` 테이블 조회 페이지 | `src/app/admin/optimization-log/page.tsx` (신규) | 중 |

**현재 사이드바 마케팅 그룹 구조 (변경 전):**

```
마케팅
├── [캠페인/소재]
│   ├── 광고 캠페인 (/admin/marketing)
│   ├── 검색광고 (/admin/search-ads)      ← 여기
│   ├── 키워드 성과 (/admin/keyword-stats) ← 여기
│   ├── ...
├── [TMP 파이프라인]
│   ├── ...
├── [콘텐츠]
│   ├── ...
├── [블로그]
│   ├── ...
```

새 구조는 `NavDivider '검색광고'` 아래 세 개 하위 메뉴로 묶음:

```
├── [검색광고]                              ← NavDivider 추가
│   ├── 키워드 관리 (/admin/search-ads)
│   ├── 키워드 성과 (/admin/keyword-stats)
│   ├── 최적화 로그 (/admin/optimization-log) [신규]
```

---

### Phase D — 최적화 로그 페이지 (1.5일, 2개 파일 + API)

| # | 작업 | 파일 | 난이도 |
|---|------|------|--------|
| D1 | `GET /api/admin/keyword-stats/optimization-log` 엔드포인트 — `optimization_log` 테이블 조회 (날짜/액션/키워드 필터, 페이지네이션) | `src/app/api/admin/keyword-stats/optimization-log/route.ts` | 중 |
| D2 | `OptimizationLogPage` 클라이언트 컴포넌트 작성 — 테이블 표시 + 액션별 배지 + 날짜 필터 | `src/app/admin/optimization-log/page.tsx` | 중 |

---

### Phase E — 검색광고 페이지 Supabase 연동 마무리 (1일, 1개 파일)

| # | 작업 | 파일 | 난이도 |
|---|------|------|--------|
| E1 | search-ads 페이지에 Supabase 데이터 로드 fallback 추가 — localStorage에 데이터가 없으면 keyword_performance_daily에서 과거 7일치 조회 | `src/app/admin/search-ads/page.tsx` | 중 |
| E2 | 키워드 추출/입찰 최적화 결과를 Supabase keyword_performances 테이블에 저장하는 서버 액션 추가 | `src/lib/keyword-brain.ts` | 중 |

---

## 2. 의존성 그래프 (실행 순서)

```
A1 (POST API 추가) ──┬── A2 (search-ads에서 POST 호출)
                     │
                     └── B 전제조건 ── B1 (API 분리) ── B2 (Sparkline) ── B3 (위젯 배치)

C1 (사이드바) ── C2 (optimization-log 메뉴) ── D1 (optimization-log API) ── D2 (페이지)

E1 ── E2 (마무리, B/A 완료 후)
```

**권장 실행 순서:** `Phase A → Phase B → Phase C → Phase D → Phase E`

---

## 3. 각 작업 예상 시간

| Phase | 작업 분량 | 예상 시간 | 병렬 가능 |
|-------|----------|-----------|-----------|
| A | 2개 파일 수정 | 2시간 | 부분 가능 (A1 단독) |
| B | 3개 파일 신규/수정 | 3-4시간 | B1/B2 병렬 가능 |
| C | 1개 파일 수정 | 30분 | A/B와 무관 |
| D | 1개 API + 1개 페이지 | 2-3시간 | A/B와 무관 |
| E | 1개 파일 수정 | 1-2시간 | A 완료 후 |

**총 예상:** 순차 8-12시간, 병렬 시 5-7시간

---

## 4. 리스크 & 주의사항

| 리스크 | 대응 |
|--------|------|
| `keyword-stats` API가 CRON_SECRET 인증만 허용 → 클라이언트에서 401 | B 전제조건: 기존 API 유지 + `withAdminGuard`를 허용하는 새 경로 추가 |
| `savePerformanceToDB()`가 서버 전용 (`supabaseAdmin`) | A1: POST 엔드포인트 추가로 해결 |
| search-ads 페이지 457줄, AdminPageClient 1731줄 — 파악 시간 필요 | 위에서 파악 완료. 변경 지점 최소화. |
| keyword_performance_daily에 실제 데이터가 없으면 위젯이 빈 상태로 표시 | 빈 상태 UI + "데이터가 없습니다. Cron 최적화가 실행되면 자동 수집됩니다." 메시지 처리 |

---

## 5. 제안: Phase 순서

1. **Phase A** — 기반 정비 (Supabase POST upsert API + search-ads 연동)
2. **Phase B** — 메인 대시보드 광고 KPI 위젯 (가시적 성과)
3. **Phase C** — 사이드바 정리 (5분 작업, 바로 배포 가능)
4. **Phase D** — 최적화 로그 페이지 (별도 페이지, Phase C 의존)
5. **Phase E** — 검색광고 페이지 Supabase 연동 마무리 (가장 복잡, 마지막에)
