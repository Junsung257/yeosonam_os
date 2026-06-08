# 2026-06-08 Blog Production Visual Audit

## Summary

- 대상: `https://www.yeosonam.com/blog`, `/blog` 탭/필터 일부, 최신 공개 글 표본.
- 사용자 신고: 목록 사진 미노출, 상세 사진 깨짐, 삭제선 노출, 모바일 표 깨짐.
- 기존 감사의 한계: render/image/SEO DOM 감사는 URL 응답과 DOM 구조를 봤지만 실제 viewport, lazy image loading, 삭제선 DOM, 모바일 table overflow를 보지 못했다.
- 이번 조치: `npm run audit:blog-visual`을 추가해 desktop/mobile 실제 브라우저 기준으로 이미지, 삭제선, raw markdown, table overflow, horizontal overflow, 카드 이미지 누락을 점검한다.

## Evidence

### Production Before Fix

Command:

```bash
npm run audit:blog-visual -- --base=https://www.yeosonam.com --limit=3 --surface-limit=3 --json
```

Result after lazy-scroll correction:

- score: 75
- failed viewport checks: 3 / 12
- confirmed issues:
  - `visible_strikethrough_or_deletion`: `/blog/zhangjiajie-weather`
  - `table_overflow`: `/blog/bohol-food-best-food`, `/blog/zhangjiajie-weather` mobile
  - `page_horizontal_overflow`: mobile article pages
- image correction: first run falsely reported broken article images because lazy images were checked before scroll. The audit now scrolls before judging image load state.

### Local After Fix

Command:

```bash
npm run audit:blog-visual -- --base=http://localhost:3002 --limit=3 --surface-limit=3 --json
```

Result:

- score: 100
- passed viewport checks: 12 / 12
- broken or tiny visible images: 0
- visible strikethrough/deletion: 0
- table overflow: 0
- horizontal overflow: 0
- raw markdown artifacts: 0

### GSC / Domain Check

Command:

```bash
npm run audit:blog-gsc-domain -- --json
```

Result:

- score: 100
- `http://yeosonam.com`, `http://www.yeosonam.com`, `https://yeosonam.com`, `https://www.yeosonam.com` all converge to `https://www.yeosonam.com`.
- canonical and `og:url` for `/blog/zhangjiajie-weather` are both `https://www.yeosonam.com/blog/zhangjiajie-weather`.
- `https://www.yeosonam.com/sitemap.xml` is reachable and uses the preferred `www` origin.

## Root Cause

- Prior fixes improved markdown rendering, image URL reachability, and SEO metadata, but did not include a visual viewport audit.
- The old image audit could pass while a real page still had table overflow or deletion styling.
- The first visual audit also exposed a testing blind spot: lazy images must be scrolled into view before judging `naturalWidth`.
- Some blog cards used the generic `/og-image.png` as `og_image_url`. The UI now promotes the first actual body image when the card image is generic.
- Current development originally started on a non-main feature branch; this work was restarted from `origin/main` on `codex/blog-system-100-recovery`.

## Prevention Gate

Before blog-related deploys:

```bash
npm run type-check
npx vitest run src/lib/blog-renderer.test.ts
npm run audit:blog-render:browser -- --base=http://localhost:3002 --json
npm run audit:blog-images -- --base=http://localhost:3002 --json
npm run audit:blog-seo -- --base=http://localhost:3002 --json
npm run audit:blog-visual -- --base=http://localhost:3002 --full --strict
npm run audit:blog-gsc-domain -- --strict
```

After production deploy:

```bash
npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json
npm run audit:blog-images -- --base=https://www.yeosonam.com --json
npm run audit:blog-seo -- --base=https://www.yeosonam.com --json
npm run audit:blog-visual -- --base=https://www.yeosonam.com --full --strict
npm run audit:blog-gsc-domain -- --strict
```

Indexing must run only after these production checks pass.
