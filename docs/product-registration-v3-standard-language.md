# 상품등록 V3 표준언어·REMARK·검수 UI SSOT

Last updated: 2026-06-03

## 목적

상품등록 V3의 목표는 랜드사 원문을 고객 문구로 직접 복사하는 것이 아니라, 아래 흐름을 고정하는 것이다.

`supplier raw source -> evidence-backed structured facts -> Yeosonam standard templates -> reviewed customer-visible render`

즉 AI는 문장을 매번 새로 쓰지 않는다. AI와 deterministic parser는 원문을 카테고리, 값, evidence로 분류하고, 고객 노출 문구는 여소남 표준 템플릿에 값만 꽂아 렌더한다.

## 절대 규칙

1. 랜드사 원문은 raw evidence로만 저장한다.
2. 랜드사 REMARK 원문은 고객 상세, 모바일 LP, A4, 블로그, 카드뉴스에 직접 노출하지 않는다.
3. 고객 노출 notice는 여소남 표준 템플릿에서만 생성한다.
4. 고객 노출 claim은 evidence, deterministic derivation, manual approval, platform fallback 중 하나가 있어야 한다.
5. 고위험 notice/fact에 필요한 값이 없으면 `review_needed` 또는 `blocked`로 둔다.
6. 관광지는 기존 `attractions` DB와 alias에 매칭한다. 실패 항목은 unmatched review로 보낸다.
7. 관광지를 자동 신규 INSERT하지 않는다.
8. 랜드사명, 수수료, net price, 내부 운영 메모는 고객 렌더 필드에 저장하거나 노출하지 않는다.

## 레이어 경계

| Layer | 저장 내용 | 고객 노출 |
| --- | --- | --- |
| Supplier raw source | 원본 텍스트, PDF/HWP 추출문, raw REMARK, raw itinerary row | No |
| Evidence span | raw text hash, line/offset, quote, confidence | No |
| Structured fact | category, amount, currency, date, country, condition, risk | Template을 통해서만 |
| Standard notice text | 템플릿 key + 추출값으로 생성한 여소남 문구 | Yes |
| Manual override | 검수자가 승인한 값/문구와 audit trail | 승인된 경우만 |

## REMARK 파이프라인

1. REMARK/공지/포함/불포함/일정 원문을 원자 bullet 또는 sentence로 분리한다.
2. 각 항목을 표준 카테고리로 분류한다.
3. 금액, 통화, 개월 수, 국가, 시간, 기간, 단위, 조건을 추출한다.
4. line/quote evidence를 붙인다.
5. 고정 템플릿으로 `standard_text`를 만든다.
6. 값 누락, 충돌, 법/비용/패널티 리스크는 `review_needed` 또는 `blocked`로 표시한다.
7. `auto_clean` 또는 `manual_approved`이고 `customer_visible`인 행만 고객 필드로 저장한다.

```ts
type StandardNoticeDraft = {
  source_text: string;
  category: StandardNoticeCategory;
  template_key: string;
  values: Record<string, string | number | boolean | null>;
  evidence: EvidenceSpan[];
  visibility: 'customer_visible' | 'internal_only' | 'hidden_by_default';
  risk_level: 'low' | 'medium' | 'high';
  review_status: 'auto_clean' | 'review_needed' | 'manual_approved' | 'rejected';
  standard_text: string;
};
```

## 표준 Notice 카테고리

