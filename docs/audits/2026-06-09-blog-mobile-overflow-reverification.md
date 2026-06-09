# Blog Mobile Overflow Reverification - 2026-06-09

## Scope

- Production sample after image proxy deployment: `https://www.yeosonam.com`
- Failed visual sample before this fix:
  - `/blog/5-post-1k2q` mobile: `page_horizontal_overflow=269px`
  - `/blog/nagasaki-34` mobile: `page_horizontal_overflow=647px`

## Root Cause

The article image, Markdown artifact, strikethrough, and table checks were clean. The remaining overflow came from `.prose-blog h2 { display:flex }`.

When generated article headings accidentally contained long FAQ/body text and `.num` strong nodes, those nodes became separate flex items. On mobile, the flex row did not wrap as normal article text, so the document width expanded and fixed UI elements followed that expanded scroll width.

## Fix

- Keep the numbered `h2::before` badge.
- Return `.prose-blog h2` to normal block text flow.
- Use `h2::before` margin and vertical alignment for the badge instead of making the heading itself an unwrapped flex container.

## Verification

CSS injection against the production pages before deployment:

| URL | Before | After |
|---|---:|---:|
| `/blog/5-post-1k2q` | 269px | 0px |
| `/blog/nagasaki-34` | 647px | 0px |

Required final verification after deployment:

```bash
npm run audit:blog-visual -- --base=https://www.yeosonam.com --limit=12 --surface-limit=6 --strict --json
npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json
npm run audit:blog-images -- --base=https://www.yeosonam.com --json
npm run audit:blog-seo -- --base=https://www.yeosonam.com --json
```

## Prevention

- Blog typography for generated content must allow natural mobile wrapping.
- Do not use unwrapped `display:flex` on article headings, paragraphs, list rows, or FAQ-like generated blocks.
- `audit:blog-visual --strict` is the blocking gate for mobile horizontal overflow.
