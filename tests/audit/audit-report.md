# 페이지 전수 감사 리포트 (Playwright Runtime Audit)

**날짜:** 2026-05-09
**대상:** 169 pages (static + dynamic w/ sample IDs)
**Dev 서버:** http://127.0.0.1:3000 (NODE_ENV=development)

## 요약

| Metric | Count |
|---|---|
| 전체 페이지 | 169 |
| ✅ 이슈 없음 | 30 |
| 🔴 P0 (블로커) | 28 |
| 🟠 P1 (사용성) | 109 |
| 🟡 P2 (마이너) | 2 |
| 평균 로드(dev) | 13320ms |

## P0 — 블로커 (28건)
> 페이지가 깨짐, 네비게이션 실패, 5xx, 페이지에 에러 문구 노출

- `/admin/affiliates/[id]` [API_5XX,PERF_VERY_SLOW] 15946ms — 5xx: 500 127.0.0.1:3000/api/affiliates?id=1&showBankInfo=false | 500 127.0.0.1:3000/api/settlements?affiliateId=1
- `/admin/attractions/unmatched` [NAV_FAIL,PAGE_ERROR,PERF_VERY_SLOW] 30056ms — pageError: navigation: page.goto: Timeout 30000ms exceeded.
Call log:
[2m  - navigating to "http://127.0.0.1:3
- `/admin/blog/[id]` [API_5XX,PERF_VERY_SLOW] 16370ms — 5xx: 500 127.0.0.1:3000/api/blog?id=1 | 500 127.0.0.1:3000/api/blog?id=1
- `/admin/blog/queue` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 15979ms — pageError: Text content does not match server-rendered HTML.
See more info here: https://nextjs.org/docs/messag | console: Warning: Text content did not match. Server: "%s" Client: "%s"%s 5. 2. PM 01:40 5. 2. 오후 01:40 
    
- `/admin/competitor-prices` [API_5XX,PERF_VERY_SLOW] 15843ms — 5xx: 500 api/admin/competitor-prices | 500 api/admin/competitor-prices
- `/admin/marketing/card-news/variants/[group_id]` [API_5XX,PERF_VERY_SLOW] 18561ms — 5xx: 500 api/card-news/generate-variants?group_id=1 | 500 api/card-news/generate-variants?group_id=1
- `/admin/packages/[id]/reviews` [API_5XX,PERF_VERY_SLOW] 19047ms — 5xx: 500 packages/1/reviews | 500 packages/1/reviews
- `/admin/products/[id]/distribute` [API_5XX,API_4XX,PERF_VERY_SLOW] 17612ms — 5xx: 500 api/content/generate-all?product_id=1 | 500 api/content/generate-all?product_id=1 | 4xx: 404 api/packages/1 | 404 api/packages/1
- `/admin/prompts/[key]` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 17478ms — pageError: An unsupported type was passed to use(): [object Object] | console: Warning: Cannot update a component (`%s`) while rendering a different component (`%s`). To locate th
- `/admin/tax` [API_5XX,PERF_VERY_SLOW] 16078ms — 5xx: 500 127.0.0.1:3000/api/tax?month=2026-04 | 500 127.0.0.1:3000/api/tax?month=2026-04
- `/admin/tenants/[tenantId]/bot` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 16520ms — pageError: An unsupported type was passed to use(): [object Object] | console: Warning: Cannot update a component (`%s`) while rendering a different component (`%s`). To locate th
- `/admin/terms-templates/[id]` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 16289ms — pageError: params.then is not a function | console: The above error occurred in the <NotFoundErrorBoundary> component:

    at TermsTemplateEditPage (we
- `/admin/tmp-pipeline` [API_5XX,PERF_VERY_SLOW] 16273ms — 5xx: 500 api/admin/tmp-pipeline?source=all&limit=100 | 500 api/admin/tmp-pipeline?source=all&limit=100
- `/auth/callback` [PAGE_ERROR] 2682ms — pageError: Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요.
- `/blog/[slug]` [ERROR_TEXT] 6614ms — errorText: "404
This page could not be found...."
- `/blog/angle/[angle]` [ERROR_TEXT] 4260ms — errorText: "404
This page could not be found...."
- `/destinations/[city]` [ERROR_TEXT] 5265ms — errorText: "404
This page could not be found...."
- `/lp/[id]` [ERROR_TEXT] 4059ms — errorText: "404
This page could not be found...."
- `/m/admin/bookings` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 16529ms — pageError: Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요. | console: The above error occurred in the <NotFoundErrorBoundary> component:

    at BookingsClient (webpack-i
- `/m/admin/bookings/[id]` [ERROR_TEXT] 2129ms — errorText: "404
This page could not be found...."
- `/m/admin/notifications` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 15908ms — pageError: Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요. | console: The above error occurred in the <NotFoundErrorBoundary> component:

    at NotificationsClient (webp
- `/m/admin/payments` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 16561ms — pageError: Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요. | console: The above error occurred in the <NotFoundErrorBoundary> component:

    at PaymentsClient (webpack-i
- `/m/admin/payments/[id]` [ERROR_TEXT] 2291ms — errorText: "404
This page could not be found...."
- `/m/admin/timeline/[bookingId]` [PAGE_ERROR,CONSOLE_ERROR,PERF_VERY_SLOW] 16577ms — pageError: Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요. | console: The above error occurred in the <NotFoundErrorBoundary> component:

    at TimelineClient (webpack-i
- `/reels/[token]` [ERROR_TEXT] 3071ms — errorText: "404
This page could not be found...."
- `/things-to-do/[region]` [ERROR_TEXT] 5399ms — errorText: "404
This page could not be found...."
- `/trip/[token]` [ERROR_TEXT] 3563ms — errorText: "404
This page could not be found...."
- `/with/[slug]` [ERROR_TEXT] 3854ms — errorText: "404
This page could not be found...."

## P1 — 사용성 영향 (109건)
> 콘솔 에러, 4xx API 실패, 깨진 링크, 매우 느린 로드 (>15s)

- `/admin/competitor-prices` [PERF_VERY_SLOW] 28654ms — no detail
- `/admin` [PERF_VERY_SLOW] 19012ms — no detail
- `/admin/_dev/ui-kit` [PERF_VERY_SLOW] 18443ms — no detail
- `/admin/affiliate-analytics` [PERF_VERY_SLOW] 17086ms — no detail
- `/admin/affiliate-promo-report` [PERF_VERY_SLOW] 16846ms — no detail
- `/admin/affiliates` [PERF_VERY_SLOW] 16143ms — no detail
- `/admin/agent-mas` [PERF_VERY_SLOW] 17096ms — no detail
- `/admin/alerts` [PERF_VERY_SLOW] 16037ms — no detail
- `/admin/applications` [PERF_VERY_SLOW] 17833ms — no detail
- `/admin/attractions` [PERF_VERY_SLOW] 18338ms — no detail
- `/admin/band-import` [PERF_VERY_SLOW] 20286ms — no detail
- `/admin/blog` [PERF_VERY_SLOW] 23837ms — no detail
- `/admin/blog/ads` [PERF_VERY_SLOW] 15740ms — no detail
- `/admin/blog/categories` [PERF_VERY_SLOW] 16795ms — no detail
- `/admin/blog/policy` [PERF_VERY_SLOW] 16069ms — no detail
- `/admin/blog/rankings` [PERF_VERY_SLOW] 15882ms — no detail
- `/admin/blog/system` [PERF_VERY_SLOW] 16639ms — no detail
- `/admin/blog/topical` [PERF_VERY_SLOW] 15724ms — no detail
- `/admin/blog/write` [PERF_VERY_SLOW] 15828ms — no detail
- `/admin/booking-guide` [PERF_VERY_SLOW] 16622ms — no detail
- `/admin/bookings` [CONSOLE_ERROR,PERF_VERY_SLOW] 16684ms — console: Warning: In HTML, whitespace text nodes cannot be a child of <%s>. Make sure you don't have any extr
- `/admin/bookings/[id]` [PERF_VERY_SLOW] 15937ms — no detail
- `/admin/bookings/[id]/edit` [PERF_VERY_SLOW] 16179ms — no detail
- `/admin/bookings/new` [PERF_VERY_SLOW] 16027ms — no detail
- `/admin/concierge` [PERF_VERY_SLOW] 16326ms — no detail
- `/admin/concierge/transactions/[id]` [API_4XX,PERF_VERY_SLOW] 17913ms — 4xx: 404 concierge/transactions/1 | 404 concierge/transactions/1
- `/admin/content-analytics` [PERF_VERY_SLOW] 18491ms — no detail
- `/admin/content-gaps` [PERF_VERY_SLOW] 16709ms — no detail
- `/admin/content-hub` [PERF_VERY_SLOW] 18900ms — no detail
- `/admin/content-queue` [PERF_VERY_SLOW] 16187ms — no detail
- `/admin/control-tower` [PERF_VERY_SLOW] 16051ms — no detail
- `/admin/customers` [PERF_VERY_SLOW] 17529ms — no detail
- `/admin/customers/[id]` [PERF_VERY_SLOW] 20265ms — no detail
- `/admin/departing-locations` [PERF_VERY_SLOW] 19247ms — no detail
- `/admin/destinations` [PERF_VERY_SLOW] 18303ms — no detail
- `/admin/dev/ui-kit` [PERF_VERY_SLOW] 16035ms — no detail
- `/admin/escalations` [PERF_VERY_SLOW] 15983ms — no detail
- `/admin/extractions/corrections` [PERF_VERY_SLOW] 19118ms — no detail
- `/admin/flight-alerts` [PERF_VERY_SLOW] 16645ms — no detail
- `/admin/free-travel` [PERF_VERY_SLOW] 16232ms — no detail
- `/admin/free-travel/settlements` [PERF_VERY_SLOW] 16269ms — no detail
- `/admin/gdpr` [PERF_VERY_SLOW] 18074ms — no detail
- `/admin/generate` [PERF_VERY_SLOW] 21529ms — no detail
- `/admin/inbox` [PERF_VERY_SLOW] 25839ms — no detail
- `/admin/invoice` [PERF_VERY_SLOW] 16971ms — no detail
- `/admin/ir-preview` [PERF_VERY_SLOW] 17204ms — no detail
- `/admin/jarvis` [PERF_VERY_SLOW] 15928ms — no detail
- `/admin/jarvis/rag` [PERF_VERY_SLOW] 15923ms — no detail
- `/admin/kakao-import` [PERF_VERY_SLOW] 16260ms — no detail
- `/admin/land-operators` [PERF_VERY_SLOW] 15897ms — no detail
- `/admin/land-settlements` [PERF_VERY_SLOW] 15945ms — no detail
- `/admin/ledger` [PERF_VERY_SLOW] 17019ms — no detail
- `/admin/marketing` [PERF_VERY_SLOW] 16547ms — no detail
- `/admin/marketing/auto-publish` [PERF_VERY_SLOW] 17640ms — no detail
- `/admin/marketing/blog-export` [PERF_VERY_SLOW] 16026ms — no detail
- `/admin/marketing/brand-kits` [PERF_VERY_SLOW] 16896ms — no detail
- `/admin/marketing/campaigns` [PERF_VERY_SLOW] 17077ms — no detail
- `/admin/marketing/card-news` [PERF_VERY_SLOW] 16506ms — no detail
- `/admin/marketing/card-news/[id]` [API_4XX,PERF_VERY_SLOW] 18049ms — 4xx: 404 api/card-news/1 | 404 api/card-news/1
- `/admin/marketing/card-news/[id]/v2` [API_4XX,PERF_VERY_SLOW] 18525ms — 4xx: 404 api/card-news/1 | 404 api/card-news/1
- `/admin/marketing/card-news/campaign/new` [API_4XX,PERF_VERY_SLOW] 17702ms — 4xx: 404 api/admin/packages?status=approved&limit=200 | 404 api/admin/packages?status=approved&limit=200
- `/admin/marketing/card-news/new` [PERF_VERY_SLOW] 21062ms — no detail
- `/admin/marketing/card-news/new-html` [PERF_VERY_SLOW] 16990ms — no detail
- `/admin/marketing/content-hub/[cardNewsId]` [PERF_VERY_SLOW] 19262ms — no detail
- `/admin/marketing/creatives` [PERF_VERY_SLOW] 21888ms — no detail
- `/admin/marketing/published` [PERF_VERY_SLOW] 26100ms — no detail
- `/admin/ops` [PERF_VERY_SLOW] 18019ms — no detail
- `/admin/packages/[id]/review` [API_4XX,PERF_VERY_SLOW] 19628ms — 4xx: 404 127.0.0.1:3000/api/packages?id=1 | 404 127.0.0.1:3000/api/packages?id=1
- `/admin/partner-preview` [PERF_VERY_SLOW,BROKEN_LINKS_2] 20038ms — no detail
- `/admin/payments` [PERF_VERY_SLOW] 19998ms — no detail
- `/admin/platform-learning` [PERF_VERY_SLOW] 17355ms — no detail
- `/admin/products/assemble-free-travel` [PERF_VERY_SLOW] 20645ms — no detail
- `/admin/products/from-mrt` [PERF_VERY_SLOW] 16550ms — no detail
- `/admin/products/review` [PERF_VERY_SLOW] 16188ms — no detail
- `/admin/products/stub` [PERF_VERY_SLOW] 30973ms — no detail
- `/admin/prompts` [PERF_VERY_SLOW] 22315ms — no detail
- `/admin/qa` [PERF_VERY_SLOW] 15886ms — no detail
- `/admin/reviews` [PERF_VERY_SLOW] 15746ms — no detail
- `/admin/rfqs` [PERF_VERY_SLOW] 15910ms — no detail
- `/admin/rfqs/[id]` [API_4XX,PERF_VERY_SLOW] 16346ms — 4xx: 404 api/rfq/1 | 404 api/rfq/1
- `/admin/scoring` [PERF_VERY_SLOW] 15824ms — no detail
- `/admin/scoring/funnel` [PERF_VERY_SLOW] 15892ms — no detail
- `/admin/scoring/trends` [PERF_VERY_SLOW] 19551ms — no detail
- `/admin/search-ads` [PERF_VERY_SLOW] 16795ms — no detail
- `/admin/settings/integrations` [PERF_VERY_SLOW] 16196ms — no detail
- `/admin/settlements` [PERF_VERY_SLOW] 16160ms — no detail
- `/admin/tenant-tokens` [PERF_VERY_SLOW] 15888ms — no detail
- `/admin/tenants` [PERF_VERY_SLOW] 15932ms — no detail
- `/admin/terms-templates` [PERF_VERY_SLOW] 15864ms — no detail
- `/admin/upload` [PERF_VERY_SLOW] 16309ms — no detail
- `/free-travel` [PERF_VERY_SLOW] 17121ms — no detail
- `/itinerary/[id]` [API_4XX,PERF_VERY_SLOW] 18471ms — 4xx: 404 127.0.0.1:3000/api/packages?id=1 | 404 127.0.0.1:3000/api/packages?id=1
- `/join/[token]` [API_4XX] 6521ms — 4xx: 404 api/join/sample-token | 404 api/join/sample-token
- `/m/admin` [PERF_VERY_SLOW] 17832ms — no detail
- `/m/admin/offline` [PERF_VERY_SLOW] 15721ms — no detail
- `/m/admin/settings` [PERF_VERY_SLOW] 15791ms — no detail
- `/mypage` [API_4XX] 2152ms — 4xx: 405 api/auth/session | 405 api/auth/session
- `/packages/[id]` [API_4XX,PERF_SLOW] 9828ms — 4xx: 404 127.0.0.1:3000/api/packages?id=1 | 404 127.0.0.1:3000/api/packages?id=1
- `/products/[id]` [API_4XX] 2968ms — 4xx: 404 127.0.0.1:3000/api/packages?id=1 | 404 127.0.0.1:3000/api/packages?id=1
- `/r/[code]/[slug]` [API_4XX] 6601ms — 4xx: 404 127.0.0.1:3000/api/packages?id=singapore-package | 404 api/influencer/track?ref=SAMPLE-CODE&pkg=singapore-package
- `/rfq/[id]` [API_4XX] 6446ms — 4xx: 404 api/rfq/1 | 404 api/rfq/1
- `/rfq/[id]/contract` [API_4XX] 6398ms — 4xx: 404 rfq/1/contract | 404 rfq/1/contract
- `/share/[code]` [API_4XX] 5689ms — 4xx: 404 127.0.0.1:3000/api/share?code=sample-code | 404 127.0.0.1:3000/api/share?code=sample-code
- `/tenant/[tenantId]/inventory` [API_4XX] 5820ms — 4xx: 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b | 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b
- `/tenant/[tenantId]/products` [API_4XX] 5812ms — 4xx: 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b | 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b
- `/tenant/[tenantId]/rfqs` [API_4XX] 6587ms — 4xx: 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b | 404 api/tenant/rfqs?tenant_id=ac59675c-0f0e-4230-b8fd-4a3857f2a83b
- `/tenant/[tenantId]/rfqs/[rfqId]` [API_4XX] 6352ms — 4xx: 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b | 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b
- `/tenant/[tenantId]/settlements` [API_4XX,PERF_SLOW] 11464ms — 4xx: 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b | 404 api/tenants/ac59675c-0f0e-4230-b8fd-4a3857f2a83b
- `/tour/[id]` [API_4XX] 3139ms — 4xx: 404 127.0.0.1:3000/api/packages?id=1 | 404 127.0.0.1:3000/api/packages?id=1

## P2 — 마이너 (2건)
> 약간 느린 로드 (8~15s), 기타 경고

- `/` [PERF_SLOW] 10188ms — no detail
- `/admin/packages` [PERF_SLOW] 14244ms — no detail

## Top 20 느린 페이지

| 페이지 | 로드(ms) | 상태 |
|---|---|---|
| `/admin/products/stub` | 30973 | 200 |
| `/admin/attractions/unmatched` | 30056 | 0 |
| `/admin/competitor-prices` | 28654 | 200 |
| `/admin/marketing/published` | 26100 | 200 |
| `/admin/inbox` | 25839 | 200 |
| `/admin/blog` | 23837 | 200 |
| `/admin/prompts` | 22315 | 200 |
| `/admin/marketing/creatives` | 21888 | 200 |
| `/admin/generate` | 21529 | 200 |
| `/admin/marketing/card-news/new` | 21062 | 200 |
| `/admin/products/assemble-free-travel` | 20645 | 200 |
| `/admin/band-import` | 20286 | 200 |
| `/admin/customers/[id]` | 20265 | 200 |
| `/admin/partner-preview` | 20038 | 200 |
| `/admin/payments` | 19998 | 200 |
| `/admin/packages/[id]/review` | 19628 | 200 |
| `/admin/scoring/trends` | 19551 | 200 |
| `/admin/marketing/content-hub/[cardNewsId]` | 19262 | 200 |
| `/admin/departing-locations` | 19247 | 200 |
| `/admin/extractions/corrections` | 19118 | 200 |

## 참고
- **dev 모드 컴파일 오버헤드** 때문에 첫 방문이 느림. 프로덕션 빌드에서는 일반적으로 5~10x 빠름.
- HTTP 200 + ERROR_TEXT 는 페이지가 응답하나 컨텐츠에 "오류" 표시 — 보통 데이터 적재 실패.
- "PAGE_ERROR" 는 페이지 라이프사이클에서 throw된 uncaught error — 가장 시급.