| Category | 예시 원문 | 기본 노출 | Risk |
| --- | --- | --- | --- |
| `single_room_surcharge` | 싱글차지, 1인실 추가요금 | customer_visible | high |
| `passport_validity` | 여권 만료일, 입국일 기준 6개월 | customer_visible | high |
| `visa_entry_rule` | 비자, 전자입국, 입국 조건 | customer_visible | high |
| `local_law_restriction` | 전자담배 반입금지, 현지법 제한 | customer_visible | high |
| `room_assignment` | 객실 층수/인접 객실/베드 타입 배정 불가 | customer_visible | medium |
| `itinerary_change` | 항공/현지 사정으로 일정 순서 변경 | customer_visible | medium |
| `local_guide_operation` | 공항 미팅 제한, 차량 내 설명, 현지 가이드 동행 | customer_visible | medium |
| `tip_guideline` | 마사지팁, 가이드/기사팁, 매너팁 | customer_visible | high |
| `group_schedule_penalty` | 일정 미참여 패널티, 개별 일정 비용 | customer_visible | high |
| `restaurant_access` | 식당 주차 불가, 도보 이동 | customer_visible | low |
| `optional_tour` | 선택관광 있음/없음, 옵션 금액 | customer_visible | medium |
| `shopping_visit` | 쇼핑센터 방문 횟수/품목, 노쇼핑 | customer_visible | medium |
| `hotel_notice` | 호텔 변경, 동급 호텔, 호텔 등급 | customer_visible | medium |
| `meal_plan` | 조식/중식/석식 구성 | customer_visible | low |
| `transport_notice` | 전용차량, 페리, 케이블카, 도보 이동 | customer_visible | low |
| `surcharge_notice` | 유류할증료, 리조트피, 비자비, 현지직불 | customer_visible | high |
| `prep_items` | 준비물, 복장, 개인 지참물 | customer_visible | low |
| `minimum_departure` | 최소출발 인원 | customer_visible | medium |
| `internal_supplier_note` | 랜드사 내부 운영 메모, 커미션, net | internal_only | high |
| `unknown_notice` | 템플릿으로 표현 불가 | hidden_by_default | high |

## 표준 템플릿

| Template key | Required values | Customer text |
| --- | --- | --- |
| `single_room_surcharge.full_trip` | `amount`, `currency` | 1인실 사용 시 전 일정 기준 1인 {amount}{currency}의 추가요금이 발생합니다. |
| `single_room_surcharge.inquiry_required` | none | 1인실 사용 시 추가요금은 예약 시 확인이 필요합니다. |
| `passport.validity_months` | `months` | 여권 유효기간은 출국일 기준 {months}개월 이상 남아 있어야 합니다. |
| `local_law.prohibited_item` | `country`, `item` | {country}은(는) {item} 반입이 금지되어 있습니다. |
| `room.assignment_not_guaranteed` | none | 호텔 객실의 층수, 인접 객실, 베드 타입은 사전 확정이 어렵습니다. |
| `itinerary.order_may_change` | none | 항공 및 현지 사정에 따라 일정과 행사 순서가 변경될 수 있습니다. |
| `guide.operation_limited_area` | none | 현지 규정에 따라 일부 장소에서는 안내 방식이 제한될 수 있으며, 필요한 설명은 차량 이동 중 진행될 수 있습니다. |
| `tip.massage_by_region_duration` | `tipTable` | 마사지 이용 시 지역과 이용 시간에 따라 현지 매너팁이 별도로 발생할 수 있습니다. |
| `guide.tip_included` | none | 가이드/기사 팁은 포함되어 있습니다. |
| `guide.tip_local_payment` | `amount`, `currency`, `unit` | 가이드/기사 팁은 현지에서 {unit} {amount}{currency}를 별도로 지불합니다. |
| `group.penalty_absence` | `amount`, `currency`, `unit` | 단체 일정에 참여하지 않고 개별 일정을 진행하는 경우 현지 규정에 따라 {unit} {amount}{currency}의 추가 비용이 발생할 수 있습니다. |
| `optional.none` | none | 선택관광이 없는 상품입니다. |
| `optional.available_on_request` | none | 선택관광은 희망 시 현지에서 별도 비용으로 진행될 수 있습니다. |
| `shopping.none` | none | 쇼핑센터 방문이 없는 상품입니다. |
| `shopping.visits_count` | `count`, `items` | 일정 중 쇼핑센터 {count}회 방문이 포함되어 있습니다. |
| `hotel.grade_or_equivalent` | `grade`, `name` | 숙박은 {grade} 호텔 또는 동급 기준으로 진행됩니다. |
| `meal.summary` | `summary` | 식사는 일정표에 기재된 {summary} 기준으로 제공됩니다. |
| `transport.included` | `items` | 일정 중 {items} 이동이 포함되어 있습니다. |
| `restaurant.short_walk_possible` | none | 일부 식당은 차량 진입이 어려워 가까운 지점에서 도보 이동이 있을 수 있습니다. |
| `minimum_departure.count` | `count` | 최소 출발 인원은 {count}명입니다. |

