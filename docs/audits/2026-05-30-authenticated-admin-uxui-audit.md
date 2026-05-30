# 인증 포함 어드민 UX/UI 감사

- 감사일: 2026-05-30 KST
- 대상: `www.yeosonam.com` 로그인 후 `/admin` 정적 라우트 104개, 모바일 대표 어드민 화면 18개
- 계정: 실행 시 환경 변수로만 주입, 파일 저장 없음
- 데이터 보호: 로그인 이후 `POST/PUT/PATCH/DELETE` 116건 차단
- 산출물:
  - `docs/audits/2026-05-30-authenticated-admin-audit.json`
  - `docs/audits/2026-05-30-auth-admin-screens/`

보정 확인: 변경 방지용 POST 차단이 401을 만든 것인지 분리하기 위해 `/admin` 단일 화면을 POST 차단 없이 재검증했다. 결과는 동일하게 `/api/admin/session`, `/api/admin/alerts`, `/api/admin/badge-counts`, `/api/admin/ai-credits`, `/api/admin/scoring/widget` 401이 발생했다. 따라서 공통 admin API 401은 감사 방식의 부작용이 아니라 실제 로그인 세션/권한 처리 문제로 본다.

## 요약

로그인은 성공했고, 정적 어드민 104개 라우트 중 로그인 페이지로 튕긴 화면은 없었다. 다만 4개 하드 오류, 32개 네트워크 오류 포함 페이지, 122개 콘솔 오류 포함 페이지, 20개 가로 overflow 페이지가 잡혔다.

핵심은 세 가지다.

1. 어드민 모바일 레이아웃은 공통 사이드바가 화면을 밀어내서 대부분의 대표 화면이 실제 사용하기 어렵다.
2. 로그인은 됐지만 다수 어드민 API가 401을 반환한다. `/api/admin/session`, `/api/admin/alerts`, `/api/admin/badge-counts`가 반복된다.
3. 프로덕션에 존재하지 않는 어드민 라우트가 소스/내비 또는 감사 경로에 남아 있다.

## P0

### 1. 어드민 모바일 공통 레이아웃 붕괴

- 증상: 390px 모바일에서 좌측 사이드바가 약 208px를 고정 점유하고, 본문이 오른쪽으로 밀려 주요 표/버튼/입력창이 잘린다.
- 영향 화면: `/admin`, `/admin/bookings`, `/admin/packages`, `/admin/attractions`, `/admin/jarvis`, `/admin/blog`, `/admin/settlements` 등 모바일 대표 18개 중 대부분.
- 근거:
  - `docs/audits/2026-05-30-auth-admin-screens/mobile-admin-bookings.png`
  - `docs/audits/2026-05-30-auth-admin-screens/mobile-admin-packages.png`
  - `docs/audits/2026-05-30-auth-admin-screens/mobile-admin-attractions.png`
- 개선안:
  - 768px 미만에서는 사이드바를 기본 숨김 + drawer로 전환.
  - 본문 wrapper는 `margin-left` 고정 대신 responsive class로 분기.
  - 테이블 화면은 카드형 모바일 row 또는 `overflow-x-auto` 컨테이너 안으로 제한.

### 2. 로그인 후 어드민 공통 API 401 반복

- 증상: 로그인 성공 후에도 많은 페이지에서 `/api/admin/session`, `/api/admin/alerts`, `/api/admin/badge-counts`가 401.
- 영향: 알림/배지/세션 표시가 불안정하고 콘솔 오류가 모든 운영 화면의 기본 상태가 된다.
- 대표 화면: `/admin`, `/admin/bookings`, `/admin/analytics`, `/admin/blog`, `/admin/upload`, `/admin/settlements`.
- 개선안:
  - 클라이언트 Supabase 로그인 쿠키와 서버 admin API 인증 쿠키/미들웨어 기준을 맞춘다.
  - session API 실패 시 전역으로 한 번만 처리하고, 페이지마다 중복 fetch하지 않도록 admin shell에서 캐시한다.
  - 401을 정상 비로그인 상태로 처리할지, 로그인 세션 불일치 오류로 처리할지 UX를 분리한다.

