# AI Ops Current SSOT

Last updated: 2026-08-30

This is the current operating contract for AI provider policy, Jarvis, RAG, QA, prompt routing, evals, model fallback, and learning-loop evidence.

## Scope

This document owns:

- AI task provider/model policy;
- Jarvis internal assistant routing and tool boundaries;
- RAG indexing, retrieval, and freshness checks;
- prompt/version behavior for AI-powered systems;
- eval and readiness gates for AI changes;
- cost, timeout, fallback, and manual-approval behavior.

Detailed provider policy operations remain in `docs/ai-policy-operations.md`. Jarvis architecture details remain in `docs/jarvis-orchestration.md`, `docs/jarvis-rag-audit-runbook.md`, and `docs/jarvis-readiness-gate.md`. Repeated failures belong in `docs/errors/ai-ops.md`.

## Source Of Truth

| Area | Current source |
|---|---|
| AI provider routing | `src/lib/ai-provider-policy.ts`, `scripts/ai-provider-switch.mjs` |
| Blog generation V4/V5 exception | `src/lib/blog-deepseek-orchestrator-v4.ts`, `src/lib/blog-editorial-harness-v5.ts`, `src/lib/blog-ai-caller.ts`, `docs/runbooks/blog-deepseek-orchestrator-v4.md` |
| Jarvis APIs | `/api/jarvis`, `/api/jarvis/stream`, `/api/admin/jarvis/**` |
| Jarvis orchestration | `src/lib/jarvis/orchestration/**`, `src/lib/jarvis/v2-dispatch.ts` |
| Jarvis RAG/evals | `src/lib/jarvis/rag/**`, `src/lib/jarvis/eval/**` |
| AI operations command center | `/api/admin/automation-command-center`, `src/lib/automation-command-center.ts`, `/admin/control-tower` |
| Prompt behavior | domain-specific prompt files plus active DB prompt versions when used |
| AI telemetry | `src/lib/telemetry/llm-tracer.ts`, `src/instrumentation.ts`, `src/lib/telemetry/sentry-scrubber.ts` |
| Non-authority feature flags | `src/env.ts`, `src/lib/feature-flags.ts` |
| Error memory | `docs/errors/ai-ops.md` |

## Required Invariants

- DB `system_ai_policies` outranks env overrides, and env overrides outrank code defaults.
- A model/provider switch must preserve fallback behavior or explicitly document why fallback is disabled.
- AI output is not trusted just because the model is stronger. Persisted or customer-visible outputs need schema validation, quality gates, or eval coverage appropriate to the domain.
- Jarvis tool access must remain scoped by tenant, role, and approved table/tool allowlists.
- RAG answers must distinguish retrieved evidence, inferred reasoning, and missing context.
- Human-in-the-loop actions must not be auto-executed when the action mutates money, bookings, customer data, external publishing, or credentials.
- The AI operations command center is read-only. Its one-click recommendation may only navigate to review/approval surfaces or refresh the snapshot.
- Prompt fixes for repeated failures must become an eval, regression test, deterministic gate, or error-registry entry.
- AI spans follow current OpenTelemetry GenAI attribute names and never record raw prompt/response content by default. Sentry events must pass the shared telemetry scrubber before transmission.
- Generic feature flags may control reversible UI, canary, or availability behavior only. Publication freeze, financial authority, external publishing, credentials, and other safety gates remain domain-owned fail-closed controls.

## Provider And Prompt Boundary

### Blog Orchestrator V4 exception