## Structured Facts 카테고리

`structured_facts[]`는 REMARK뿐 아니라 상품명, 일정, 포함/불포함, 옵션, 호텔, 식사, 차량 정보를 정형화한다.

| Category | Meaning | 운영 규칙 |
| --- | --- | --- |
| `guide_presence` | 가이드/인솔자 유무 | 고객 화면은 표준 안내문만 사용한다. |
| `guide_tip` | 가이드/기사팁 금액, 포함, 노팁 | `노팁`, `NO TIP`, `가이드팁 포함`, `기사/가이드팁 포함`은 값 누락이 아니라 safe state다. |
| `shopping_policy` | 노쇼핑, 쇼핑 횟수, 쇼핑 품목 | `노쇼핑`, `쇼핑 0회`는 safe state다. 품목만 있고 횟수 없으면 review_needed. |
| `hotel_grade` | 호텔명, 등급, 동급 여부 | DB에 고객용 호텔 상세가 있으면 매칭 정보 우선. 원문 설명은 복사하지 않는다. |
| `room_policy` | 객실 정책, 싱글차지 | 싱글차지 금액이 없으면 문의 필요 표준문구 + review_needed. |
| `meal_plan` | 조/중/석 식사 구성 | 키워드 요약값만 저장한다. |
| `transport` | 전용차량, 페리, 케이블카, 도보, 픽업/샌딩 | 일정 이동 fact로 저장한다. |
| `optional_tour` | 선택관광 목록, 노옵션 | `노옵션`, `NO OPTION`, `선택관광 없음`은 safe state다. |
| `surcharge` | 현지직불, 유류할증료, 리조트피, 세금, 비자비 | 비용/조건 값이 필요한데 없으면 review_needed. |
| `passport_visa_law` | 여권, 비자, 현지법, 반입금지 | 국가/품목/개월 수 누락 시 review_needed 또는 blocked. |
| `schedule_policy` | 일정 변경, 미참여 패널티 | 패널티 금액/단위 누락 시 review_needed. |
| `prep_items` | 준비물, 복장 | 표준 준비물 안내로 렌더한다. |
| `min_pax` | 최소출발 인원 | 숫자 추출 필요. |

업로드와 검수 저장은 `standard_notices`와 `structured_facts`를 최신 `product_registration_drafts.ledger.variants[]`에 보관하고, 고객 렌더에 필요한 표준화된 요약만 `travel_packages`에 복사한다.

## 관광지 키워드 처리

관광지는 notice/fact 정형화와 분리한다.

1. 일정 row와 activity text에서 후보 키워드를 추출한다.
2. 항공, 호텔 체크인, 조식, 이동, 미팅, 휴식 같은 비관광지 row는 제외한다.
3. 기존 `matchAttraction`/`matchAttractions`와 alias, normalized substring, fuzzy matching을 사용한다.
4. 매칭 성공 시 itinerary/activity block에 기존 attraction id를 연결한다.
5. 매칭 실패 시 `unmatched_activities` review queue에 source text, destination, day, context를 저장한다.
6. 업로드/파서/백필 과정에서 `attractions` 신규 INSERT, 자동 seed script, raw supplier attraction 생성은 금지한다.

예시:

| Supplier text | Candidate | Result |
| --- | --- | --- |
| 경복궁 - 조선 왕궁 관람 | 경복궁 | 기존 attraction 매칭 |
| 창덕궁 후원 관람 | 창덕궁 | 기존 attraction/alias 매칭 |
| 발마사지 60분 | 발마사지 | 등록된 activity/attraction이면 매칭, 아니면 unmatched |
| 중식 후 차량 이동 | none | transport/meal fact로 처리 |

## 관리자 검수 UI

검수 화면은 테이블 우선이다.

| Column | Purpose |
| --- | --- |
| 원문 | supplier source bullet/line |
| 카테고리 | 여소남 category dropdown |
| 추출값 | amount, currency, country, count, duration, unit 등 |
| 여소남 표준문구 | template output |
| Evidence | source line/span |
| 노출여부 | customer visible, internal only, hidden |
| Risk | low, medium, high |
| 검수상태 | auto clean, review needed, approved, rejected |

