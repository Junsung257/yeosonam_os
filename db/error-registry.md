# Error Registry Central Index

> **목적**: 반복 오류의 중앙 진입점. 상세 원인·해결·재발 방지는 `docs/errors/**`에 보관하고, 이 파일은 최근 10건 체크리스트와 도메인별 인덱스만 유지한다.
>
> **운영 규칙**:
> - 새 반복 오류 상세는 해당 `docs/errors/*.md` 파일에 추가한다.
> - 이 파일에는 최신 10개 active checklist만 둔다.
> - 일회성 감사 증거와 수치 스냅샷은 `docs/audits/**`로 보낸다.

---

## 🔴 ACTIVE CHECKLIST — 최근 10건 (self-check 대상)

> **에이전트 지침**: `/register` 또는 등록 검증 작업 시 아래 10건만 빠르게 훑고 본문 상세는 필요할 때만 점프. 이 섹션이 갱신되면 가장 오래된 항목은 본문(아래)에 남아있되 체크리스트에서는 빠진다.

1. **ERR-XIY-pkg-boundary-price-a4@2026-06-07** — 명시 `PKG` 4개 원문은 variant 라벨보다 `PKG` 경계를 우선해야 하며, `출 발 일`/`판 매 가`처럼 띄어진 제목도 deterministic 가격·날짜로 복구해야 함. A4는 `price_dates` 실제 날짜와 제목의 `N박M일`을 우선하고, 포함/불포함/선택관광 section 오염을 차단.
2. **ERR-itinerary-detail-flight-card-and-appendix@2026-06-07** — 상단 항공 헤더가 있어도 DAY 상세 항공카드는 유지해야 하며, 마지막 상품 뒤 저녁 메뉴/취소규정/현금영수증 공유 부록이 schedule로 붙으면 안 됨.
3. **ERR-catalog-split-recovery@2026-06-06** — `PKG` 다중 상품 원문이 parser 일시 실패로 1개 처리될 때 수동 분리 안내로 새면 안 됨. → 저장 준비 단계에서 `multiProducts < 2`이면 원문 deterministic split recovery를 먼저 실행하고, 복구 불가능할 때만 `CATALOG_SPLIT_REQUIRED`.
4. **ERR-shared-price-column-mix@2026-06-06** — 다중 상품 공통 가격표에서 정규화/LLM `price_tiers`가 두 컬럼을 모두 담으면 모바일/A4에 상품별 가격이 섞일 수 있음. → 원문 deterministic 가격표가 인식되면 상품 제목/숙소 기준 컬럼 선택이 `price_tiers`보다 우선.
5. **ERR-catalog-table-itinerary-pollution@2026-06-06** — 붙여넣기 표형 일정에서 지역/교통편/시간/식사/HOTEL/URL 열 값이 고객 `/packages/{id}` 일정·안내문에 섞이면 안 됨. → 표형 일정 deterministic parser가 호텔/식사/항공 segment를 분리하고, LLM 일정이 오염됐으면 원문 일정이 우선. 고객 검수 기준은 `/lp`가 아니라 `/packages/{id}`.
6. **ERR-product-prices-customer-options@2026-06-05** — 업로드는 성공했지만 고객 모바일/A4 옵션 가격이 깨질 수 있는 상태. 원인: 과거 문서와 검증이 `price_dates` 중심이라 `product_prices` 저장 실패, 동일 날짜 호텔 옵션 보존, `adult_selling_price` 누락을 blocker로 보지 못함. → 현재 SSOT는 `docs/product-registration-current-ssot.md`; 성공 기준은 `product_prices + price_dates + adult_selling_price`; 저장 실패는 rollback/blocker; golden corpus와 live readiness audit 필수.
7. **ERR-blog-encoded-slug@2026-05-16** — `/blog/[slug]` 정보성 블로그 25건 일괄 404 (5월 1~16일 발행 전부 사망). 원인: Next.js dynamic route가 한글 slug를 URL-encoded(`%EC%84%9D…`) 상태로 page handler에 전달했는데 `getPost(slug)`가 그대로 `.eq('slug', param)` → DB의 한글 원본과 매칭 0건 → `notFound()`. 다른 route(`destination/[dest]`)는 이미 `decodeURIComponent` 호출하고 있었으나 `[slug]` 만 누락. → `src/lib/decode-slug.ts` 의 `safeDecodeSlug()` 박제 + `page.tsx`/`opengraph-image.tsx` 둘 다 적용 + `getPost` error 분기에 `admin_alerts` 적재(silent fail 차단). 회귀 fixture: `tests/unit/lib/decode-slug.spec.ts` 5건.
8. **ERR-KWL-seed-fallback-and-stopwords@2026-05-15** — 계림/양삭 등록: 자동 시드 14/15건 실패 + "맛집" 단독 시드 + 17 attraction 미매칭 + "산수간쇼" 부적합 fuzzy. → V5 seeder 최후 LLM 템플릿 fallback + STANDALONE_STOP_WORDS + fuzzy length-guard + AutoMobileQA 매칭률 < 60% admin_alerts (PR #75, #76). 회귀 fixture: `src/lib/itinerary-attraction-candidates.test.ts` [ERR-KWL] 3건.
9. **ERR-audit-fuzzy** (line 752) — `audit_render_vs_source` 공백/괄호 차이로 false alarm. → 정규화 후 비교 강제.
10. **ERR-process-violation** (line 731) — `/register` Step 7 자동 감사 누락. → Step 7 MANDATORY, "수동 실행하세요" 안내 금지.

> **신규 ERR 추가 시**: 상세는 먼저 해당 `docs/errors/*.md`에 append하고, 이 체크리스트에서는 가장 오래된 항목(현재 #10)을 제거한 뒤 새 항목을 #1로 prepend한다.


---

## Domain Error Files

| Domain | Detail file | Notes |
|---|---|---|
| 상품등록 / A4 / 모바일 / 관광지 | `docs/errors/product-registration.md` | 기존 상품등록 상세 ERR의 주 보관소 |
| 블로그 | `docs/errors/blog.md` | slug, 렌더 무결성, 이미지 품질, SEO, 자동 발행 |
| 제휴 | `docs/errors/affiliate.md` | 제휴 귀속, 추천코드, 인플루언서, 커미션 |
| 정산 / ledger | `docs/errors/settlement.md` | 정산, 장부, 입금, 은행/SMS, 세무 |
| AI / 자비스 / LLM | `docs/errors/ai-ops.md` | 자비스, QA, RAG, 프롬프트, eval |
| 공통 | `docs/errors/common.md` | 문서 운영, lint, Next 업그레이드, 공통 절차 |

## Entry Format

```markdown
## ERR-YYYYMMDD-NN: [한 줄 제목]

- **발견일**: YYYY-MM-DD
- **도메인**: 상품등록 | 블로그 | 제휴 | 정산/ledger | AI/자비스/LLM | 공통
- **원문 vs 결과**: ...
- **근본 원인**: ...
- **해결책**: ...
- **검증 규칙**: ...
- **상태**: OPEN | IN_PROGRESS | FIXED
- **재발 방지**: ...
```

## Migration Note

2026-06-07 문서 정리에서 기존 단일 `db/error-registry.md` 상세 항목을 도메인별 `docs/errors/**` 파일로 분리했다. 먼저 이 파일의 active checklist를 확인한 뒤, 상세 원인과 재발 방지는 도메인 파일에서 확인한다.
