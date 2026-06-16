# SEO Improvement Plan - 2026-06-15

## Applied Now

- Fixed site-wide brand metadata in `src/app/layout.tsx`.
  - Restored stable Korean title, description, keywords, author, publisher, Open Graph, Twitter, and RSS labels.
  - Replaced stale `sameAs` links with the public brand profiles currently visible in search:
    - `https://blog.naver.com/yeosonam_official`
    - `https://blog.naver.com/yeosonam_`
    - `https://www.instagram.com/yeosonam/`
    - `https://www.threads.com/@yeosonam`
    - `https://www.youtube.com/@yeosonam`
- Fixed duplicate Organization `sameAs` references in `src/app/about/page.tsx` and `src/lib/blog-jsonld.ts`.
- Cleaned the public blog index metadata in `src/app/blog/page.tsx`.
- Added indexability protection to `src/app/blog/destination/[dest]/page.tsx`.
  - Destination collection pages now return `noindex, follow` when they have no matching posts and no packages.
  - Destination post lookup now checks up to 1,000 recent posts and uses both text inclusion and slug matching.

## Immediate Next Fixes

- Slug cleanup for weak recent posts:
  - `/blog/post-uo8h` -> `/blog/summer-airport-crowd-2026`
  - `/blog/7-post-s3gj` -> `/blog/july-overseas-flight-ticket-checklist`
  - `/blog/vs-vs-esim-7` -> `/blog/overseas-roaming-esim-usim-checklist`
  - `/blog/7-guide-f4aa5972` -> `/blog/europe-free-travel-cost-itinerary-2026`
- Add 301 redirects from weak slugs to improved slugs before changing stored slugs.
- Run a DB-backed blog quality pass for template contamination:
  - duplicated phrases such as `이 이 정보`
  - placeholder terms such as `현지 현지`
  - markdown artifacts such as `==...==`
  - title/body mismatch where SERP title says one topic but H1/body starts another.
- Review destination collection pages with zero visible posts after deployment and keep them `noindex` until they have useful content.

## Search Channel Strategy

- Google:
  - Prioritize official site clusters: destination + cost, weather, preparation, itinerary.
  - Keep destination hub pages indexable only when they have enough internal links and unique summary content.
  - Submit updated sitemap and request indexing for the top 10 revised URLs.
- Naver:
  - Use Naver Blog as the main exposure surface for local intent queries such as `부산 출발`, `패키지`, `7월 8월 특가`, `일정 요금`.
  - Link each Naver Blog post to the matching official product or guide URL.
  - Keep profile naming consistent across `yeosonam_official`, `yeosonam_`, Instagram, Threads, and YouTube.

## Verification

- `npx eslint src/app/layout.tsx src/app/blog/page.tsx "src/app/blog/destination/[dest]/page.tsx" src/lib/blog-jsonld.ts src/app/about/page.tsx`
- `npm run type-check -- --pretty false`