검수자는 카테고리 변경, 값 수정, 노출여부 변경, 승인/거부를 할 수 있어야 한다. 저장 시 최신 draft ledger, `standard_notices`, `category_attrs`, 고객 safe notice payload를 함께 재생성한다.

## 렌더/승인 게이트

1. 모바일 상세, 모바일 LP, A4, 블로그, 카드뉴스는 `renderPackage()` 또는 V3 customer-safe payload를 사용한다.
2. V3 상품에서 `category`, `template_key`, `review_status`가 없는 notice는 고객 화면에 노출하지 않는다.
3. 최신 V3 draft가 `blocked` 또는 `needs_review`이면 승인 API는 active 전환을 막는다.
4. force 승인도 V3 high-risk unresolved gate를 우회할 수 없다.
5. 승인 시점에 고객 노출 notice payload를 다시 생성하고 raw leak risk를 재검사한다.

## 운영 감사/백필 명령

| Command | Purpose |
| --- | --- |
| `npm run audit:product-mobile-readiness -- --days=3 --limit=20 --json` | 최근 상품의 V3 draft, 가격, 일정, raw leak, unmatched 상태를 감사한다. |
| `npm run audit:product-mobile-readiness:ci` | 최근 상품 감사에서 스키마 미적용, 가격/렌더/UNK, V3 blocked, raw leak이 있으면 non-zero로 실패한다. |
| `npm run audit:product-mobile-readiness:public` | 공개 상품은 실제 `/packages/{id}` 고객 HTML까지 가져와 가격/일정/문의/제목 표식이 보이는지 확인한다. |
| `npm run repair:product-mobile-readiness -- --status=pending,pending_review,draft --limit=200 --days=365` | 비공개 상품의 가격 날짜, 항공/약관, 일정 정규화, 관광지 재연결, V3 draft를 공개 전 수리 후보로 재생성한다. 공개 상태는 바꾸지 않는다. |
| `npm run audit:product-structured-keywords -- 20` | 최근 상품 원문/필드에서 가이드, 팁, 쇼핑, 호텔, 식사, 차량 등 정형 키워드 후보와 저장률을 확인한다. |
| `npm run backfill:product-v3-structured-facts -- --days=3 --limit=20` | 기존 draft에 structured facts/standard notices를 재생성할 수 있는지 dry-run으로 확인한다. |
| `npm run backfill:product-v3-structured-facts -- --days=3 --limit=20 --apply` | dry-run 결과 확인 후 최신 draft ledger에만 structured facts/standard notices를 반영한다. 고객 공개 상태는 자동 변경하지 않는다. |

## 나트랑/달랏 REMARK 완료 기준

fixture는 아래 항목을 category/value/evidence/template로 추출해야 한다.

| 항목 | Expected category | Required value |
| --- | --- | --- |
| 싱글차지 전 일정 18만원 | `single_room_surcharge` | amount/currency 또는 inquiry state |
| 여권 6개월 | `passport_validity` | months=6 |
| 전자담배 반입금지 | `local_law_restriction` | country/item |
| 룸배정 불가 | `room_assignment` | none |
| 일정 변경 가능 | `itinerary_change` | none |
| 마사지팁 | `tip_guideline` | tip table 또는 review_needed |
| 일정 미참여 패널티 | `group_schedule_penalty` | amount/currency/unit |
| 식당 도보 이동 안내 | `restaurant_access` | none |

고객 출력은 원문 문장이 아니라 표준문구만 포함해야 한다.

## 완료 조건

1. 나트랑/달랏 fixture 테스트 통과.
2. 싱글차지, 여권 6개월, 전자담배, 룸배정, 일정변경, 마사지팁, 미참여 패널티, 식당 도보 이동 추출.
3. 모바일 상세, 모바일 LP, A4, 블로그, 카드뉴스에 랜드사 REMARK 원문 직접 노출 없음.
4. high-risk notice/fact 값 누락 시 `review_needed` 또는 `blocked`.
5. 관광지 매칭은 기존 DB/alias/unmatched 흐름 사용.
6. 자동 attraction insert 없음.
7. 관리자 검수 UI에서 원문/카테고리/추출값/표준문구/evidence/노출/risk/status 확인 및 저장 가능.
8. 승인 API가 V3 draft gate와 customer-safe notice payload를 재검증.
