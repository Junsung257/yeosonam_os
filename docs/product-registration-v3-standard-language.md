# Product Registration V3 Standard Language

Last updated: 2026-06-01

## Purpose

Product Registration V3 must convert supplier materials into Yeosonam-owned customer language.
In Korean operator discussions, this means "랜드사 원문은 증거로 보관하고, 고객에게는 여소남 표준언어로 표출한다."

The supplier source is evidence. It is not the customer-facing copy.

The operating goal is:

`supplier raw source -> evidence-aware structured facts -> Yeosonam standard templates -> reviewed customer-visible render`

This document is the working SSOT for supplier remarks, notices, attraction keywords, and the review UI used by the product registration flow.

## Non-Negotiable Rules

1. Supplier raw text must be stored exactly as received.
2. Supplier REMARK wording must not be rendered directly on customer pages, mobile landing pages, A4 posters, blog copy, or card news.
3. Customer-visible notices must come from Yeosonam standard templates.
4. AI may classify, extract values, and propose mappings. AI must not freely rewrite customer notices every time.
5. Every customer-visible claim must have either source evidence, a deterministic derivation, a reviewed manual value, or a clearly labeled Yeosonam standard fallback.
6. Attractions must be matched against the existing attractions DB and aliases first. Failed matches go to unmatched review. Do not auto-create new attractions from supplier text.
7. Internal supplier terms, land operator memos, commission, net price, and B2B-only warnings must never leak into customer render fields.
8. Publish must be blocked when a high-risk customer-visible notice has no evidence, missing extracted value, or unresolved conflict.

## Language Boundary

| Layer | What It Stores | Can Customer See It? |
| --- | --- | --- |
| Supplier raw source | Original text, PDF/HWP extraction, raw remarks, raw itinerary rows | No |
| Evidence span | Raw text hash, line/offset, quote, confidence | No |
| Structured fact | Category, amount, currency, date, country, condition, risk | Only via template |
| Yeosonam standard text | Template output with extracted values | Yes |
| Manual override | Reviewed human correction with audit trail | Yes, if approved |

## REMARK Pipeline

The REMARK parser must work in this order:

1. Split supplier REMARK into atomic sentences or bullet items.
2. Classify each item into a Yeosonam notice category.
3. Extract structured values such as amount, currency, month count, country, time, duration, unit, or condition.
4. Attach source evidence span.
5. Render with a fixed Yeosonam template.
6. Mark unresolved, conflicting, or high-risk items as review needed.

The parser should produce facts, not final prose.

```ts
type StandardNoticeDraft = {
  sourceText: string;
  category: StandardNoticeCategory;
  templateKey: string;
  values: Record<string, string | number | boolean | null>;
  evidence: EvidenceSpan[];
  visibility: 'customer_visible' | 'internal_only' | 'hidden_by_default';
  riskLevel: 'low' | 'medium' | 'high';
  reviewStatus: 'auto_clean' | 'review_needed' | 'manual_approved' | 'rejected';
};
```

## Standard Notice Categories

Start with these categories. Add a new category only when the supplier source cannot be represented safely by an existing one.

| Category | Examples From Supplier Text | Default Visibility | Risk |
| --- | --- | --- | --- |
| `single_room_surcharge` | 싱글차지, 독실료, 1인실 추가요금 | customer_visible | high |
| `passport_validity` | 여권 만료일, 입국일 기준 6개월 | customer_visible | high |
| `visa_entry_rule` | 비자, 입국 조건, 전자입국 | customer_visible | high |
| `local_law_restriction` | 현지법, 자국민 보호법, 반입 금지 | customer_visible | high |
| `room_assignment` | 객실 층, 옆방, 베드 타입 개런티 불가 | customer_visible | medium |
| `itinerary_change` | 항공 및 현지 사정, 일정/식사 순서 변경 | customer_visible | medium |
| `local_guide_operation` | 공항 미팅 제한, 차량 내 설명, 현지 가이드 동행 | customer_visible | medium |
| `tip_guideline` | 매너팁, 마사지팁, 가이드/기사 팁 | customer_visible | high |
| `group_schedule_penalty` | 일정 미참여, 패널티, 개별활동 책임 | customer_visible | high |
| `optional_tour` | 선택관광, 원할 경우 진행 | customer_visible | medium |
| `shopping_visit` | 쇼핑센터, 방문 횟수, 품목 | customer_visible | medium |
| `restaurant_access` | 식당 앞 주차 불가, 도보 이동 | customer_visible | low |
| `hotel_notice` | 호텔 변경, 동급 호텔, 룸 컨디션 | customer_visible | medium |
| `safety_responsibility` | 개인 경비, 개인 부주의, 사고 책임 | customer_visible | high |
| `internal_supplier_note` | 랜드사 운영 메모, 내부 진행 방식 | internal_only | high |
| `unknown_notice` | Existing templates cannot represent it | hidden_by_default | high |

