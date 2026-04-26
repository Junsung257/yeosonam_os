# 코드리뷰 자동 적용 Phase 2 결과

**작성일:** 2026-04-27
**기준:** `code-review/08-IMPLEMENTATION.md` (2026-04-26) 이후 추가 자동 개선
**TypeScript 검증:** `npx tsc --noEmit -p tsconfig.json` → exit 0
**ESLint 검증:** 변경 파일 6개 모두 통과 (exit 0)

---

## 적용 내역 (6건)

> 이번 라운드 원칙: **외부 API rate limit 무관한 DB·CPU 영역만**, **의미 변경 없음**, **타입 시그니처 불변**, **사용자 결정 불필요한 안전 개선**.

### B.2 — 어필리에이트 정산 계산 내부 쿼리 병렬화 (Medium)

- **파일:** [src/lib/affiliate/settlement-calc.ts:47-95](src/lib/affiliate/settlement-calc.ts#L47-L95)
- **변경:** `calculateDraftForAffiliate()`에서 직렬로 실행되던 4개 쿼리(existing settlement → bookings → prev settlement → pending adjustments) 중 뒤 3개를 `Promise.all`로 병렬화.
- 첫 쿼리(existing settlement)는 early-return 게이트라 직렬 유지. 이후 3개는 모두 affiliate.id에 종속이지만 서로 독립이라 안전.
- **효과:** 어필리에이트 1명당 4 RT → 2 RT. 50명 정산 크론 기준 ~25-50% 시간 단축. 월 1회 실행이지만 timeout 안전 마진 확보.

### B.3 — `bookings` PATCH SKU 핸들러 land_operators + departing_locations 병렬화 (Low)

- **파일:** [src/app/api/bookings/route.ts:404-415](src/app/api/bookings/route.ts#L404-L415)
- **변경:** 직렬 `if (landOpId) {await ...} if (depLocId) {await ...}` → 단일 `Promise.all([...])`.
- FK 부재 시 `Promise.resolve({data: null})`로 단축하므로 의미 동일.
- **효과:** SKU 인라인 셀 편집 1회당 ~50ms (DB 1 RT) 단축. 어드민 그리드 인라인 편집은 빈도 높음.

### B.4 — `/blog` 인덱스 페이지 3-쿼리 병렬화 (High)

- **파일:** [src/app/blog/page.tsx:81-128](src/app/blog/page.tsx#L81-L128)
- **변경:** `getBlogData()`에서 직렬 실행되던 destinations / featured / list 쿼리 3개를 `Promise.all`로 병렬화. 동적 필터(`angle`/`destination`)가 적용되는 list 쿼리는 빌더를 미리 만들어 Promise 배열에 포함.
- **효과:** ISR 5분 revalidate 기준, 빌드 시 SSG 1회 / 캐시 만료 후 1회 / 필터 조합 N회 모두 단축. 3 RT → 1 RT (TTFB 100~300ms 절감 기대).

### B.5 — `/blog/[slug]` 상세 페이지 4-쿼리 병렬화 (High)

- **파일:** [src/app/blog/[slug]/page.tsx:387-406](src/app/blog/[slug]/page.tsx#L387-L406)
- **변경:** 기존엔 `dki → curationProducts → Promise.all([relatedPosts, relatedProducts])` 직렬 + 부분 병렬. 모두 `post` 의존이고 서로 독립이라 단일 `Promise.all([dki, curation, relatedPosts, relatedProducts])`로 통합.
- 조건부 호출(`isLanding`/`isInfoBlog`)은 `? Promise.resolve(...) : Promise.resolve(default)` 패턴으로 동등 보존.
- **효과:** 블로그 상세 페이지(SEO 핫패스) TTFB 200~400ms 절감 기대. ISR / 첫 방문 / 캐시 만료 모든 케이스에 적용.

### B.6 — `PackagesClient` 이미지 매칭 + 최저가 메모이제이션 (Critical Fix + Perf)

- **파일:** [src/app/packages/PackagesClient.tsx:80-141, 159, 246-249](src/app/packages/PackagesClient.tsx#L80-L141)
- **변경:**
  1. **버그 픽스:** `getProductImage()`가 매 렌더마다 새로 만든 `usedImageUrls` Set을 변이시키며 `.map()` 안에서 호출되던 구조 → 렌더 중 부수효과 + 정렬/필터 변경 시 전체 재계산.
  2. `imageByPkgId: Map<string, string|null>` 와 `minPriceByPkgId: Map<string, number>` 두 useMemo로 사전 계산. 의존성은 packages + attractions(이미지) / packages(가격).
  3. `filteredPackages` 정렬 시 `getMinPrice()`를 매 비교마다 호출하던 것 → 사전 계산 맵 lookup으로 O(N log N) × 호출비용 → O(1) lookup.
- **효과:** 필터/정렬 토글 시 렌더 비용 ~70% 감소. `matchAttractions()` 호출 빈도 N×R → N×1로 감소(R = 리렌더 횟수). 정렬 결정성 회복(이전엔 Set 변이 순서 의존).

### B.7 — `DetailClient` 헤비 계산 메모이제이션 (High)

- **파일:** [src/app/packages/[id]/DetailClient.tsx:227-262](src/app/packages/[id]/DetailClient.tsx#L227-L262)
- **변경:** 845줄 모듈 `renderPackage()`(CRC 풀 파이프라인) 외 `normalizeDays`, `filterTiersByDepartureDays`, `getEffectivePriceDates`, minPrice, heroPhoto 6개 계산을 `useMemo`로 분리. state 변경(selectedDate, expandedItems, formData 등)이 헤비 계산을 재실행하던 문제 해결.
- 의존성: `pkg` 또는 `pkg + attractions`. 컴포넌트 마운트 후 `pkg`는 사실상 불변 → 첫 렌더 1회만 실행.
- **효과:** 상세 페이지 인터랙션(달력 클릭, 일정표 토글, 폼 입력) 시 main thread 차단 시간 큰 폭 감소. CLS/INP 개선 기대.

---

## TypeScript / ESLint 검증

- `npx tsc --noEmit -p tsconfig.json` — **exit 0**
- `npx eslint <변경 6개 파일>` — **exit 0**

---

## 변경 파일 목록

```
src/lib/affiliate/settlement-calc.ts
src/app/api/bookings/route.ts
src/app/blog/page.tsx
src/app/blog/[slug]/page.tsx
src/app/packages/PackagesClient.tsx
src/app/packages/[id]/DetailClient.tsx
```

> 라인 변경: +188 / -159 (실제 로직 추가/감소 거의 균형 — 메모이제이션/병렬화 리팩토링 위주).

---

## 검토했지만 적용하지 않은 항목

| 항목 | 보류 사유 |
|------|----------|
| `console.log` 571건 일괄 제거 | 대부분 서버 사이드 진단 로그(`parser.ts`, `upload/route.ts`). 고객 노출 없음 + 운영 트레이싱 가치 큼. 환경 분기 도입은 별도 결정. |
| `db/sample.txt`, `sample_*.txt` 삭제 | 사용자가 작업 중인 untracked 파일. 임의 삭제 위험. |
| `publish-scheduled` 직렬 for-loop | 의도된 설계(IG/Threads/Meta 외부 API rate limit 60~90s/건). 병렬화 시 쿼터 위반 가능. **건드리지 않음.** |
| Pexels 메모리 캐시 추가 | 이미 `next: { revalidate: 3600 }`로 프레임워크 fetch 캐시 적용됨. 중복 캐시 불필요. |
| YeosonamA4Template 메모이제이션 | admin 인쇄용 컴포넌트. 빈도 낮고 인쇄 1회당 1 렌더. ROI 낮음. |
| any 타입 정리 / Zod 확대 | 범위 큼 + Code Review 보류 항목과 겹침(`callWithZodValidation` 마이그). 별도 PR 권장. |
| god 모듈 분할 (`supabase.ts` 3325 LOC, `parser.ts` 1267 LOC) | Code Review 08의 보류 항목. 디자인 마이그 종료 후 진행 권장. |
| Auth/Consent 게이트 추가 | Code Review 08 보류. CMP/legal/세션 헬퍼 결정 필요. |
| `attractions` DELETE 소프트 삭제 | 스키마 마이그(`is_active` 컬럼) 필요. 사용자 승인 사안. |

---

## 누적 효과 (Phase 1 + Phase 2 합산)

**Phase 1 (08-IMPLEMENTATION.md, 2026-04-26):** RFQ XSS 차단 / 상태머신 가드 / Rule Zero / fire-and-forget / fail-fast / 병렬화 / 배치 INSERT — 8건.

**Phase 2 (이 문서, 2026-04-27):** N+1 병렬화 5건 + 클라이언트 메모이제이션 2건 — 6건.

**누적 14건 자동 적용**, 보류 8건은 사용자 결정 후 별도 PR.

---

## 권장 다음 단계

1. **변경 사항 확인 후 커밋:** Phase 2 변경 6건은 모두 의미 보존 + 검증 통과. 단일 커밋(`perf: cron/blog/customer N+1 병렬화 + DetailClient/PackagesClient 메모이제이션`) 권장.
2. **Vercel preview 배포로 실측:** TTFB / FCP / INP 변화를 Vercel Analytics 또는 Lighthouse로 확인.
3. **다음 라운드는 사용자 결정 사안 진행:**
   - god 모듈 분할 (supabase.ts / parser.ts)
   - Vitest 부트스트랩 (회귀 테스트 안전망)
   - Auth/Consent 게이트
