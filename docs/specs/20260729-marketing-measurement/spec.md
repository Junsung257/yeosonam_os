# Marketing Measurement Foundation — Spec

## Goal

Connect acquisition, package engagement, lead submission, authoritative booking/payment outcomes, and revenue without sending PII to analytics vendors.

## Invariants

- GTM is the only client-side Google tag loader.
- All four Consent Mode v2 states default to `denied`.
- Tags do not load before a stored user choice grants analytics or advertising.
- Client code emits typed business events only; it never owns Google Ads labels.
- `generate_lead` requires a persisted lead.
- `purchase` and `refund` require authoritative server financial evidence.
- Names, phone numbers, email addresses, free-form messages, notes, and addresses never enter `dataLayer`.
- Analytics failures never block customer, booking, payment, or refund flows.

## External boundaries

GTM publication, GA4 key-event configuration, Google Ads conversion configuration, Search Console verification, legal text, and production verification remain operator-owned.