Scheduled blog publication is a DeepSeek-only, evidence-bounded lane. DeepSeek V4 Pro structures directly fetched, pre-reviewed source pages; DeepSeek V4 Flash creates the grounded draft; and DeepSeek V4 Pro performs bounded rewrites plus the independent V5 editorial judgment at temperature 0. Gemini, GPT, Claude, generic provider cascades, and search-snippet grounding are not permitted anywhere in this publication lane. Missing reviewed source coverage, decision artifact, prompt trace, editorial-judge result, budget reservation, or evaluation persistence fails closed. General factual/output repair retains the five-call V4 ceiling, while a V5 usefulness/naturalness/completeness/originality/source-honesty failure receives only one writer rewrite before quarantine. Generation and editorial judgment reserve separate rows under the same KST-day cap. Daytime publication reads a durable selected `approved_for_slot` attempt and makes zero model calls. Other non-blog AI tasks continue to follow `system_ai_policies` and the general provider policy.

Correct sequence for AI behavior changes:

1. Identify the task and domain owner.
2. Update DB policy, env override, or code default deliberately.
3. Keep fallback and timeout behavior explicit.
4. Run the task-specific eval or readiness gate.
5. Persist evidence of the change when behavior is customer-visible or operationally risky.

Do not treat a one-off better answer in chat as proof that an AI behavior is fixed.

## Durable Artifact Rule

Changes to AI routing, Jarvis tools, RAG indexing, prompt contracts, eval gates, provider fallback, or learning loops require at least one durable artifact:

- eval or regression test for the failure;
- update to this SSOT or a domain SSOT when the invariant changes;
- entry in `docs/errors/ai-ops.md` for repeated failures;
- audit note under `docs/audits/**` when live evidence matters.

## Customer Inquiry Answer Quality Gate

Customer-facing Jarvis/QA changes must keep `npm run verify:customer-inquiry` green. This gate now includes answer-quality cases in addition to risk, guest-tool, security, and support SOP checks.

Runtime customer answers also pass through `src/lib/jarvis/customer-answer-guard.ts` on customer surfaces. The guard corrects unsupported refund/cancel/payment promises, unverified service-recovery compensation/benefit promises, unverified price/seat/inventory availability promises, unverified price-match/lowest-price/competitor-quote/coupon-stack promises, unverified schedule/local-time/pickup/meeting-point promises, unverified ticket/passport/ID name-mismatch boarding promises, unverified passport-validity/blank-page/visa-waiver/ETA/transit-visa/entry-permit promises, unverified lost/stolen passport abroad, emergency-passport, or emergency-travel-document promises, unverified immigration-admissibility/criminal-record/overstay/visa-refusal promises, hidden mandatory-fee or partial headline-price replies, manipulative sales-pressure and false-scarcity replies, unverified review/rating/testimonial/social-proof claims, unverified hidden-profile/personalization claims, unverified privacy/data-handling/training/deletion promises, unverified legal/chargeback/consumer-dispute promises, unverified hotel room/special-request promises, unverified product-detail/inclusion promises, unverified mileage/point/referral/affiliate benefit promises, unverified autonomous booking/payment/checkout completion promises, AI-human impersonation or human-handoff refusal, repeat-everything handoff friction, defensive customer-blame complaint replies, unverified insurance/medical coverage promises, unverified medical-symptom diagnosis/medication/wait-and-see/continue-travel advice, unverified flight disruption refund/compensation promises, unverified supplier/organiser disruption, strike, insolvency, or force-majeure promises, unverified destination-safety promises, unverified special-traveler fit-to-travel promises, unverified accessibility/accommodation promises, unverified minor-travel document promises, unverified travel-medication/customs promises, unverified pet/service-animal travel promises, unverified customs/quarantine/duty-free/currency promises, unverified health-entry/vaccination/test/quarantine promises, unverified payment-link/account-transfer safety promises, unverified overseas-driving/rental-car/license/insurance promises, unverified local-law restricted-activity promises, unverified lithium-battery/power-bank baggage promises, unverified airport-security item/carry-on checkpoint promises, unverified airline baggage allowance/fee promises, unverified baggage loss/delay/damage delivery, reimbursement, compensation, or waived-report promises, unverified adventure/water/altitude/high-risk activity safety, suitability, certification, weather, waiver, or insurance promises, unverified flight connection/self-transfer promises, unverified allergen/special-meal safety promises, personal-safety crisis replies without immediate-help guidance, direct sensitive-data collection requests including OTP/login/verification-code and passport/ID/card image requests in chat, dead-end no-match answers, visa/passport answers without official-source caveats, emergency replies without local-authority/human follow-up, and complaint replies without acknowledgement or handoff. The guard is applied in `/api/jarvis`, `/api/jarvis/stream`, `/api/qa/chat`, and `/api/qa/chat/v2`.

