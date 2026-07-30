# Google Tag Manager 설정

## 컨테이너

1. Tag Manager → 계정/웹 컨테이너 생성.
2. Container ID를 Vercel `NEXT_PUBLIC_GTM_CONTAINER_ID`에 저장.
3. 앱 코드는 GTM만 로드한다. 별도 GA4 스니펫을 추가하지 않는다.
4. Basic Consent Mode 정책이므로 동의 전에는 컨테이너 자체가 로드되지 않는다.

## 변수

Data Layer Variable를 다음 이름 그대로 만든다: `package_id`, `package_name`, `destination`, `departure_city`, `departure_date`, `currency`, `value`, `cta_location`, `page_type`, `lead_type`, `transaction_id`, `items`, `page_path`, `attribution_session_id`.

## 태그·트리거 명세

| 태그 | Custom Event 트리거 | 파라미터 | Consent | 역할/중복 방지 |
|---|---|---|---|---|
| Google tag | Initialization 또는 첫 허용 후 All Pages | GA4 Measurement ID | `analytics_storage` | Enhanced Measurement의 history page_view는 끄고 앱 `page_view`만 사용 |
| GA4 Event | `page_view` | page fields | analytics | 경로당 1회 |
| GA4 Event | `view_item_list`, `select_item`, `view_item` | `items`, list, currency/value | analytics | 전자상거래 |
| GA4 Event | `generate_lead` | lead/package fields | analytics | Key event 후보 |
| GA4 Event | `begin_checkout`, `purchase`, `refund` | 표준 ecommerce fields | analytics | `transaction_id` 유지 |
| GA4 Event | `ysn_*` 각각 | 해당 dataLayer 변수 | analytics | 사용자 정의 |
| Conversion Linker | All Pages | 기본 설정 | ad storage | 광고 랜딩 전체 |
| Google Ads 주 전환 | `generate_lead` 또는 GA4 import 중 한 경로 | Ads ID/Label | ad signals | 같은 행동 직접 태그+GA4 import 이중 주 전환 금지 |
| Google Ads 보조 | 카카오/전화/checkout/price | Ads ID/Label | ad signals | Secondary |
| Google Ads remarketing | 상품/목록 이벤트 | 상품 식별자 | ad personalization | 동의 사용자만 |
| Clarity(선택) | All Pages | Project ID | analytics | 앱 직접 로더와 GTM 중 하나만 선택, 폼 마스킹 후 운영만 |

Consent Initialization 태그를 별도로 만들 경우 앱이 이미 `default denied`와 `update`를 GTM보다 먼저 queue한다는 점을 확인하고 상충하는 기본값을 넣지 않는다.

앱의 `NEXT_PUBLIC_CLARITY_PROJECT_ID` 직접 로더는 운영 hostname과 분석
동의를 확인한다. GTM에서 Clarity를 구성한다면 이 환경변수는 비워 중복
세션 리플레이를 막는다.

## Preview와 Publish

1. Workspace → Preview → 운영 URL 연결.
2. 동의 전 network에 `gtm.js`가 없는지 확인.
3. 분석 허용 후 `gtm.js`, Google tag, 한 번의 `page_view`를 확인.
4. 상품→가격→카카오/전화→문의 성공 이벤트 순서를 확인.
5. Workspace → Submit → Publish and Create Version.
6. 버전명 예: `2026-07 measurement foundation`; 변경 설명에 전환 원본과 Consent 정책 기록.
