# Google Ads 전환 설정

## 온라인 전환

1. GA4 연결을 완료한다.
2. Google Ads → Goals → Conversions → Summary.
3. 전환 원본을 결정한다.
   - 권장 초기값: GA4 Key event import.
   - 직접 Ads 태그를 쓰면 같은 행동의 GA4 import는 Secondary로 둔다.
4. `generate_lead`를 Primary 후보로 설정한다.
5. `ysn_kakao_click`, `ysn_phone_click`, `begin_checkout`, `ysn_price_view`는 Secondary로 둔다.
6. 결제 데이터가 충분해지면 `purchase` 또는 `ysn_booking_confirmed`를 하위 퍼널 Primary로 최적화한다.
7. 자동 태그 추가를 켜고 테스트 클릭의 `gclid`가 동의 후 문의/예약 attribution에 보존되는지 확인한다.

GTM에는 Conversion Linker를 모든 광고 랜딩 페이지에 배치한다.

## 오프라인·Enhanced Conversions for Leads

코드는 `analytics_delivery_jobs(destination=google_ads_data_manager)`까지 준비하고 외부 계정 설정 전에는 `blocked`로 둔다. 현재 PII 해싱·업로드는 기능 플래그로도 켜지지 않는다.

2026년 신규 구축은 Google Ads API의 과거 offline upload 대신 Data Manager를 우선한다.

1. Google Ads → Goals → Conversions → Summary → Create conversion action.
2. Import → CRMs, files, or other data sources → Track conversions from clicks.
3. Qualified lead/Converted lead 목표를 생성.
4. Tools → Data manager에서 데이터 소스와 conversion action을 연결.
5. Customer Data terms와 법적 동의를 운영자가 검토.
6. `lead_created`, `qualified_lead`, `booking_created`, `deposit_received`, `booking_confirmed`, `trip_completed`, `booking_cancelled` 매핑을 확정.
7. click ID, event time, value/currency, idempotency key, upload status를 사용한다.

이메일·전화는 현재 dataLayer나 delivery job에 들어가지 않는다. 향후 Enhanced Conversions 도입 시 동의, 정규화, SHA-256 해싱, 로그 마스킹, Data Manager 자격증명을 별도 보안 리뷰한다.