The required customer-answer contract is:

- admit missing booking/payment/product context instead of guessing;
- state the evidence boundary for policy, payment, visa/passport, product, or emergency guidance;
- provide a concrete next step or human handoff, especially for complaints, emergencies, no-match recommendations, and service recovery;
- be transparent that Jarvis is an AI assistant, not a human counselor, and preserve context when routing to a human so customers do not need to repeat everything;
- when customers say they already explained the issue, summarize known facts, preserve the needed context, ask only for missing details, and prepare a handoff summary instead of forcing them to restart from the beginning;
- do not blame customers, dismiss responsibility, or say "not our problem" in complaints before reviewing booking records, supplier terms, policy, conversation history, complaint records, and owner/manager review;
- avoid unsupported promises such as confirmed refunds, discounts, cancellations, payment matches, price guarantees, seat guarantees, inventory guarantees, or policy exceptions;
- do not promise service-recovery benefits such as compensation, fee waivers, coupons, vouchers, credits, upgrades, free services, or policy exceptions until booking records, supplier conditions, policy terms, complaint history, and manager/owner approval are checked;
- do not present prices, seats, inventory, or departure availability as final until live inventory, supplier, airline, booking-screen, or quote evidence has been checked;
- do not promise price matching, lowest-price guarantees, competitor-quote acceptance, coupon stacking, discount stacking, or refund of a price difference until like-for-like current quotes, identical itinerary/hotel/room/flight/fare/inclusions/exclusions, cancellation/refund terms, total mandatory fees, taxes, surcharges, local payments, currency/exchange rate, booking window, promotion/coupon terms, supplier approval, manager approval, and the price-match policy are checked;
- do not present a base fare, displayed price, or headline discount as the total customer cost while hiding mandatory fees, taxes, surcharges, resort/local payments, service fees, payment schedule, cancellation/change fees, supplier terms, or refundability;
- do not pressure customers with unverified scarcity, urgency, fear-of-missing-out, "book now", "last chance", "only one left", "do not compare", or regret language; recommendation answers must support comparison, tradeoff explanation, final customer confirmation, and verified deadline/availability evidence;
- do not invent or overstate reviews, ratings, testimonials, influencer endorsements, review summaries, popularity, "everyone loves it", "no complaints", or social-proof claims without review source, review count, rating source, review date, recent reviews, negative reviews, original review text where available, and platform/provider context;
- do not claim hidden memory, browsing history, payment history, location history, income level, family status, personality traits, individualized pricing, or inferred customer profiles for personalized recommendations unless the answer states the customer-provided preference, current conversation context, explicit consent, permissioned account/booking source, privacy notice, and update/removal path;
- do not promise that customer chats are never stored, already deleted, never used for AI/model training, always used for training, invisible to human reviewers, retained forever, or opted out until the current privacy policy, data policy, retention policy, account/consent setting, training opt-out status, deletion/data-subject request, audit log, processing record, and human-review policy are checked;
- do not guarantee hotel bed type, connecting/adjoining rooms, room view, high floor, crib, rollaway/extra bed, early check-in, late checkout, honeymoon/anniversary amenities, or other special requests until hotel/property confirmation, supplier confirmation where relevant, reservation page, voucher or confirmation email, confirmed room product, room type and inventory, rate-plan terms, availability at check-in, front-desk handling, and extra/upgrade charges are checked;
- do not confirm package inclusions/exclusions, itinerary details, hotel/room type, guide, vehicle/transfer, meals, entrance tickets, optional tours, amenities, views, upgrades, or free add-ons until the product source, supplier contract, terms, itinerary, reservation page, quote, voucher, hotel confirmation, room type, and option list are checked;
- do not confirm mileage, points, reward balance, referral-code benefits, coupons, credits, affiliate commission, influencer rewards, redemption, expiry, or payout until the reward/mileage ledger, program terms, booking status, payment status, referral-code record, affiliate contract, commission rule, settlement record, and required approval are checked;
- do not claim that Jarvis, an AI agent, or an automated chat flow has booked, reserved, paid, purchased, completed checkout, or confirmed a package on the customer's behalf until final customer confirmation, secure payment authorization, booking record review, live availability or supplier evidence, and human counselor approval where required are complete;
- do not confirm travel-insurance coverage, medical reimbursement, claim approval, or medical judgment until policy terms, insurer/claim desk, exclusions, and medical records or qualified care guidance are checked;
- do not diagnose travel symptoms, prescribe or recommend medication, tell customers to wait, skip care, continue a tour, continue flying, or treat symptoms as non-serious from chat alone; chest pain, breathing difficulty, fainting, confusion, seizure, severe headache, high fever, bloody diarrhea, dehydration, severe allergic reaction, animal bite, serious injury, worsening symptoms, or similar red flags should be routed first to local emergency services, ambulance, hospital, doctor, clinic, qualified medical care, travel insurer assistance, and emergency counselor handoff;
- do not confirm flight-disruption refunds, compensation, rerouting, meal vouchers, or hotel coverage until airline notice, official flight status, ticket/fare rules, package terms, and disruption cause are checked;
- do not confirm that a package, tour, hotel, transfer, cruise, ferry, or local service will operate, be replaced, be refunded, be insured, be charged back, or be repatriation-protected during supplier failure, tour-operator insolvency, strikes, force majeure, unavoidable extraordinary circumstances, natural disasters, pandemics, or civil unrest until supplier confirmation, organiser/operator status, contract and package terms, booking record, voucher, official failure notice, insolvency protection or bond/guarantee fund, protection certificate such as ATOL where relevant, insurance supplier-default coverage, card issuer rules, ticket validity, official travel recommendations, and manager approval are checked;
- do not confirm departure, arrival, pickup, meeting-point, tour start, check-in, local-time, time-zone, date-line, arrival-day, or calendar time details until voucher, e-ticket/ticket, itinerary, reservation page, supplier confirmation, airline confirmation or flight status, local time zone, UTC offset where relevant, meeting-point confirmation, pickup reconfirmation, and booking record are checked;
- do not confirm that a customer can board with a ticket, passport, government-issued ID, boarding-pass, romanization, spelling, middle-name, legal-name-change, married/maiden-name, or name-order mismatch until the ID/passport name, ticket/e-ticket name, reservation record or PNR, Secure Flight/SFPD data where relevant, airline policy, carrier rule, name-correction or reissue eligibility, same-passenger proof, and legal-name-change documents such as marriage certificate or court order are checked;
- do not confirm passport validity, passport expiry sufficiency, blank-page sufficiency, visa-free entry, visa waiver, ETA/ESTA/eTA exemption, entry permit, tourist visa, transit visa, TWOV, boarding permission, or destination entry until latest official embassy/consulate/foreign-ministry, IATA Travel Centre or Timatic, airline/carrier, destination/transit rule, nationality/citizenship, passport type, passport expiry, return/departure/arrival dates, blank pages, electronic authorization, entry/exit requirement, and immigration/border-control rules are checked;
- do not confirm boarding, exit permission, return travel, same-day emergency passport issuance, emergency travel document issuance, travel with a passport copy/photo, or waiver of police report/embassy visit/airline/immigration checks after a lost or stolen passport abroad until the nearest embassy/consulate or consular officer, police report or lost-passport report, emergency passport or temporary/emergency travel document eligibility, identity/citizenship evidence, passport photo, itinerary, appointment/fee/weekend/holiday constraints, airline/carrier acceptance, immigration or border-control rule, local authority requirement, and exit permit, exit visa, or visa reissue requirements are checked;
- do not confirm entry, visa approval, eTA/ESTA eligibility, waiver exemption, rehabilitation, temporary resident permit/TRP approval, admissibility, or disclosure safety for criminal records, convictions, arrests, DUI/DWI, drug or controlled-substance issues, overstays, prior visa refusals, entry refusals, deportations, removals, or other inadmissibility/ineligibility factors until official immigration law, embassy/consulate guidance, visa or consular officer review, border or immigration officer decision, destination/transit rule, nationality, case facts, court records, police certificates, and legal counsel where needed are checked;
- do not state that a destination is safe, risk-free, or fine to visit until current official travel advisories, embassy/consulate notices, local authority updates, and relevant crime, unrest, health, or disaster signals are checked;
- do not confirm that pregnant travelers, infants, elderly travelers, wheelchair/disability travelers, oxygen/medical-equipment users, or chronic-condition travelers are fit to travel until healthcare-provider guidance, medical-certificate needs, carrier rules, destination health risks, and assistance requirements are checked;
- do not guarantee accessible rooms, wheelchair assistance, step-free routes, elevator/lift/ramp availability, accessible vehicles, tour terrain, bathroom grab bars, doorway width, mobility-device handling, battery handling, service-animal handling, or airport assistance until property, supplier, airline, route, destination, and assistance-request status are checked;
- do not waive minor-travel consent letters, notarization, family relationship documents, custody documents, or guardian proof until destination entry/exit rules, embassy/consulate guidance, carrier rules, border/immigration expectations, and accompanying-parent context are checked;
- do not confirm that prescription medicines, sleeping pills, ADHD medicines, controlled substances, injections/needles, or medical cannabis can cross customs until destination/transit rules, embassy/consulate guidance, medication ingredients, prescription or doctor-letter evidence, original packaging, and permit requirements are checked;
- do not confirm pet or service-animal boarding, cabin carriage, destination entry, or quarantine exemption until destination/transit animal-health rules, rabies/vaccination records, microchip status, health certificates, veterinarian paperwork, USDA/APHIS/CDC or local authority guidance, and carrier rules are checked;
- do not confirm that food, meat, fruit, plants, seeds, soil, wildlife products, alcohol, tobacco, or large cash/currency can pass customs, avoid declaration, or receive duty-free treatment until destination/transit customs rules, quarantine rules, duty-free limits, tax exemptions, country-of-origin evidence, packaging/receipt evidence, permit needs, and cash/currency declaration thresholds are checked;
- do not confirm that vaccination, yellow-fever certificate/ICVP, PCR or test certificate, quarantine, health declaration, or malaria prophylaxis is unnecessary until destination/transit official health and entry requirements, itinerary, airline rules, CDC/WHO/IATA or local health authority guidance, vaccination records, and medical-waiver or clinician guidance are checked;
- do not confirm payment links, changed bank accounts, payment app requests, wire transfers, cryptocurrency, or gift-card/payment-code requests as safe until the official domain/channel, secure payment page, booking/payment record, registered company account, invoice number, and verified counselor or manager review are checked;
- do not guarantee chargebacks, card disputes, consumer complaints, lawsuits, legal outcomes, regulator outcomes, or full refunds until card issuer or credit-card company rules, card agreement, billing statement, dispute deadline, written-dispute requirements, merchant and booking records, contract terms, refund policy, consumer-agency or regulator process, jurisdiction, evidence, and legal counsel where needed are checked;
- do not confirm overseas driving, rental-car, scooter/motorbike use, international-driving-permit exemption, license validity, or insurance coverage until destination traffic law, embassy/consulate or transport authority guidance, IDP rules, license and vehicle class, rental company terms, age requirements, and insurance/liability policy terms are checked;
- do not confirm that cannabis/CBD, vaping/e-cigarettes, drone flights, gambling/casino use, alcohol age, restricted photography, or similar local-law-sensitive activities are legal or permit-free until destination local law, official travel advisory, embassy/consulate guidance, local authority or police rules, customs, aviation authority, permit/registration/license needs, and age or controlled-substance restrictions are checked;
- do not confirm power banks, spare lithium batteries, drone/camera batteries, e-cigarette batteries, or smart-luggage batteries can be checked, gate-checked, or carried without limits until FAA/TSA/IATA or airline dangerous-goods rules, carry-on versus checked-bag rules, Wh/lithium-content limits, short-circuit protection, terminal protection, quantity limits, and airline approval needs are checked;
- do not confirm liquids, aerosols, gels, creams, pastes, duty-free liquids, knives, scissors, razors, sharp objects, tools, lighters, matches, firearms, ammunition, pepper spray, powders, or similar items can pass airport security or go in carry-on until TSA or local airport security rules, final screening-officer discretion, airline and country rules, departure/transit/destination airports, 3-1-1 liquid limits, container size, medical and duty-free exceptions, sharp-object rules, and FAA PackSafe or dangerous-goods limits are checked;
- do not confirm baggage allowance, carry-on permission, checked-bag count, free baggage, overweight/oversize acceptance, stroller/car-seat/sports-equipment handling, or excess baggage fees until airline baggage policy, operating/marketing carrier, codeshare or interline rules, ticket/e-ticket, fare family/class, cabin class, route, origin/destination/connection, piece or weight concept, carry-on/personal-item limits, checked-bag weight and size limits, oversize/overweight rules, elite/card benefits, infant allowance, and special-item policy are checked;
- do not confirm that lost, delayed, or damaged baggage has been found, will be delivered by a specific time, qualifies for full reimbursement, emergency purchase coverage, compensation, airline liability, insurance coverage, or waived report/deadline steps until the carrier baggage desk or airline record, baggage claim tag, boarding pass/ticket, PIR or file reference, arrival airport, baggage claim area, written claim deadline, receipts for essentials, airline liability/policy, DOT or Montreal Convention rules where relevant, travel-insurance policy, delivery address/contact, medication or critical-item needs, and counselor review are checked;
- do not confirm scuba, snorkeling, hiking, rafting, ATV, zipline, paragliding, high-altitude, or similar adventure activities are safe, suitable, weather-cleared, certification-free, waiver-free, or insurance-covered until activity operator/supplier status, licensed-provider requirements, guide/instructor qualification, safety briefing, equipment/protective gear, weather, sea/current or altitude/route condition, age/height/weight/swimming/fitness requirements, medical condition such as asthma or pregnancy, waiver terms, certification/license needs, travel-insurance exclusions, local rules, emergency/rescue plan, and counselor or qualified medical review are checked;
- do not confirm that a flight connection has enough time, baggage will transfer automatically, immigration/customs/security can be skipped, separate tickets are safe, or a missed connection will be protected/rebooked until minimum connection time/MCT, same-ticket versus separate-ticket structure, through-ticket/protected-connection status, airline and operating-carrier rules, airport/terminal/gate layout, inbound-delay risk, gate cutoff, boarding pass, immigration/passport-control, customs/federal inspection, baggage reclaim, bag recheck, security screening, interline/codeshare handling, and rebooking options are checked;
- do not guarantee allergen-free, nut-free, gluten-free, halal/kosher/vegetarian/vegan special meals, airline meals, hotel meals, restaurant meals, or no cross-contact outcomes until supplier kitchen/menu/ingredient records, airline or hotel rules, special-meal request status, traveler medical guidance, epinephrine access, emergency plan, and counselor confirmation are checked;
- if a customer mentions self-harm, suicide, assault, sexual assault, domestic/dating violence, stalking, trafficking, abuse, being followed, or feeling unsafe in a room/hotel, prioritize immediate safety: local emergency services, police, hospital/medical support, hotel front desk, trusted person, embassy/consulate, crisis hotline where applicable, and urgent human counselor handoff; do not keep the customer waiting for ordinary booking review;
- do not ask customers to type or upload passport numbers, resident registration numbers, card numbers, passwords, bank details, verification codes, OTPs, two-factor codes, login codes, SMS codes, passport copies, ID photos, card photos, license scans, bankbook images, or equivalent sensitive identifiers directly into chat; route those cases to a secure input surface, secure upload, or official verification path that does not require sharing the code or document image in chat;
- avoid dead-end answers that only say the system cannot help;
- use bounded empathy: acknowledge concern briefly, then move to facts, owner review, or official-source verification.

