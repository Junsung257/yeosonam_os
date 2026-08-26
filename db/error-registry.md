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

1. **ERR-admin-login-public-env-drift@2026-08-24** — Production had no public Supabase URL, the current publishable key was not statically inlined into the browser bundle, and the build did not reject the drift. → Statically reference the current key, use an ephemeral auth client, and block Production builds missing URL/public key/`ADMIN_EMAILS`.
2. **ERR-BLOG-slot-quality-learning-retry-source-drift@2026-07-28** — Daily quota could burst at the first slot, sub-95 components could pass, policy learning used stale columns, failed rows could requeue indefinitely, and a passing research row could retain a stale secondary fare. → Enforce cumulative KST slot quota, 95 component floors, global policy `meta`, versioned retry suppression, direct-fetch semantic gates, and current-official-source precedence.
3. **ERR-BLOG-info-fallback-and-ops-signal-leak@2026-07-15** — 정보성 생성 실패를 범용 fallback으로 대체해 발행할 수 있었고 상품 수·활성 상품 수·예약 신호를 정보글 프롬프트에 주입했음. → fallback은 공개 발행 금지, 정보성 프롬프트에는 내부 운영값 전달 금지.
4. **ERR-BLOG-prompt-contract-drift@2026-06-22** — 블로그 품질 게이트/렌더러는 형광펜 제거 방향으로 고쳤지만 live publisher prompt가 여전히 `==...==` 강조를 지시할 수 있었음. → 블로그 프롬프트 변경은 자동화 동작 변경으로 보고 ERR-BLOG 회귀 테스트와 SSOT/에러 문서 중 하나를 반드시 남긴다.
5. **ERR-mobile-proof-bypass@2026-06-22** — Product registration is not complete from source/render-contract audit alone. Approval requires persisted `audit_report.mobile_browser_proof.status="pass"` for `/packages/{id}`; otherwise block with `MOBILE_BROWSER_PROOF_REQUIRED` and keep the product non-public.
6. **ERR-BLOG-supabase-rest-522@2026-06-18** — Supabase REST/Data API 522 or timeout can make public blog data look empty/delayed. → Do not treat degraded DB reads as "no posts"; keep response timers, stale-success cache, and public warmup/revalidation paths.
7. **ERR-BLOG-queue-contract-drift@2026-06-17** — Queue producers and publisher can drift on `angle_type`, `source`, unknown fields, and published-state reconciliation. → Every producer must use `normalizeBlogTopicQueueRow()` and publisher must normalize before DB write.
8. **ERR-BLOG-briefless-generation@2026-06-16** — Raw queue topics can drift into irrelevant articles if used as the writing source of truth. → Every automatic info post must build and persist `generation_meta.content_brief` before LLM writing.
9. **ERR-BLOG-topic-fit-editorial-gate@2026-06-15** — High SEO/render scores can still hide bad topic fit, machine slugs, placeholder text, excessive highlights, generic images, or malformed article structure. → Publish only after topic fit, editorial quality, render, image, SEO, readability, and indexing evidence pass.
10. **ERR-BLOG-legacy-backfill-preview-vs-write@2026-06-09** — `audit:blog-editorial --repair-preview` can pass while DB write still fails full publish quality. → Do not run `backfill:blog-quality:write` unless the full dry-run or scoped slug batch reports `qualityGateFailed=0`.
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
| 마케팅 / Ad OS | `docs/errors/marketing.md` | 캠페인, 외부 광고 발행, 소재, spend guardrail |
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
