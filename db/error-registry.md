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

1. **ERR-BLOG-prompt-contract-drift@2026-06-22** — 블로그 품질 게이트/렌더러는 형광펜 제거 방향으로 고쳤지만 live publisher prompt가 여전히 `==...==` 강조를 지시할 수 있었음. → 블로그 프롬프트 변경은 자동화 동작 변경으로 보고 ERR-BLOG 회귀 테스트와 SSOT/에러 문서 중 하나를 반드시 남긴다.
2. **ERR-mobile-proof-bypass@2026-06-22** — Product registration is not complete from source/render-contract audit alone. Approval requires persisted `audit_report.mobile_browser_proof.status="pass"` for `/packages/{id}`; otherwise block with `MOBILE_BROWSER_PROOF_REQUIRED` and keep the product non-public.
3. **ERR-BLOG-supabase-rest-522@2026-06-18** — Supabase REST/Data API 522 or timeout can make public blog data look empty/delayed. → Do not treat degraded DB reads as "no posts"; keep response timers, stale-success cache, and public warmup/revalidation paths.
4. **ERR-BLOG-queue-contract-drift@2026-06-17** — Queue producers and publisher can drift on `angle_type`, `source`, unknown fields, and published-state reconciliation. → Every producer must use `normalizeBlogTopicQueueRow()` and publisher must normalize before DB write.
5. **ERR-BLOG-briefless-generation@2026-06-16** — Raw queue topics can drift into irrelevant articles if used as the writing source of truth. → Every automatic info post must build and persist `generation_meta.content_brief` before LLM writing.
6. **ERR-BLOG-topic-fit-editorial-gate@2026-06-15** — High SEO/render scores can still hide bad topic fit, machine slugs, placeholder text, excessive highlights, generic images, or malformed article structure. → Publish only after topic fit, editorial quality, render, image, SEO, readability, and indexing evidence pass.
7. **ERR-BLOG-legacy-backfill-preview-vs-write@2026-06-09** — `audit:blog-editorial --repair-preview` can pass while DB write still fails full publish quality. → Do not run `backfill:blog-quality:write` unless the full dry-run or scoped slug batch reports `qualityGateFailed=0`.
8. **ERR-BLOG-editorial-intent-blindspot@2026-06-09** — Render/image/SEO audits can be 100 while article quality is still broken: wrong intent, sales tone in info posts, missing checklist/table, wall-of-text. → All publish paths must pass `intent_quality`.
9. **ERR-BLOG-publish-quality-bypass@2026-06-09** — 메인 자동 발행기는 통과해도 다른 관리자/배포 경로가 `content_creatives.status`를 `published`로 바꾸면 깨진 글이 공개될 수 있음. → 모든 public publish path는 `evaluateBlogPublishQuality()`를 먼저 호출해야 한다.
10. **ERR-BLOG-visual-blindspot@2026-06-08** — 블로그 DOM/URL 감사 100점이어도 실제 viewport에서 삭제선, 모바일 table overflow, 카드 generic image가 남을 수 있음. → `audit:blog-visual --full --strict`를 배포 전후 필수 실행한다.
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