Research/evidence note: `docs/audits/2026-07-05-jarvis-customer-inquiry-research.md` maps current customer-service AI, RAG hallucination, empathy, trust, and governance findings to the deterministic gate cases in `src/lib/jarvis/eval/customer-answer-quality.ts`.

## Jarvis OS Feature Coverage Gate

`npm run verify:jarvis-all-scenarios` includes a deterministic feature coverage gate in `src/lib/jarvis/eval/feature-coverage.ts`.

This gate must keep coverage across all six Jarvis OS domains:

- operations: booking lookup, payment matching, customer CRM context;
- products: search filters, comparison ranking, customer concierge RAG;
- finance: settlement/tax and revenue KPI support;
- marketing: SNS creative and mileage/gamification support;
- sales: group RFQ and affiliate/influencer support;
- system: policy and audit support.

High-risk cases must declare an approval boundary before the all-scenario gate can pass.

Every declared Jarvis agent tool must be assigned to a feature coverage owner. If a new tool is added to operations, products/concierge, finance, marketing, sales, or system without being listed in the coverage matrix, the feature coverage gate must fail. Mutating mileage tools such as `adjust_mileage` and `create_mileage_event` are HITL-gated and blocked from customer guest mode.

Customer guest tool exposure is allow-list based in `src/lib/jarvis/guest-guardrail.ts`. New read tools are not customer-visible by default; they must be deliberately added to the guest allow-list and covered by `npm run verify:customer-inquiry` before being exposed. Sensitive read tools such as customer search, booking detail, guest-name lists, and customer mileage lookup remain hidden from guest mode.