### 3. 프로덕션 404 어드민 라우트

- 증상:
  - `/admin/marketing/command-center` 404
  - `/admin/marketing/system-health` 404
- 영향: 소스상 라우트 또는 링크 기대와 배포 결과가 다르다. 운영자가 진입하면 dead-end.
- 개선안: 배포 누락인지, 라우트 폐기인지 결정 후 sitemap/nav/추천 링크/코드 파일을 정리한다.

## P1

### 4. `/admin/packages`, `/admin/tax` React hydration 오류

- 증상: 두 페이지에서 Minified React error #418 발생.
- 영향: 서버 HTML과 클라이언트 렌더가 불일치한다. 사용자가 보는 값/정렬/상태가 재렌더 중 흔들릴 수 있다.
- 개선안: 날짜/랜덤/locale/클라이언트 전용 값이 SSR에 섞였는지 확인하고, 클라이언트 전용 컴포넌트 또는 deterministic formatting으로 분리한다.

### 5. 표 기반 화면의 가로 폭 과다

- 증상:
  - `/admin/bookings` 데스크톱 overflow 약 1818px, 모바일 약 2778px
  - `/admin/blog/queue` 데스크톱 table overflow 약 1203px
  - `/admin/packages`, `/admin/settlements`, `/admin/blog` 모바일 overflow 큼
- 개선안:
  - 반복 운영 테이블은 column priority를 정의한다.
  - 모바일: 핵심 3~4개 필드만 카드로 표시하고 나머지는 detail sheet.
  - 데스크톱: 표는 페이지 전체 overflow가 아니라 표 컨테이너 내부 스크롤로 가둔다.

### 6. 어드민 대시보드 KPI 가독성

- 증상: `/admin` 대시보드 첫 화면은 카드 밀도는 좋지만 일부 카드가 낮은 대비/disabled처럼 보여 실제 우선순위가 약하다.
- 개선안:
  - "실무자 경고판"은 P0 action 중심으로 압축.
  - 금액/KPI는 동일 단위·동일 baseline을 카드 안에 고정.
  - 비활성 카드와 값 0 카드의 시각 언어를 구분.

### 7. 이미지/데이터 skeleton이 실제 빈 상태처럼 보임

- 증상: `/admin/attractions` 모바일에서 skeleton 카드가 오래 남아 보이고, 상단 카운트가 세로로 쪼개진다.
- 개선안:
  - loading skeleton은 본문 폭 보정 후 표시.
  - 카운트/액션 버튼 영역은 mobile wrap 또는 collapsed toolbar로 전환.

## P2

### 8. CSP 오류 전역 반복

공개 페이지와 동일하게 어드민 122개 감사 결과 전부에서 `connect-src https://o*.sentry.io` invalid source 오류가 반복된다. CSP source를 `https://*.sentry.io` 또는 실제 DSN host로 교정한다.

### 9. 직접 Supabase REST 404

`keyword_performance_daily`, `web_vitals` 직접 REST 요청이 404를 낸다. 테이블 미존재/권한/환경 차이인지 확인하고, 운영 화면은 서버 API를 통해 schema fallback을 제공하는 편이 낫다.

### 10. 운영 화면의 추천 바/상단 헤더 폭 정책

여러 모바일 overflow의 공통 원인이 상단 header + 추천 shortcut row가 sidebar 폭과 함께 고정되는 구조다. 추천 shortcut은 모바일에서 가로 스크롤 칩으로 만들되, 페이지 전체 폭을 늘리지 않게 `min-w-0`와 `overflow-x-auto`를 반드시 적용한다.

## 다음 수정 순서

1. Admin shell 모바일 drawer 전환
2. Admin API 401 공통 인증/세션 처리 정리
3. 404 라우트 정리 또는 배포 포함
4. `/admin/packages`, `/admin/tax` hydration 오류 수정
5. bookings/packages/blog/settlements 테이블 반응형 정책 적용
6. CSP Sentry source 수정
