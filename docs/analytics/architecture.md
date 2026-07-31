# 여소남 마케팅 측정 아키텍처

## 감사 결과

- 런타임: Next.js 15.5 App Router, React 19, Vercel, Supabase.
- 전역 경계: `src/app/layout.tsx` → `LayoutClientWidgets` → `AnalyticsProvider`.
- 공개 전환면: `/packages`, `/packages/[id]`, `/lp/[id]`, `/api/leads`, 예약 상태 API, 검증 결제 완료 API.
- 기존 위험: 직접 GA4 로더가 동의·Preview 구분 없이 실행됐고, 공개 `/api/tracking`이 브라우저가 보낸 매출·원가를 전환으로 수락했다.
- 마이그레이션: 직접 GA4 로더를 제거하고 앱은 비즈니스 이벤트만 `dataLayer`에 기록한다. GA4·Google Ads 매핑은 GTM에서 한다.

## 데이터 흐름

```text
방문 → Consent Mode v2 선택
  → allowlist UTM/클릭 ID first/last-touch 저장
  → typed dataLayer 이벤트
  → GTM
     ├─ GA4
     ├─ Google Ads Conversion Linker/전환/리마케팅
     └─ 선택적 Clarity·향후 네이버/Meta

문의 저장 성공 → analytics_server_events(generate_lead)
예약 최종 확정 → analytics_server_events(ysn_booking_confirmed)
검증 결제 + 공급사 예약 완료 → analytics_server_events(purchase)
  → analytics_delivery_jobs
     ├─ GA4 Measurement Protocol(설정과 client_id가 있을 때)
     └─ Google Ads Data Manager(외부 설정 전 blocked)
```

## 신뢰 경계

- 클릭 이벤트는 행동 신호일 뿐 매출이 아니다.
- `generate_lead`는 `/api/leads`가 lead를 저장한 뒤에만 클라이언트와 서버 원장에 남는다.
- `purchase`는 `/api/checkout/complete`가 서버 검증 결제, 공급사 예약, 재고 차감을 모두 완료한 뒤에만 남는다.
- 예약 상태 `confirmed`는 결제 없는 최종 확정용 `ysn_booking_confirmed`다.
- 취소 API의 입력 `refund_amount`는 실제 환불 원장이 아니므로 `refund`를 보내지 않는다. 실제 환불 ledger SSOT가 완성된 뒤 연결한다.
- `analytics_server_events.idempotency_key`와 delivery destination별 unique key가 중복 집계를 막는다.

## 저장 정책

- 브라우저: 동의 후 `ys_attribution_v1` localStorage, 기본 90일.
- DB: `leads.attribution_snapshot`, `bookings.attribution_snapshot.analytics`.
- 허용값: UTM 5종, `gclid`, `gbraid`, `wbraid`, `nclid`, referrer host, landing path, 시각, GA client ID.
- 금지값: 이름, 전화, 이메일, 주소, 자유 입력, 고객 메모 및 기타 PII.

## 배포 순서

1. Supabase migration 적용.
2. Vercel 환경변수 설정.
3. 코드 배포.
4. GTM 컨테이너 설정·Preview.
5. GA4 Realtime/DebugView 확인.
6. Google Ads·Search Console 연결.

Migration 전에 코드를 먼저 배포해도 리드 저장 자체는 analytics 원장 오류를 best-effort로 격리하지만, `leads.attribution_snapshot` 컬럼이 없으면 lead insert가 실패하므로 DB migration을 먼저 적용한다.
