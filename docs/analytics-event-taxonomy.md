# Analytics Event Taxonomy

Last updated: 2026-06-01

This document is the canonical event dictionary for customer UX, recommendation quality, and guidebook behavior analytics. Keep event names stable; add a new row here before shipping a new tracking event.

## Principles

- Events must describe a user action or system outcome, not an implementation detail.
- Payloads must never include raw PII such as phone numbers, passport data, full address, bank account numbers, free-form private notes, or unredacted chat transcripts.
- Store IDs, coarse categories, ranks, timestamps, and numeric performance fields instead of user-entered private text.
- Every funnel-critical event needs an owner, a required-property contract, and a dashboard question it can answer.

## Customer Engagement Events

| Event | Owner | Required properties | Optional properties | Answers |
| --- | --- | --- | --- | --- |
| `page_view` | Growth | `page_url`, `session_id`, `visitor_uid` | `product_id`, `lead_time_days` | Which pages start high-intent sessions? |
| `product_view` | Product | `product_id`, `page_url`, `session_id`, `visitor_uid` | `product_name`, `lead_time_days` | Which packages generate qualified demand? |
| `cart_added` | Product | `product_id`, `session_id`, `visitor_uid` | `product_name`, `page_url` | Which products create shortlist intent? |
| `cart_abandon_exit` | Growth | `session_id`, `visitor_uid`, `page_url` | `cartItems`, `time_on_page_ms` | Which shortlist sessions need retargeting? |
| `checkout_start` | Product | `product_id`, `session_id`, `visitor_uid` | `product_name`, `page_url` | Where does inquiry or booking intent begin? |
| `page_exit` | Growth | `page_url`, `time_on_page_ms`, `max_scroll_pct`, `interaction_count` | `product_id` | Which pages lose attention before CTA? |
| `scroll_25` | Growth | `page_url`, `session_id`, `visitor_uid` | `product_id` | Does the first content block carry intent? |
| `scroll_50` | Growth | `page_url`, `session_id`, `visitor_uid` | `product_id` | Is the middle content being consumed? |
| `scroll_75` | Growth | `page_url`, `session_id`, `visitor_uid` | `product_id` | Are users reaching proof and detail sections? |
| `scroll_90` | Growth | `page_url`, `session_id`, `visitor_uid` | `product_id` | Are long pages earning deep attention? |

## Recommendation Events

Recommendation tracking is stored as outcomes rather than a separate `event_type` column. Treat `source + outcome` as the event identity.

| Event | Owner | Required properties | Optional properties | Answers |
| --- | --- | --- | --- | --- |
| `recommendation_impression` | AI/Product | `package_id`, `source`, `session_id` | `recommended_rank`, `policy_id`, `intent` | Which AI policies are exposed to users? |
| `recommendation_click` | AI/Product | `package_id`, `source`, `session_id`, `outcome=click` | `recommended_rank`, `policy_id`, `intent` | Which recommendations earn action? |
| `recommendation_inquiry` | Sales | `package_id`, `source`, `session_id`, `outcome=inquiry` | `outcome_value` | Which recommendations produce leads? |
| `recommendation_booking` | Finance | `package_id`, `source`, `session_id`, `outcome=booking` | `outcome_value` | Which recommendations create revenue? |

## Package Score Signal Events

Package score signals are stored in `package_score_signals`. They are lightweight learning signals for reviewless package comparison UX. Insert failures must not block the customer flow.

| Event | Owner | Required properties | Optional properties | Answers |
| --- | --- | --- | --- | --- |
| `recommend_badge_view` | AI/Product | `package_id`, `signal_type`, `session_id` | `group_key=intent:*`, `rank_at_signal`, `topsis_score_at_signal` | Which scored packages are actually seen in list UX? |
| `recommend_reason_open` | AI/Product | `package_id`, `signal_type`, `session_id` | `group_key=intent:*` | Do customers trust and inspect the recommendation reason? |
| `comparison_open` | Product | `package_id`, `signal_type`, `session_id` | `group_key=intent:*;compare:*` | Which shortlist comparisons lead to stronger intent? |
| `intent_chip_select` | Growth/Product | `package_id`, `signal_type`, `session_id` | `group_key=intent:*:on/off` | Which simple travel intent filters are customers using? |
| `lead_sheet_open` | Sales | `package_id`, `signal_type`, `session_id` | `group_key`, `rank_at_signal` | Which scored packages create consultation intent? |

## Mobile Guidebook Events

| Event | Owner | Required properties | Optional properties | Answers |
| --- | --- | --- | --- | --- |
| `guide_open` | Ops | `guide_ref` | `dayCount`, `hasVoucher` | Did travelers open the operational guide? |
| `voucher_open` | Ops | `guide_ref` | `booking_id` | Are voucher instructions discoverable? |
| `directions_hotel` | Ops | `guide_ref` | `day`, `label` | Which hotel route links are used? |
| `book_hotel` | Growth | `guide_ref` | `day`, `label` | Which hotel upsells get tapped? |
| `directions_activity` | Ops | `guide_ref` | `day`, `label` | Which activity route links are used? |
| `book_activity` | Growth | `guide_ref` | `day`, `label` | Which activity upsells get tapped? |

## Admin/ERP Events To Add

These events are not all implemented yet. They are the next instrumentation layer for ERP usability and operational AI.

| Event | Owner | Required properties | Forbidden properties | Purpose |
| --- | --- | --- | --- | --- |
| `admin_kpi_drilldown` | Ops | `admin_user_id`, `metric_key`, `range` | raw customer PII | Measure whether dashboard cards explain anomalies. |
| `admin_payment_match` | Finance | `admin_user_id`, `transaction_id`, `match_confidence` | bank account number | Measure payment matching workload and confidence. |
| `admin_package_approve` | Product Ops | `admin_user_id`, `package_id`, `source` | vendor private notes | Measure package approval throughput. |
| `admin_ai_action_approve` | AI Ops | `admin_user_id`, `action_id`, `risk_level` | raw prompt with PII | Measure human-in-the-loop AI trust. |
| `admin_bulk_retry` | Ops | `admin_user_id`, `job_type`, `count` | customer free text | Measure repeated operational failure points. |

## Change Control

- Add or rename events in this document first.
- Run `npm run audit:event-taxonomy` before merging.
- When an event becomes funnel-critical, add it to dashboard contracts or a Supabase migration note.
