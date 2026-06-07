# Blog Errors

Last updated: 2026-06-07

블로그 렌더링, 이미지 품질, SEO, slug 처리, 자동 발행 반복 오류 상세.

## ERR-blog-encoded-slug@2026-05-16

> Source: `db/error-registry.md` active checklist before docs/errors split.

- **Discovered**: 2026-05-16
- **Domain**: 블로그 slug 라우팅
- **Source vs result**: `/blog/[slug]` 정보성 블로그 25건이 일괄 404로 노출됐다. 2026년 5월 1일부터 5월 16일까지 발행된 한글 slug 글이 모두 영향을 받았다.
- **Root cause**: Next.js dynamic route가 한글 slug를 URL-encoded 문자열로 전달했는데, `[slug]` page handler가 decode 없이 `getPost(slug)`를 호출했다. Supabase 조회는 DB에 저장된 한글 원본 slug와 encoded parameter를 비교해 0건이 되었고 `notFound()`로 빠졌다.
- **Fix**: `src/lib/decode-slug.ts`의 `safeDecodeSlug()`를 도입하고 `page.tsx`와 `opengraph-image.tsx`에 모두 적용했다. `getPost` error 분기에는 `admin_alerts` 적재를 추가해 silent fail을 막았다.
- **Verification**: `tests/unit/lib/decode-slug.spec.ts` 5건.
- **Status**: FIXED
- **Prevention**: Dynamic slug route는 DB 조회 전에 반드시 decode한다. 다른 route에서 이미 쓰는 decode 패턴을 블로그 route에도 동일하게 적용한다.

---

## ERR-BLOG-render-markdown-skip@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1014`

- [ ] **ERR-BLOG-render-markdown-skip@2026-06-07** (블로그 렌더 — 본문 이미지/표/링크 마크다운 원문 노출): 공개 `/blog/zhangjiajie-weather` 및 최신 블로그 샘플 12건에서 본문에 `##`, `![이미지](url)`, `[링크](url)`, 표 파이프가 그대로 노출되고 본문 이미지 3장이 `<img>`로 렌더되지 않음. 이미지 URL은 200이라 CDN 문제가 아니라 상세 페이지 렌더 판정 문제였음. **근본 원인**: `content_creatives.blog_html`은 "마크다운 + 안전한 HTML(`<figcaption>`, `<aside>`)" 혼합 저장값인데, 상세 페이지가 `<figcaption>` 존재만 보고 전체를 raw HTML로 오판해 `marked.parse()`를 건너뜀. **해결**: ① `src/lib/blog-renderer.ts` 공용 렌더러 추가 — 마크다운 신호(`#`, `![ ]`, 링크, 표, 리스트)가 있으면 HTML 태그가 섞여도 반드시 markdown으로 파싱. ② `/blog/[slug]` 상세 페이지가 공용 렌더러만 사용. ③ `runQualityGates()`에 `render_integrity` 게이트 추가 — 렌더 결과에 literal markdown artifact 또는 누락 이미지가 있으면 발행 차단. ④ `src/lib/blog-renderer.test.ts`로 `<figcaption>` 혼합 저장값 회귀 테스트 추가. **재발 방지**: 블로그 본문 렌더 변경 시 raw HTML 여부를 `<tag>` 존재만으로 판단 금지. 공개 QA는 이미지 URL 200뿐 아니라 DOM 내 `<article img>` 수와 본문 텍스트의 `![`, `##`, `[...](...)` 잔여 여부를 함께 확인.

---

## ERR-BLOG-render-integrity-audit@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1029`

- [x] **ERR-BLOG-render-integrity-audit@2026-06-07** (블로그 전수 렌더 감사/재발 방지): 운영 `https://www.yeosonam.com/blog` 전체 링크 기준 99개 글 중 99개가 상세 본문 렌더 실패(`score=0`, `avgImages=0`, `avgArtifacts=45.2`)했다. CDN/이미지 URL 장애가 아니라 `blog_html`의 "마크다운 + 안전 HTML" 혼합값을 raw HTML로 오판한 렌더 엔진 문제였다. 해결 후 로컬 `http://localhost:3002`에서 `npm run audit:blog-render:browser -- --base=http://localhost:3002 --json` 실행 결과 99개 글 전부 통과(`score=100`, `failed=0`, `errors=0`, `avgImages=3`). 재발 방지 장치: `src/lib/blog-renderer.ts` 공용 렌더러, `render_integrity` 품질 게이트, `src/lib/blog-renderer.test.ts` 회귀 테스트, `scripts/audit-blog-render-integrity.mjs` 전수 감사 스크립트, `docs/blog-system-runbook.md` 운영 명령/100점 기준 박제. 운영 점검은 PPR/스트리밍 오탐 방지를 위해 반드시 `--browser-fallback`을 사용한다.