## Standard Templates

Templates are Yeosonam-owned language. Supplier wording must map into these templates.

| Template Key | Required Values | Customer Text |
| --- | --- | --- |
| `single_room_surcharge.full_trip` | `amount`, `currency` | 1인실 사용 시 전 일정 기준 1인 {amount}{currency}의 추가 요금이 발생합니다. |
| `passport.validity_months` | `months` | 여권 만료일은 입국일 기준 {months}개월 이상 남아 있어야 합니다. |
| `local_law.prohibited_item` | `country`, `item` | {country}은(는) {item} 반입이 금지되어 있습니다. |
| `room.assignment_not_guaranteed` | none | 호텔 객실의 층수, 인접 객실, 침대 타입은 사전 확정이 어렵습니다. |
| `itinerary.order_may_change` | none | 항공 및 현지 사정에 따라 일정과 식사 순서는 변경될 수 있습니다. |
| `guide.operation_limited_area` | none | 현지 규정상 일부 장소에서는 안내 방식이 제한될 수 있으며, 필요한 설명은 차량 이동 중 진행될 수 있습니다. |
| `tip.massage_by_region_duration` | `tipTable` | 마사지 이용 시 지역과 이용 시간에 따라 현지 매너팁이 별도로 발생할 수 있습니다. |
| `group.penalty_absence` | `amount`, `currency`, `unit` | 단체 일정에 참여하지 않고 개별 일정을 진행하는 경우 현지 규정에 따라 {unit} {amount}{currency}의 추가 비용이 발생할 수 있습니다. |
| `optional.available_on_request` | none | 선택관광은 희망 시 현지에서 별도 비용으로 진행될 수 있습니다. |
| `shopping.visits_count` | `count`, `items` | 일정 중 쇼핑센터 {count}회 방문이 포함되어 있습니다. |
| `restaurant.short_walk_possible` | none | 일부 식당은 차량 진입이 어려워 가까운 지점에서 도보 이동이 있을 수 있습니다. |

If a supplier remark has legal, penalty, price, passport, safety, or local law impact, the exact value must be extracted and reviewed before publish.

## Example: Nha Trang/Dalat REMARK

Supplier source:

```txt
싱글차지 전일정 기준 인당 18만 원 추가됩니다.
여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.
베트남 자국민 보호법으로 공항미팅/관광지 방문 불가하므로 설명은 차량에서 대체하며 현지 가이드와 동행합니다.
호텔 룸배정(일행과 같은 층, 옆방 배정, 베드 타입) 등은 개런티 불가합니다.
전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.
마사지 팁 기준(나트랑: 60분-$4, 90분-$5, 120분-$6 / 달랏: 60분-$4, 90분-$5, 120분-$7)입니다.
패키지 일정 미참여 시 패널티 1인/1박/$100 청구됩니다.
나트랑 식당들은 주차장 구비된 곳이 많지가 않고...
베트남 전자담배 반입 불가합니다.
```

Expected structured output:

| Category | Values | Template Key | Review |
| --- | --- | --- | --- |
| `single_room_surcharge` | `amount=180000`, `currency=원` | `single_room_surcharge.full_trip` | review_needed |
| `passport_validity` | `months=6` | `passport.validity_months` | auto_clean |
| `local_guide_operation` | `country=베트남` | `guide.operation_limited_area` | review_needed |
| `room_assignment` | none | `room.assignment_not_guaranteed` | auto_clean |
| `itinerary_change` | none | `itinerary.order_may_change` | auto_clean |
| `tip_guideline` | `tipTable=[...]` | `tip.massage_by_region_duration` | review_needed |
| `group_schedule_penalty` | `amount=100`, `currency=USD`, `unit=1인 1박당` | `group.penalty_absence` | review_needed |
| `restaurant_access` | none | `restaurant.short_walk_possible` | auto_clean |
| `local_law_restriction` | `country=베트남`, `item=전자담배` | `local_law.prohibited_item` | auto_clean |

Expected customer output:

