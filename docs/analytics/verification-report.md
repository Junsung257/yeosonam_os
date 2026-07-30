# 마케팅 측정 검증 보고서

검증일: 2026-07-30

## 코드 검증

| 항목 | 상태 | 근거 |
|---|---:|---|
| ESLint | PASS | `npm run lint` 통과, warning/error 0 |
| TypeScript | PASS | `npm run type-check` 통과 |
| 분석 집중 Vitest | PASS | 7 files / 19 tests PASS |
| 전체 Vitest | PASS | `npm run test` — 627 files / 4,872 tests PASS |
| 분석 E2E | PASS | `npx playwright test -c playwright.e2e.config.ts tests/e2e/analytics-measurement.spec.ts` — 2 tests PASS |
| Production deploy build | PASS | Vercel production deployment `dpl_6uPPWEBGDYanoH1w7125Gn8HfhoG` Ready |

## 운영 배포 검증

| 항목 | 상태 | 근거 |
|---|---:|---|
| Production URL | PASS | `https://www.yeosonam.com` alias 연결 |
| GTM loader | PASS | 운영 페이지에서 `GTM-MH246TM8` script 1회 로드, HTTP 200 |
| Google tag loader | PASS | 운영 페이지에서 `G-EG9F46D44J` script 로드, HTTP 200 |
| Consent Mode v2 | PASS | 초기 denied 후 저장된 granted 상태 update 명령 확인 |
| page_view dataLayer | PASS | `/packages` 진입 시 `page_view` 1회 확인 |
| Kakao CTA dataLayer | PASS | 실제 카카오 이동을 막은 상태에서 `ysn_kakao_click` 확인 |
| UTM / gclid 보존 | PASS | first-touch / last-touch / clickIds.gclid 저장 확인 |
| CSP for Google collection | PASS | `www.google.com/ccm`, `ad.doubleclick.net`, `googleadservices.com` 수집 요청 200/204, CSP 오류 0 |
| GA4/Google collection transport | PARTIAL | `page_view` 계열 Google 수집 요청은 확인. `ysn_kakao_click`은 dataLayer와 gtag 명령까지 확인했으나, 별도 커스텀 이벤트 collect 요청은 자동화 네트워크 로그에서 아직 확인되지 않음 |

## 외부 계정 설정 검증

| 항목 | 상태 | 근거 |
|---|---:|---|
| GTM Container Published | PASS | `GTM-MH246TM8`, version `2026-07 measurement foundation` 게시 확인 |
| GA4 Web Stream | PASS | `Yeosonam Web`, `G-EG9F46D44J`, `https://www.yeosonam.com` 확인 |
| Vercel production env | PASS | GTM/GA4/analytics enabled/site URL 환경변수 추가 |
| Search Console Ownership | PASS | `yeosonam.com` 도메인 속성 확인 |
| Sitemap Accepted | PASS | `https://www.yeosonam.com/sitemap.xml` 성공, 발견 URL 229 |
| GA4 ↔ Search Console | PASS | `yeosonam.com`과 `Yeosonam Web` 연결 확인 |
| GA4 ↔ Google Ads | PASS | Google Ads `313-217-4750` 연결 완료 1건 확인 |
| GA4 DebugView | PENDING | 관리자 UI에서 커스텀 이벤트 수신 확인 필요 |
| Google Ads Conversion Verified | PENDING | `generate_lead`/`purchase` 실제 수신 후 전환 지정 및 진단 필요 |

## 발견 및 조치

1. 운영 배포 후 첫 검증에서 GTM이 보이지 않았던 것은 테스트 스크립트가 과거 임시 동의 저장키를 사용했기 때문이었다. 실제 키 `ys_consent_preferences_v2`로 재검증하여 GTM 로드를 확인했다.
2. Google tag/Ads 보조 수집 요청이 CSP에 일부 차단되어 `next.config.js`의 `connect-src`와 `img-src`에 `https://www.google.com`, `https://ad.doubleclick.net`을 최소 추가했다.
3. 재배포 후 CSP 오류는 0건으로 해소되었고 Google 수집 요청은 200/204 응답을 받았다.
4. `ysn_kakao_click`은 앱 이벤트, dataLayer 이벤트, GTM 브릿지의 gtag 명령까지 확인되었다. 다만 GA4 커스텀 이벤트 네트워크 hit는 별도 확인이 필요하므로 `FULLY VERIFIED`로 표시하지 않는다.

## 남은 운영 확인

1. GTM Preview 또는 Tag Assistant에서 `ysn_kakao_click`, `ysn_phone_click`, `generate_lead`가 GA4 Event 태그를 실제 fire하는지 확인한다.
2. 필요하면 GTM 컨테이너에 네이티브 GA4 Event 태그를 이벤트별로 추가한다. 앱 코드에는 Google Ads 전환 라벨을 하드코딩하지 않는다.
3. GA4 DebugView에서 `page_view`, `ysn_kakao_click`, `ysn_phone_click`, `generate_lead`를 확인한다.
4. 실제 문의 성공 후에만 `generate_lead`가 들어오는지 검증한다.
5. 실제 결제/예약 확정 시에만 `purchase` 또는 `ysn_booking_confirmed`가 들어오는지 검증한다.
6. Google Ads에서는 GA4 key event import 또는 직접 Google Ads 전환 태그 중 하나를 주 전환으로 선택하고 중복 집계를 피한다.