---

## ERR-BLOG-image-quality-gate@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1031`

- [x] **ERR-BLOG-image-quality-gate@2026-06-07** (블로그 이미지 품질/주제 적합성 하한선): 렌더 복구만으로는 Pexels/OG 이미지가 실제 글 주제에 맞는지, alt/caption이 비었는지, 같은 글 안에서 중복되는지 보장할 수 없었다. 해결: `src/lib/blog-image-quality.ts` 추가, `runQualityGates()`에 `image_quality` 게이트 연결, `scripts/audit-blog-image-quality.mjs` 전수 감사 스크립트와 `npm run audit:blog-images` 명령 등록. 게이트는 최소 이미지 수, 빈 alt, generic alt, 중복 URL, 깨진 Pexels URL, 목적지/키워드 토큰 없는 alt/caption을 발행 전에 차단한다. 한계: 실제 사진의 시각적 의미 적합성은 자동으로 완전 판정할 수 없으므로 감사 스크립트의 제목 토큰/alt/caption 검사를 하한선으로 두고, 신규 목적지 대량 발행 전에는 실패 예시와 샘플을 사람이 확인한다.

---

## ERR-BLOG-card-news-dead-image-url@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1033`

- [x] **ERR-BLOG-card-news-dead-image-url@2026-06-07** (카드뉴스 → 블로그 죽은 Storage 이미지 유입): `/blog/busan-danang-shilla-monogram-package-cn`에 Supabase `blog-assets` URL 2개가 400 응답인데 본문에 그대로 들어와 깨진 이미지가 노출될 수 있었다. 원인: `card_news.slide_image_urls`와 `publisher_bridge` 요청의 이미지 URL을 생존 확인 없이 신뢰함. 해결: `getSlideImagePublicUrlsForBlog()`와 `/api/blog/from-card-news`에서 공개 이미지 URL HEAD/GET 생존 확인 후 죽은 URL 제외, 상세 렌더 시 기존 저장 본문의 죽은 Supabase blog-assets 이미지는 제거. 최종 로컬 전수 감사: 이미지 품질 99/99 통과(`score=100`, `totalImages=299`, `failed=0`), 렌더 무결성 99/99 통과(`score=100`, `avgArtifacts=0`).

---

## ERR-BLOG-seo-threshold-too-low@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1035`

- [x] **ERR-BLOG-seo-threshold-too-low@2026-06-07** (블로그 자동 발행 SEO 기준이 상위노출 기준이 아니라 최소 발행 기준이었음): 기존 `computeSeoScore()`는 최대 125점인데 자동 발행 통과 기준이 정보성 45점/상품형 35점이라 title/meta/schema/longtail 품질이 약해도 발행될 수 있었다. 해결: `src/lib/blog-seo-scorer.ts`를 100점 만점 엔진으로 재정의하고 자동 발행 기준을 정보성 85점, 상품형 80점으로 상향. critical fail(title, meta, heading, image SEO, internal CTA, structured data, helpful content)은 점수가 높아도 발행 차단. `blog-publisher`가 `blog_topic_queue.meta.keywords`를 `secondaryKeywords`로 넘겨 롱테일/보조 키워드 커버리지를 채점한다. 예방: SEO 기준 변경 시 `src/lib/blog-seo-scorer.test.ts`와 `npm run audit:blog-seo`를 함께 통과해야 한다.

---

## ERR-BLOG-seo-audit-missing@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1037`

- [x] **ERR-BLOG-seo-audit-missing@2026-06-07** (공개 블로그 SEO 전수검사 부재): 렌더링/이미지 감사와 별개로 canonical, meta description, OG/Twitter, JSON-LD, H1/H2, 내부링크, 롱테일 제목 modifier를 실제 DOM 기준으로 전수 점검하는 명령이 없었다. 해결: `scripts/audit-blog-seo-quality.mjs`와 `npm run audit:blog-seo` 추가. 로컬 표본 10개 검증 결과 `score=100`, `failed=0`, `errors=0`, warnings 3건(short title/weak longtail modifier). 예방: 배포 전 로컬, 배포 후 운영 URL에서 `audit:blog-render`, `audit:blog-images`, `audit:blog-seo`를 모두 실행한다.
