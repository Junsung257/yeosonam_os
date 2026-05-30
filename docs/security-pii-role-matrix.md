# PII And Role Exposure Matrix

Last updated: 2026-05-30

This matrix defines how customer-sensitive fields should appear across customer pages, admin ERP screens, APIs, logs, analytics, and AI learning flows.

## Field Classes

| Class | Examples | Default handling |
| --- | --- | --- |
| Direct contact | phone, email, Kakao ID, Line ID | Mask in lists; reveal only in detail screens with an explicit operational purpose. |
| Identity/travel document | passport number, birth date, nationality, legal name | Never show in dashboards, analytics, search results, or AI training payloads. |
| Payment/bank | account number, bank name, depositor name, payment key | Mask account identifiers; show matching confidence and transaction ID first. |
| Free-form private text | memo, chat transcript, raw OCR text, customer request text | Summarize or redact before analytics, search index, and AI learning storage. |
| Operational IDs | booking_id, package_id, tenant_id, transaction_id | Safe for dashboards and analytics when not combined with raw PII. |

## Role Matrix

| Surface | Admin owner | Allowed | Mask or redact | Block |
| --- | --- | --- | --- | --- |
| Customer public pages | Product/Growth | Package IDs, public product data, aggregated reviews | None | Any customer PII or internal margin data |
| Customer mypage/mobile guide | CS/Ops | Own booking status, own voucher, own itinerary | Partial phone/email if needed | Other customer data, staff notes |
| Admin dashboard | Ops | Aggregates, counts, revenue, anomaly flags, IDs for drilldown | Customer name, phone, email | Passport, full bank account, raw chat |
| Admin booking detail | CS/Ops | Booking status, contact data needed for support | Payment/account details unless actively matching | AI training raw payload without consent/redaction |
| Admin finance/payment | Finance | Transaction ID, amount, payer hints, match confidence | Account number, depositor details outside detail view | Passport, customer chat transcript |
| Admin AI/Jarvis/QA | AI Ops | Redacted snippets, scenario IDs, model outputs, policy IDs | Names/contact in prompt previews | Raw PII in training/eval logs |
| API logs and error logs | Engineering | Route, status, request ID, non-PII metadata | Token-like values, emails, phone strings | Full body dumps containing PII |
| Analytics/events | Growth/Product | Session ID, visitor UID, event name, product ID, ranks | Coarse intent text | phone, email, passport, account, free-form private notes |

## UX Rules

- Lists should optimize scanning: status, amount, date, owner, confidence, and next action first; PII appears only when it changes the next action.
- Use masked labels by default, for example `010-****-1234` or `k***@naver.com`.
- Prefer drilldown over dense tables for sensitive detail. The dashboard should answer "what needs attention" before "who is this customer".
- Add copy buttons only for fields that operators repeatedly need and that are safe for the role.
- AI surfaces must show source, confidence, and redaction state before generated recommendations.

## Audit Control

- Run `npm run audit:pii-surface` after touching admin, API, logging, tracking, AI learning, or customer detail pages.
- The audit is a discovery gate by default and exits successfully with findings. Use `npm run audit:pii-surface:strict` when preparing a hardening sprint.
- Every new high-risk PII surface should either be masked in code or added to this matrix with a reason and owner.
- Canonical package/intake source text may stay stored as original `raw_text` for registration quality, re-extraction, and Rule Zero hash verification. Do not add per-read audit logging by default; add it only for explicitly regulated data or a clear business requirement.
