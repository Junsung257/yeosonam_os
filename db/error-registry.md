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

1. **ERR-mobile-proof-bypass@2026-06-22** — Product registration is not complete from source/render-contract audit alone. Approval requires persisted `audit_report.mobile_browser_proof.status="pass"` for `/packages/{id}`; otherwise block with `MOBILE_BROWSER_PROOF_REQUIRED` and keep the product non-public.
2. **ERR-BAEKDU-cross-region-attraction-card@2026-06-10** — Customer attraction cards must never be created from short substring matches or stale IDs. `화산폭포` must not match Xi'an `화산`; massage/service lines must not match Bohol massage cards. Require source phrase + destination-compatible attraction region, otherwise keep text/unmatched and block public readiness through `attraction_context_mismatch`.
2. **ERR-BLOG-legacy-backfill-preview-vs-write@2026-06-09** — `audit:blog-editorial --repair-preview` can be 100/100 while the DB write path still fails full publish quality. Latest proof: `backfill:blog-quality -- --limit=10` passed 10/10 after renderer/backfill fixes, but `--limit=120` scanned 101 and still found 43 failures. → Do not run `backfill:blog-quality:write` unless the full dry-run or an intentionally scoped slug batch reports `qualityGateFailed=0`; dry-run output must include `failedGates` evidence.
3. **ERR-BLOG-editorial-intent-blindspot@2026-06-09** — Render/image/SEO audits can be 100 while article quality is still broken: wrong intent, sales tone in info posts, missing checklist/table, wall-of-text, or no required weather/preparation/itinerary block. → All publish paths must pass `intent_quality`; repeated failures must become a deterministic rule, fixture test, repair rule, or audit gate. Validate repairs with `npm run audit:blog-editorial -- --base=https://www.yeosonam.com --repair-preview --json`; write only after `evaluateBlogPublishQuality()` passes.
2. **ERR-BLOG-publish-quality-bypass@2026-06-09** — 메인 자동 발행기는 통과해도 다른 관리자/배포 경로가 `content_creatives.status`를 `published`로 바꾸면 깨진 글이 공개될 수 있음. → 모든 publish/manual publish/공개 본문 교체 경로는 `evaluateBlogPublishQuality()`를 먼저 호출하고 `quality_gate`, `seo_score`, `readability_score`, `readability_issues`를 함께 저장해야 한다. 실패 시 status 변경, 색인 요청, 공개 revalidate를 금지.
2. **ERR-BLOG-visual-blindspot@2026-06-08** — 블로그 DOM/URL 감사 100점이어도 실제 viewport에서 삭제선, 모바일 table overflow, 카드 generic image가 남을 수 있음. → `audit:blog-visual --full --strict`를 배포 전후 필수 실행하고, 본문 `<del>/<s>/<strike>`와 `~~...~~`는 일반 텍스트화, table은 모바일 overflow 방어, 카드 `/og-image.png`는 본문 첫 실제 이미지로 승격.
2. **ERR-BLOG-gsc-property-split-audit@2026-06-08** — GSC Domain property와 www/non-www URL-prefix property 공존은 정상이나 자동화는 canonical origin을 `https://www.yeosonam.com` 하나로 고정해야 함. → `audit:blog-gsc-domain --strict` 통과 후 색인 요청.
3. **ERR-FUK-spot-weekday-title-itinerary@2026-06-07** — Fukuoka spot-weekday price tables and cash-receipt notices must never leak into DAY schedule/title. `spot price`, `6/8~7/16`, weekday clusters, `1,999,-`, hotel date-surcharge notices, and standalone Yufuin/Tosu region tokens belong to price/region/evidence only; final proof is clean `/packages`, LP, and A4 render text.
4. **ERR-XIY-pkg-boundary-price-a4@2026-06-07** — 명시 `PKG` 4개 원문은 variant 라벨보다 `PKG` 경계를 우선해야 하며, `출 발 일`/`판 매 가`처럼 띄어진 제목도 deterministic 가격·날짜로 복구해야 함. A4는 `price_dates` 실제 날짜와 제목의 `N박M일`을 우선하고, 포함/불포함/선택관광 section 오염을 차단.
5. **ERR-itinerary-detail-flight-card-and-appendix@2026-06-07** — 상단 항공 헤더가 있어도 DAY 상세 항공카드는 유지해야 하며, 마지막 상품 뒤 저녁 메뉴/취소규정/현금영수증 공유 부록이 schedule로 붙으면 안 됨.
6. **ERR-catalog-split-recovery@2026-06-06** — `PKG` 다중 상품 원문이 parser 일시 실패로 1개 처리될 때 수동 분리 안내로 새면 안 됨. → 저장 준비 단계에서 `multiProducts < 2`이면 원문 deterministic split recovery를 먼저 실행하고, 복구 불가능할 때만 `CATALOG_SPLIT_REQUIRED`.
7. **ERR-shared-price-column-mix@2026-06-06** — 다중 상품 공통 가격표에서 정규화/LLM `price_tiers`가 두 컬럼을 모두 담으면 모바일/A4에 상품별 가격이 섞일 수 있음. → 원문 deterministic 가격표가 인식되면 상품 제목/숙소 기준 컬럼 선택이 `price_tiers`보다 우선.
8. **ERR-catalog-table-itinerary-pollution@2026-06-06** — 붙여넣기 표형 일정에서 지역/교통편/시간/식사/HOTEL/URL 열 값이 고객 `/packages/{id}` 일정·안내문에 섞이면 안 됨. → 표형 일정 deterministic parser가 호텔/식사/항공 segment를 분리하고, LLM 일정이 오염됐으면 원문 일정이 우선. 고객 검수 기준은 `/lp`가 아니라 `/packages/{id}`.
> **신규 ERR 추가 시**: 상세는 먼저 해당 `docs/errors/*.md`에 append하고, 이 체크리스트에서는 가장 오래된 항목(현재 #10)을 제거한 뒤 새 항목을 #1로 prepend한다.


---

## Recent Blog Error Addition

- **ERR-BLOG-editorial-intent-blindspot@2026-06-09** - Existing render/image/SEO audits missed editorial quality. New `intent_quality` gate blocks wrong intent, info/product tone mismatch, missing weather/preparation/itinerary required blocks, weak tables/lists, and paragraph walls; `blog-editorial-repair` provides safe deterministic repair and `audit:blog-editorial --repair-preview` is the production-wide recovery proof.
- **ERR-BLOG-mobile-heading-flex-overflow@2026-06-09** - `.prose-blog h2` must not use unwrapped flex layout for generated article headings. Long FAQ/body text and `.num` emphasis nodes can become flex items and push mobile page width even when images, tables, and Markdown artifacts are clean. Keep heading text in normal wrapping flow and require `audit:blog-visual --strict` before/after deploy.
- **ERR-BLOG-external-image-client-block@2026-06-09** - Pexels image URLs returned HTTP 200 from server audits, but real browsers/ad blockers could block `images.pexels.com`, leaving article images with `naturalWidth=0` and collapsed height. Blog render and card surfaces must pass proxyable external images through `/api/blog/image`, and visual audits must judge browser-loaded `naturalWidth`, not URL reachability alone.

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
