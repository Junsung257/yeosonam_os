# GA4 설정

1. Analytics → Admin → Property/Create property 및 Data streams/Web 생성.
2. Measurement ID를 GTM Google tag와 Vercel `NEXT_PUBLIC_GA4_MEASUREMENT_ID`에 설정한다. 앱에는 직접 GA4 script를 넣지 않는다.
3. Web stream의 Enhanced Measurement에서 browser history 기반 page view를 끈다. 앱의 정제된 `page_view`만 사용한다.
4. Admin → Data collection and modification에서 데이터 보존, 내부 트래픽, 원치 않는 추천 제외를 검토한다.
5. Admin → Events/Key events에서 `generate_lead`, `purchase`, 필요 시 `ysn_booking_confirmed`를 Key event로 지정한다.
6. Custom definitions에 `package_id`, `destination`, `departure_city`, `lead_type`, `cta_location`, `page_type`, `attribution_session_id`를 event-scoped dimension으로 등록한다.
7. Admin → Product links → Google Ads Links → Link.
8. Admin → Product links → Search Console Links → Link → property와 web stream 선택.

Measurement Protocol API secret은 Web stream → Measurement Protocol API secrets에서 생성해 서버 전용 `GA4_MEASUREMENT_PROTOCOL_API_SECRET`에 저장한다. 브라우저에 노출하지 않는다.

검증 순서는 GTM Preview → GA4 DebugView → Realtime → 24시간 후 표준 보고서다. 서버 `purchase`는 `client_id`와 설정이 있을 때 delivery cron이 전송하며, `transaction_id`를 그대로 유지한다.
