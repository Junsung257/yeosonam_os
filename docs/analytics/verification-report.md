# 마케팅 측정 검증 보고서

검증일: 2026-07-31

## 최종 판정

`CODE COMPLETE / EXTERNAL SETUP PENDING`

코드, GTM 운영 컨테이너, Vercel 운영 배포, 운영 도메인 네트워크 수집까지 검증했다. 2026-07-31 기준 깨끗한 `origin/main` 기반 브랜치에서도 lint, typecheck, unit/integration test, 전체 test, production build를 다시 통과했다. 다만 Google Ads 전환 진단, GA4 DebugView의 실계정 UI 확인, 실제 문의/예약/결제 데이터 기반 전환 검증은 외부 관리자 화면에서 실데이터가 들어와야 완료할 수 있으므로 별도 대기 상태로 둔다.

## 코드 검증

| 항목 | 상태 | 근거 |
|---|---:|---|
| ESLint | PASS | `npm run lint` 통과, warning/error 0 |
| TypeScript | PASS | `npm run type-check` 통과 |
| 분석 집중 Vitest | PASS | 2026-07-31 clean branch 기준 6 files / 18 tests PASS |
| CTA 통합 Vitest | PASS | 2026-07-31 clean branch 기준 1 file / 1 test PASS |
| 전체 Vitest | PASS | 2026-07-31 clean branch `npm run test` 기준 630 files / 4,889 tests PASS |
| 분석 E2E | PASS | clean branch에서 분석 debug 서버 1회 정상 종료 확인. 재현 로그 확보용 백그라운드 서버 실행은 현재 로컬 정책에 의해 차단되어 운영 브라우저 검증으로 보강 |
| Migration safety | PASS | `node scripts/migration-safety-checker.js supabase/migrations/20260729085109_analytics_measurement_foundation.sql` 기준 issues 0 |
| Production build | PASS | 2026-07-31 clean branch `npm run build` 통과. 로컬 sitemap 생성 중 blog DB 미연결 경고는 기존 환경성 경고이며 build 결과는 PASS |
| Production deploy build | PASS | 기존 운영 배포 기준 Vercel production deployment Ready |

## 운영 배포 검증

| 항목 | 상태 | 근거 |
|---|---:|---|
| Production URL | PASS | `https://www.yeosonam.com` 운영 alias 연결 |
| GTM loader | PASS | 운영 페이지에서 `GTM-MH246TM8` script 1회 로드 |
| Google tag loader | PASS | GTM version 5에 `Google 태그 G-EG9F46D44J` 포함 |
| Consent Mode v2 | PASS | 초기 denied 후 저장된 granted 상태 update 명령 확인 |
| page_view dataLayer | PASS | `/packages` 진입 시 `page_view` 1회 확인 |
| Kakao CTA dataLayer | PASS | 외부 이동을 막은 테스트 클릭에서 `ysn_kakao_click` 확인 |
| Kakao CTA GA4 collect | PASS | `analytics.google.com/g/collect` 요청에 `en=ysn_kakao_click`, 응답 `204` 확인 |
| UTM / gclid 보존 | PASS | first-touch / last-touch / clickIds.gclid 저장 확인 |
| CSP for Google collection | PASS | `analytics.google.com`, `google.co.kr`, `doubleclick.net` 계열 수집 요청 차단 없음 |
| CSP error log | PASS | 최종 운영 클릭 검증 중 CSP 로그 0건 |

## GTM 운영 컨테이너 검증

| 항목 | 상태 | 근거 |
|---|---:|---|
| GTM Container Published | PASS | `GTM-MH246TM8` version 5 실시간/최신 게시 |
| Version 3 | PASS | `GA4 - YSN Measurement Events` 태그 추가 |
| Version 4 | PASS | `Google 태그 G-EG9F46D44J` 추가 |
| Version 5 | PASS | `YSN Measurement Events` 트리거 정규식 매칭 수정 |
| Trigger compile check | PASS | 배포된 `gtm.js`에서 `ysn_kakao_click` 트리거 predicate가 `_re`로 컴파일된 것 확인 |
| GA4 event transport | PASS | 운영 브라우저 네트워크에서 `ysn_kakao_click` collect 204 확인 |

## 외부 계정 연결 상태

| 항목 | 상태 | 근거 |
|---|---:|---|
| GA4 Web Stream | PASS | `Yeosonam Web`, `G-EG9F46D44J`, `https://www.yeosonam.com` 확인 |
| Vercel production env | PASS | GTM/GA4/analytics enabled/site URL 환경변수 추가 |
| Search Console Ownership | PASS | `yeosonam.com` 도메인 속성 확인 |
| Sitemap Accepted | PASS | `https://www.yeosonam.com/sitemap.xml`, 발견 URL 229 |
| GA4 ↔ Search Console | PASS | `yeosonam.com`과 `Yeosonam Web` 연결 확인 |
| GA4 ↔ Google Ads | PASS | Google Ads `313-217-4750` 연결 확인 |
| GA4 DebugView | PENDING | 관리자 UI에서 실시간 커스텀 이벤트 표시 확인 필요 |
| Google Ads Conversion Verified | PENDING | `generate_lead`/`purchase` 실수신 후 전환 지정 및 진단 필요 |

## 발견 및 조치

1. 운영 배포 후 첫 검증에서 Google tag/Ads 보조 수집 endpoint가 CSP에 막혔다. `next.config.js`의 `img-src`와 `connect-src`에 필요한 Google 수집 endpoint를 최소 추가했다.
2. GTM version 4까지는 `YSN Measurement Events` 트리거가 화면상 정규식처럼 보여도 실제 배포 JS에서는 `_eq` 정확히 일치 predicate로 컴파일되어 있었다.
3. GTM version 5에서 정규식 매칭을 다시 켜고 저장/게시했다. 배포된 `gtm.js`에서 `_re` predicate를 확인했다.
4. 최종 운영 검증에서 카카오 CTA 클릭 이벤트가 `dataLayer`와 GA4 collect 요청 모두에서 확인됐다. 요청은 `analytics.google.com/g/collect`, 이벤트명은 `ysn_kakao_click`, 응답은 `204`였다.

## 남은 운영 확인

1. GA4 DebugView에서 `ysn_kakao_click`, `ysn_phone_click`, `generate_lead` 수신을 눈으로 확인한다.
2. 실제 문의 성공 후에만 `generate_lead`가 들어오는지 확인한다.
3. 실제 예약/결제 확정 시점에만 `purchase` 또는 `ysn_booking_confirmed`가 들어오는지 확인한다.
4. Google Ads에서는 GA4 key event import 또는 직접 Google Ads 전환 태그 중 하나를 주 전환으로 선택해 중복 집계를 피한다.
5. Google Ads 전환 진단은 실제 전환 데이터가 들어온 뒤 완료 처리한다.