## Verification

Use the narrowest applicable checks first:

```bash
npm run verify:jarvis-readiness
npm run verify:jarvis-all-scenarios
npm run verify:customer-inquiry
npm run eval:jarvis
npm run eval:concierge:promptfoo
npm run audit:jarvis-rag
npx vitest run src/lib/automation-command-center.test.ts src/app/admin/control-tower/_components/AutomationCommandCenterCard.test.tsx
npm run type-check
```

For blog, product registration, settlement, affiliate, or marketing AI behavior, also run that domain's SSOT verification checks.

### Promptfoo challenger lane

`npm run eval:concierge:promptfoo` is an advisory challenger beside the existing
`eval:concierge` gate. It evaluates the committed concierge corpus through
Promptfoo's zero-cost `echo` provider and the repository-owned deterministic
assertion. It does not call a model, customer API, database, or production
surface, and it must not replace `verify:customer-inquiry` or the Jarvis gates.
The first run may access npm only to download the exact pinned CLI package.

- Promptfoo is pinned to `0.122.0`; do not use `@latest` in automation.
- Sharing, cache/result writes, telemetry, update checks, remote generation,
  template environment variables, and local debug/error logs are disabled by default.
- Only reviewed repository configs and assertion files may be executed because
  Promptfoo custom code runs with the local process permissions and is not a sandbox.
- A real-model comparison is an explicit operator run only. It requires the
  domain provider policy, cost reservation, redacted fixtures, and a non-production
  endpoint or provider override; never add API keys to YAML or exported results.
- The manual `Concierge Promptfoo Challenger` workflow remains non-blocking until
  the corpus is expanded and its score is proven stable against the authoritative
  customer-inquiry gate.