```txt
유의사항

- 1인실 사용 시 전 일정 기준 1인 18만 원의 추가 요금이 발생합니다.
- 여권 만료일은 입국일 기준 6개월 이상 남아 있어야 합니다.
- 현지 규정상 일부 장소에서는 안내 방식이 제한될 수 있으며, 필요한 설명은 차량 이동 중 진행될 수 있습니다.
- 호텔 객실의 층수, 인접 객실, 침대 타입은 사전 확정이 어렵습니다.
- 항공 및 현지 사정에 따라 일정과 식사 순서는 변경될 수 있습니다.
- 마사지 이용 시 지역과 이용 시간에 따라 현지 매너팁이 별도로 발생할 수 있습니다.
- 단체 일정에 참여하지 않고 개별 일정을 진행하는 경우 현지 규정에 따라 1인 1박당 100USD의 추가 비용이 발생할 수 있습니다.
- 일부 식당은 차량 진입이 어려워 가까운 지점에서 도보 이동이 있을 수 있습니다.
- 베트남은 전자담배 반입이 금지되어 있습니다.
```

The customer output may be formatted as bullets, accordions, tables, or grouped sections, but the source wording must not be copied directly.

## Attraction Keyword Handling

Attraction handling is separate from notice rewriting.

Supplier itinerary text may contain activity names, bundled experiences, meal names, shopping locations, or transport descriptions. The system must:

1. Extract candidate keywords from itinerary rows and included-experience bullets.
2. Ignore obvious non-attractions such as flights, hotel check-in, breakfast, transfers, meetings, and generic rest.
3. Match candidates against existing attractions by name, alias, normalized substring, and fuzzy matching.
4. Attach matched attraction IDs to itinerary/activity blocks.
5. Send failed matches to unmatched review with source text, destination, day, and context.
6. Never insert a new attraction automatically from supplier text.

Example:

| Supplier Text | Candidate | Result |
| --- | --- | --- |
| 포나가르 사원 | 포나가르 사원 | match existing attraction |
| 죽림사+케이블카 | 죽림사, 케이블카 | match/split or review |
| 달랏야시장+야경투어/천국의계단 | 달랏야시장, 천국의계단 | match or unmatched review |
| 중식 후 달랏으로 이동 | none | ignore as transport |

## Admin Review UI

The Product Registration V3 review screen should be table-first.

Each row must show:

| Column | Purpose |
| --- | --- |
| Source | Supplier original bullet or line |
| Category | Yeosonam category dropdown |
| Extracted Values | Amounts, dates, country, count, duration, unit |
| Standard Text | Rendered Yeosonam template output |
| Evidence | Source line/span link |
| Visibility | Customer visible, internal only, hidden |
| Risk | Low, medium, high |
| Review Status | Auto clean, review needed, approved, rejected |

Required interactions:

- Change category.
- Edit extracted value.
- Toggle customer visibility.
- Mark as approved or rejected.
- Link unmatched attraction to an existing attraction alias.
- Send true new attraction to `/admin/attractions` for manual creation.
- Preview mobile LP and A4 output from the same render contract.

## Completion Criteria

A Product Registration V3 implementation is incomplete unless these checks pass:

1. The Nha Trang/Dalat fixture maps REMARK bullets into standard categories and templates.
2. Single room surcharge, passport validity, local law restriction, room assignment, itinerary change, tip guideline, group schedule penalty, restaurant access, and prohibited item are extracted.
3. Supplier raw REMARK wording is not present in customer-visible mobile/A4 render output.
4. High-risk notices without extracted values are blocked or marked review needed.
5. Attraction matching uses existing DB/aliases and sends failures to unmatched review.
6. No automatic attraction creation happens during upload or parsing.
7. Admin review UI can correct category, values, visibility, and review status without editing raw source.
8. Approval recomputes customer-visible claim coverage before status becomes active.

## New Session Handoff Prompt

Use this prompt when starting a new implementation session:

```txt
Read AGENTS.md, CURRENT_STATUS.md, .claude/CLAUDE.md product-registration rules, docs/product-registration-accuracy-plan.md, and docs/product-registration-v3-standard-language.md before editing.

Goal: strengthen Product Registration V3 around supplier raw preservation, Yeosonam standard language templates, table-first review UI, evidence-backed customer rendering, and attraction matching without auto-creating attractions.

Do not:
- render supplier REMARK wording directly to customer pages,
- auto-create attractions from supplier text,
- let AI freely rewrite customer notices every run,
- publish customer-visible claims without evidence or a standard template.

Do:
- add/extend standard notice category/template SSOT,
- add a Nha Trang/Dalat fixture,
- parse REMARK into category + values + evidence,
- render customer notices through Yeosonam templates,
- expose source/category/values/standard text/visibility/review status in admin review UI,
- verify mobile/A4 render does not leak supplier wording.
```
