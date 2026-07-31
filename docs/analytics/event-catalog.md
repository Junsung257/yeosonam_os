# 이벤트 카탈로그

| 이벤트 | 발생 조건 | 핵심 파라미터 | GA4 | Google Ads 역할 |
|---|---|---|---|---|
| `page_view` | 동의 후 App Router 경로당 1회 | `page_path`, `page_type` | 기본 | 리마케팅 모수 |
| `view_item_list` | 보이는 상품 결과 목록이 바뀜 | `item_list_*`, `items` | 전자상거래 | 관찰 |
| `select_item` | 상품 카드 클릭 | `items` | 전자상거래 | 관찰 |
| `view_item` | 공개 상품 상세/LP 진입 | `items`, `currency`, 선택 `value` | 전자상거래 | 리마케팅 |
| `ysn_price_view` | 가격 카드 50% 이상 노출 | 상품, 가격 유형, 검증 가격 | 사용자 정의 | 보조 |
| `ysn_schedule_view` | 일정 영역 실제 도달 | 상품·목적지 | 사용자 정의 | 관찰 |
| `ysn_inclusions_view` | 포함/불포함 영역 실제 도달 | 상품·목적지 | 사용자 정의 | 관찰 |
| `ysn_departure_select` | 사용자가 출발일을 선택 | 상품·출발일 | 사용자 정의 | 관찰 |
| `begin_checkout` | 예약 문의 sheet/form을 실제로 엶 | 상품·선택일·선택 가격 | 권장 | 보조 |
| `ysn_kakao_click` | 카카오 CTA 클릭 | 위치, 페이지 유형, 허용 host | 사용자 정의 | 보조 |
| `ysn_phone_click` | `tel:` CTA 클릭 | 위치, 페이지 유형 | 사용자 정의 | 보조 |
| `generate_lead` | 문의가 서버에 저장됐다는 응답 | 상품·리드 유형 | 권장/Key event 후보 | 주 전환 후보 |
| `ysn_booking_confirmed` | 관리자 서버가 예약을 `confirmed`로 전환 | 비식별 예약 거래키, 상품 | 사용자 정의 | 주 전환 후보 |
| `purchase` | 검증 결제와 공급사 예약이 최종 완료 | 안정적 거래 ID, 실제 금액, items | 권장/Key event | 주 전환 |
| `refund` | 실제 환불 원장 확정 | 원거래 ID, 실제 환불액/items | 권장 | 후속 연결 |

`value`와 `price`는 신뢰 가능한 숫자만 보낸다. “가격 문의” 상품은 숫자를 만들지 않는다. 카카오·전화 클릭을 장기 주 전환으로 사용하지 않는다.

모든 이벤트에는 가능한 범위에서 정제된 `page_path`, `page_title`, `referrer_host`, `device_context`, `attribution_session_id`가 자동 부착된다.
