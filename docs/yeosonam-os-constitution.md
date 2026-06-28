# Yeosonam OS Constitution

Last updated: 2026-06-28
Status: Accepted product constitution
Owner: Yeosonam OS

This document is the top-level product constitution for Yeosonam OS. It does not replace domain SSOT files such as `docs/product-registration-current-ssot.md`, `docs/settlement-current-ssot.md`, `docs/marketing-current-ssot.md`, or `docs/ai-ops-current-ssot.md`. It defines the product identity, boundaries, MVP, and decision rules that those domain documents must serve.

## 운영자용 한글 요약

여소남 OS는 "여행사 홈페이지"가 아니라 작은 한국 여행사의 매일 업무를 묶는 운영체제다. 핵심은 고객 유입, 상담, 상품 확인, 견적, 팔로업, 예약, 입금, 정산, 여행서류, 리뷰와 재마케팅을 하나의 증거 기반 흐름으로 연결하는 것이다.

가장 중요한 원칙은 세 가지다.

1. **AI는 초안과 판단 보조까지만 한다.** 가격, 좌석, 항공, 호텔, 법적 조건, 입금, 정산, 외부 광고 집행은 근거와 사람 확인 없이 확정하지 않는다.
2. **여소남은 generic CRM/ERP/OTA가 아니다.** 상담-견적-예약-정산-마케팅이 이어지는 여행업 전용 OS여야 한다.
3. **MVP는 작게 가되 뼈대는 제대로 간다.** 문의 관리, 상담 메모, 고객 팩트, 근거 있는 견적 초안, 팔로업 알림, 상품/콘텐츠 지식베이스, 간단 대시보드, Jarvis 승인 패킷이 1차 목표다.

## 핵심 질문 답변

| 질문 | 답변 |
|---|---|
| What is Yeosonam OS exactly? | 한국 여행사의 유입-상담-견적-예약-정산-마케팅을 AI와 증거 기반 액션 큐로 운영하는 B2B2C 여행 운영체제다. |
| Who uses it first? | 여소남 운영자와 상담/예약/상품/마케팅 담당자다. 이후 파트너 여행사, 랜드사, 제휴자, 테넌트로 확장한다. |
| What daily pain does it solve? | 문의 누락, 상담 이력 분산, 견적 작성 지연, 팔로업 실패, 상품 근거 부족, 입금/정산 실수, 콘텐츠와 매출 단절을 줄인다. |
| What should the MVP not include? | 풀 OTA, 완전 자율 예약, 라이브 광고 자동집행, 대형 ERP 전체 복제, 범용 프로젝트 관리, 출처 없는 AI 여행 플래너는 제외한다. |
| How does it differ from generic CRM? | 고객 카드가 아니라 여행 상담, 출발일, 인원, 예산, 상품 근거, 견적, 예약, 입금, 정산, 여행서류, 재마케팅을 한 흐름으로 다룬다. |
| How does it differ from travel ERP? | ERP의 상담/예약/정산 뼈대 위에 AI 초안, 콘텐츠/광고, 제휴/테넌트, 상품 근거 검증, Jarvis 승인 패킷을 결합한다. |
| How does it use AI practically? | 문의 요약, 선호 추출, 다음 질문 추천, 견적/팔로업/블로그/Threads/광고 초안, 상품 비교 이유, 이상 징후 탐지, 내부 보고서 생성에 쓴다. |
| What data must be stored? | 문의, 상담 이력, 고객 팩트, 상품 원문/근거, 가격/날짜, 견적/RFQ, 예약 상태, 입금/ledger, 정산, 제휴/채널, 콘텐츠/광고 상태, AI 승인 근거다. |
| What data should not be stored? | 불필요한 원본 PII, 결제 자격증명, 승인 없는 외부 토큰, AI 학습용 무마스킹 전문, 내부 마진 메모가 섞인 고객 노출 문구, 추측 가격/좌석/호텔 정보다. |
| How does it connect to YIOS later? | 테넌트, 권한, 상품/예약/정산 상태, Jarvis 도구, MCP 타입 작업, evidence pack을 YIOS 연동 경계로 삼는다. |
| How does it help generate revenue? | 팔로업 누락 감소, 견적 속도 향상, 상품 신뢰도 증가, 콘텐츠-리드 연결, 제휴 추적, 반복 여행/재견적, 정산 실수 방지로 매출 전환을 높인다. |
| What is the fastest useful version? | 문의함 + 상담 타임라인 + 고객 팩트 + 근거 있는 견적 초안 + 팔로업 액션 큐 + 상품/콘텐츠 지식베이스 + 간단 대시보드다. |

## 0. Executive Summary

Yeosonam OS is a B2B2C travel operating system for a Korean travel business. It connects land operators, the Yeosonam platform, partner travel agencies, affiliates, and customers across one evidence-backed workflow:

```text
content/ad/social exposure
  -> inquiry
  -> consultation
  -> product/source check
  -> quote/recommendation/RFQ
  -> follow-up
  -> booking
  -> payment/ledger/settlement
  -> travel documents
  -> review/repeat marketing
```

The system must not become a generic CRM, generic ERP, or fake AI travel planner. The daily product must help staff sell and operate real travel products faster without inventing prices, seats, hotels, flights, supplier confirmations, legal terms, or payment status.

The fastest useful version is not "full autonomous travel agency." It is:

1. Capture every inquiry and source channel.
2. Keep consultation history and reusable customer facts.
3. Turn source-backed products into quote and recommendation drafts.
4. Create action queues for follow-up, payment, seats, documents, and review.
5. Generate content and ad drafts only from eligible products.
6. Let Jarvis prepare decision packets, evidence, dry-runs, and drafts while humans approve risky mutations.

## 1. What Yeosonam OS Is

Yeosonam OS is the operating layer for a modern Korean travel agency that sells honeymoon, resorts, cruises, package tours, golf travel, Japan, China, Southeast Asia, private group travel, and supplier-backed custom products.

It is an operating system because it owns the business state, not just UI screens:

- customer and inquiry memory;
- product source truth;
- consultation and quote state;
- booking state machine;
- payment and settlement evidence;
- affiliate and tenant attribution;
- marketing and content state;
- AI action packets and approval history;
- learning events and regression evidence.

It is B2B2C because Yeosonam is not only selling to end customers. It also needs land-operator workflows, tenant/partner travel-agency workflows, affiliate/referral flows, and eventually YIOS/platform integrations.

## 2. What Yeosonam OS Is Not

Yeosonam OS is not:

- a generic CRM with travel labels;
- a generic ERP clone;
- a consumer OTA competing on unlimited real-time inventory;
- a fully autonomous booking agent;
- a blog generator detached from sellable products;
- an AI chatbot whose answers are treated as facts;
- a spreadsheet replacement that still requires duplicate manual entry;
- a single-model AI product hard-coded to one provider;
- a one-channel marketing tool hard-coded to Naver, Threads, Kakao, Meta, or Google.

## 3. First Users

The first user is the Yeosonam operator or staff member handling customer inquiries, product registration, quotes, follow-up, booking, payment, settlement, and marketing handoff.

The second user is the owner/manager who needs to see:

- where sales are stuck;
- which inquiries need follow-up;
- which products can be marketed;
- which payments or settlements are risky;
- which AI actions are safe to approve;
- which content and ads are creating leads.

The third user, later, is the partner travel agency, land operator, affiliate, or tenant using a scoped version of the same operating flow.

## 4. Core Workflow

The product must be designed around the real daily workflow of a small Korean travel agency:

1. Customer sees Naver blog, cafe, Threads, ad, Kakao channel, referral link, or landing page.
2. Customer asks through phone, Kakao, form, DM, RFQ, or web chat.
3. Staff asks destination, date, budget, people, departure city, airline preference, hotel grade, travel style, mobility constraints, passport/visa/document needs, and decision timeline.
4. Staff checks products, supplier source, seats, hotels, flights, land operator conditions, price, option costs, shopping/guide conditions, and cancellation terms.
5. Staff creates a quotation, recommendation, comparison, or RFQ.
6. Customer compares and delays.
7. Staff follows up with context, not generic reminders.
8. Booking happens.
9. Payment, documents, settlement, and supplier handoff are handled with ledger evidence.
10. Customer receives travel documents and reminders.
11. Post-trip review, passport/history, repeat quote, affiliate attribution, and marketing reuse happen.

Any feature that does not improve this workflow must prove why it belongs in the MVP.

## 5. Constitutional Principles

### 5.1 Evidence Before Automation

Automation must be evidence-backed. A UI label, model answer, or operator wish is not enough evidence for prices, availability, payment, settlement, customer consent, supplier confirmation, or external publishing.

### 5.2 AI Drafts, Humans Confirm

AI may summarize, extract, compare, recommend, draft, route, and prepare decision packets. It must not silently create customer-facing facts or mutate high-risk production state.

Human approval is required for money, bookings, customer data, privacy, credentials, external publishing, live ad spend, policy changes, and supplier/customer commitments.

### 5.3 Product Source Truth Wins

Customer-ready products must come from source-backed supplier, land-operator, or internally approved product data. If source evidence is missing, the system may create a review item, not a public product or quote fact.

### 5.4 Statuses Are Separate

Draft, review-needed, approved, customer-openable, booked, paid, settled, published, externally confirmed, and completed are separate states. The product must never collapse them into one vague "done" state.

### 5.5 Action Queue Beats Passive Dashboard

Operators need "what must I do next?" more than a large status board. Dashboards are useful only when they lead to follow-up, seat check, payment match, document request, quote update, product repair, approval, or review action.

### 5.6 Customer/Internal Data Separation

Customer-facing fields must never contain margin, commission, supplier negotiation notes, internal error text, or unverified AI assumptions. Internal notes must remain internal.

### 5.7 Ledger Is Financial Truth

Payments, refunds, settlements, reversals, and manual adjustments must create or reference immutable ledger evidence. Spreadsheet totals or UI text are not financial truth.

### 5.8 Marketing Follows Product Eligibility

Blog, Threads, card news, ads, and search campaigns must use customer-openable products or clearly marked editorial content. Product-backed marketing must not promote packages with missing source proof, stale mobile proof, unresolved internal notes, or blocked eligibility.

### 5.9 Multi-Tenant And Affiliate Scope Are Core

Tenant, affiliate, referral, and partner scope are not optional later concerns. Data access, attribution, settlement, and dashboards must be scoped server-side from the start.

### 5.10 Model, Storage, And Channel Abstraction

Do not hard-code one AI model, one vector store, one storage backend, one ad platform, or one content channel. The repo may have defaults, but architecture must keep provider boundaries explicit.

### 5.11 Failures Become Guards

Every customer-impacting, operationally meaningful, security/privacy, money, booking, settlement, product, marketing, or AI failure must leave a durable guard before it is called resolved. The guard may be a fixture, regression test, eval, deterministic gate, SSOT rule, error-registry entry, readiness check, or monitored action queue rule.

The guard must fit the domain. Do not force product-registration fixtures, blog editorial gates, mobile proof, or macro mining onto domains where they do not match the risk.

A one-time manual repair is not a system fix. If a guard is intentionally not added, the closeout must state why the failure is non-repeatable or too small to warrant a durable artifact.

Repeated failures get a higher bar: they must be added to the active error registry or the matching domain error file, and the next fix must include a prevention mechanism.

### 5.12 Pattern, Not Playbook

Product registration and blog automation are strong examples, not templates to copy into every feature. The reusable pattern is:

```text
failure or risky behavior
  -> domain evidence
  -> domain-specific guard
  -> verification proof
  -> operator-visible status
```

Domain-specific guard examples:

| Domain | Guard shape |
|---|---|
| 상품등록 참고 | source evidence, customer render proof, fixture/eval when parser behavior changes |
| 블로그 참고 | topic/editorial/render/image/SEO/indexing gates before public publish |
| Settlement | ledger path, reconciliation, reversal proof, idempotency key |
| Affiliate | attribution snapshot, commission eligibility check, payout boundary |
| Marketing | draft/stage/approve/provider confirmation, spend guardrail |
| Jarvis/AI | eval, trace, HITL, decision packet, scoped tool allowlist |
| Consultation/CRM | consent, PII minimization, customer fact audit, tenant scope |

### 5.13 Small MVP, Strong Spine

The MVP must stay small, but its spine must be correct: inquiry, consultation memory, source-backed product, quote/recommendation draft, follow-up action, booking/payment evidence, and marketing handoff.

### 5.14 Learning Improves Every Process

Every process that produces repeated work or risky decisions should generate learning evidence:

```text
event or failure
  -> structured evidence
  -> classification
  -> bounded repair or human review
  -> fixture/eval/rule candidate
  -> reviewed promotion
  -> regression/readiness proof
  -> operator-visible report
```

Learning must improve the process, not mutate production blindly. Macro learning may propose parser rules, prompt changes, product repairs, marketing actions, or Jarvis tools, but production behavior changes still go through review, tests, and domain gates.

Do not require every domain to build the same learning mechanism. Product registration may need golden corpus and macro mining; settlement may need ledger drift checks; marketing may need provider confirmation and spend guardrails; CRM may need consent and PII checks. The common rule is evidence-backed improvement, not identical machinery.

## 6. MVP Scope

The MVP should focus on these eight capabilities:

1. **Inquiry inbox**: capture web form, landing-page lead, affiliate/referral context, chat/session linkage, and source channel.
2. **Consultation record**: notes, customer facts, travel preferences, constraints, conversation summary, next question, and next action.
3. **Product knowledge base**: source-backed package/product records, land operator info, price/date evidence, customer-open eligibility, and internal-only notes separation.
4. **Quote/recommendation draft**: compare products by date, destination, price, hotel, flight, shopping, options, and customer intent; present reasons before scores.
5. **Follow-up queue**: reminders for quote follow-up, unpaid balance, seat check, missing documents, contract/payment, review request, and stale RFQ.
6. **Booking/payment/settlement handoff**: create booking requests idempotently, match payments through ledger paths, and keep payout/settlement evidence separate from attribution.
7. **Content engine**: blog, Threads, card-news, and ad-copy drafts based on eligible products and marketing channel rules.
8. **Simple operating dashboard**: daily action cards, blocked items, overdue follow-ups, product readiness, lead sources, conversion signals, and AI approval packets.

## 7. MVP Non-Goals

Do not build these before the MVP is used daily:

- full OTA inventory search across flights/hotels/activities;
- autonomous price or seat confirmation;
- live external ad spend autopilot;
- full accounting replacement;
- general-purpose HR/task/project management;
- social media auto-posting without approval and channel proof;
- multi-agent autonomy that can mutate production state without approval;
- complex loyalty/gamification unless tied to repeat marketing;
- beautiful dashboards that do not create actions;
- large schema rewrites that break existing booking, product, affiliate, or settlement contracts.

## 8. AI Employee Concept

Jarvis is not one magical employee. It is an internal AI operating layer with scoped roles:

| Role | What it can do | What it cannot do alone |
|---|---|---|
| AI Sales Assistant | summarize inquiry, extract preferences, suggest next question, draft follow-up | promise price, availability, discount, or booking |
| AI Travel Planner | generate itinerary/quote drafts from source-backed products | invent hotels, flights, legal terms, visas, or supplier confirmations |
| AI CRM Assistant | maintain customer facts, segment leads, suggest next action | expose PII across tenants or overwrite customer truth silently |
| AI Product Manager | detect product gaps, recommend product repairs, compare supplier patterns | approve customer-openable products without proof gates |
| AI Marketer | draft blog, Threads, card news, ad copy, angle tests | externally publish or spend without approval and channel confirmation |
| AI Trend Analyst | analyze destinations, content performance, lead patterns, competitor notes | treat scraped or stale data as confirmed inventory |
| AI Finance Assistant | flag ledger/payment/settlement anomalies | change money state without ledger path and approval |

## 9. Database Model Draft

This is a product-level schema map. Actual table names and migrations remain in Supabase migrations and domain SSOT files.

| Domain | Required data | Notes |
|---|---|---|
| Customers | `customers`, notes, consent, grade, source, lifecycle stage | Store minimum necessary PII and separate customer-visible/internal fields. |
| Consultation | conversations, messages, inquiry summaries, extracted intent, customer facts | `customer_facts` already supports reusable preference/constraint memory. |
| Leads | product/channel/form/tracking/referral/session linkage | Lead creation should be idempotent and link chat facts to customers when known. |
| Products | travel packages, products, price dates, price tiers, source hashes, itinerary data, evidence pack | Source-backed data and customer-open contract control downstream eligibility. |
| Suppliers | land operators, departing locations, attractions, supplier contacts, reliability | Supplier facts must not leak into customer-facing copy unless approved. |
| Quote/RFQ | group RFQs, bids, proposals, comparison reasons, share tokens, reactions | Private-tour flow should support sharing, voting, and re-quote history. |
| Booking | bookings, passengers, segments, status machine, booking tasks | Booking tasks should create action cards, not passive alerts. |
| Payment/Settlement | bank transactions, ledger entries, allocations, settlements, reversals | Ledger is the evidence layer; drift blocks automation. |
| Affiliate/Tenant | affiliates, referral touches, cookies, tenant scope, commission snapshots | Attribution and payable commission are separate. |
| Marketing | content creatives, blog briefs, card news, campaigns, ad actions, performance snapshots | External publish states must stay staged/approved/applied/confirmed. |
| AI Ops | agent actions, decision packets, evals, RAG records, platform learning events | Raw PII should not be stored in learning events by default. |

Data that should not be stored unless there is a clear legal and operational basis:

- unnecessary passport images or raw documents;
- payment credentials;
- full unredacted chat transcripts in AI training tables;
- supplier negotiation terms in customer-facing fields;
- external platform tokens outside the approved secret-management path;
- guessed prices, seats, or availability as facts.

## 10. Architecture Plan

The current architecture direction is:

| Layer | Direction |
|---|---|
| Frontend | Next.js App Router admin/customer surfaces. Keep business logic out of UI components. |
| Backend | Next.js route handlers and server-side services in `src/lib/**`. Do not introduce a separate FastAPI backend unless a future ADR proves operational benefit. |
| Database | Supabase/PostgreSQL with migrations, RLS, idempotent RPCs/services, and ledger-style evidence where needed. |
| AI | Provider abstraction through current AI policy/Jarvis layers. No single hard-coded model. |
| Storage | Abstract file/object storage; product source and evidence packs must remain addressable. |
| Vector/RAG | Keep vector-search readiness for product, customer facts, policy docs, and Jarvis evidence; do not make vector search the only source of truth. |
| Integrations | Kakao, Naver, Solapi, Meta, Google, Threads, supplier APIs, and future YIOS must be adapters with explicit state and confirmation boundaries. |
| MCP readiness | MCP tools can expose typed operations and evidence retrieval, but they must not override repo SSOT or silently mutate high-risk state. |

## 11. Security And Privacy

Security is a product feature. Yeosonam OS handles customer identity, phone numbers, travel preferences, payment state, affiliate payouts, supplier terms, and marketing credentials.

Required rules:

- server-side tenant and affiliate filtering;
- role-scoped admin tools;
- PII minimization and redaction in AI learning tables;
- customer/internal field separation;
- audit events for high-risk actions;
- approval gates for money, booking, customer, external publishing, credentials, and privacy mutations;
- no generic chat form for secrets, payment data, or unrestricted customer documents;
- no cross-tenant analytics unless anonymized and policy-approved.

## 12. Cost Model

The MVP should optimize for owner time saved and conversion lift before infrastructure elegance.

Primary cost buckets:

- LLM calls for extraction, summarization, draft generation, evals, and Jarvis packets;
- embeddings/vector search when product/customer memory grows;
- Supabase database/storage/egress;
- external API costs for Kakao/Solapi/Naver/Meta/Google/Threads;
- browser/render verification costs for product and blog proof;
- staff review time for AI drafts and high-risk approvals.

Cost guardrails:

- deterministic parsing before LLM fallback where source structure is enough;
- stable prompt prefixes and reusable context;
- short summaries stored as structured data rather than repeated long-context prompts;
- dry-run by default for external marketing and Jarvis mutations;
- per-domain readiness checks before expensive live operations.

## 13. Revenue Logic

Yeosonam OS should help revenue by:

- reducing missed follow-ups;
- shortening quote creation time;
- increasing trust through source-backed comparisons;
- improving product readiness and marketing handoff;
- capturing affiliate and channel attribution;
- preventing settlement/payment mistakes;
- reusing customer facts for repeat trips;
- turning blog/social/ad content into measurable leads;
- creating a future tenant SaaS product for small travel agencies.

## 14. Roadmap

### Phase 0: Constitution And Evidence Spine

- This constitution.
- Evidence map.
- ADR.
- Read-order updates.
- Existing SSOT conflict notes where needed.

### Phase 1: Daily Sales OS

- Inquiry inbox and consultation timeline.
- Customer facts and preference extraction.
- Quote/recommendation draft from eligible products.
- Follow-up action queue.
- Simple daily dashboard.

### Phase 2: Product And Marketing Loop

- Product readiness to quote/content handoff.
- Blog/Threads/card-news/ad copy from content briefs.
- Channel-specific approval queues.
- Lead attribution and conversion dashboards.

### Phase 3: Booking, Payment, Settlement Hardening

- Booking task inbox.
- Payment match and ledger reconciliation surfaces.
- Settlement draft/approval/reversal evidence.
- Affiliate/tenant payout separation.

### Phase 4: Jarvis Decision Packets Everywhere

- Jarvis action registry coverage.
- Dry-run and rollback hints.
- Evidence-linked approval UI.
- Domain evals and readiness checks.

### Phase 5: YIOS And SaaS Expansion

- Tenant onboarding.
- Scoped partner dashboards.
- Supplier/land-operator collaboration.
- RFQ marketplace and passport/re-quote loops.
- MCP and YIOS integration through typed, approval-aware tools.

## 15. Success Conditions

The MVP succeeds if Yeosonam uses it daily to:

- track inquiries;
- organize consultation history;
- create faster quotation drafts;
- follow up with customers;
- manage source-backed products;
- generate content ideas and drafts;
- see blocked work clearly;
- increase conversion;
- reuse knowledge;
- prepare for future AI automation and tenant SaaS.

## 16. Failure Conditions

The project fails if:

- it becomes a generic CRM;
- it becomes a generic ERP clone;
- it grows too large before daily MVP usage;
- it ignores the real travel-agency workflow;
- AI features are not used daily;
- it requires too much manual data entry;
- it creates fake travel information;
- it has no measurable sales impact;
- content/marketing stays disconnected from products and leads;
- it cannot integrate with future YIOS;
- it treats old docs as truth even when code, migrations, or current SSOT prove otherwise.

## 17. Source Hierarchy

Use this hierarchy when documents conflict:

1. Actual production code, migrations, package manifest, and current tests.
2. Current domain SSOT files.
3. This constitution for product identity and cross-domain principles.
4. `CURRENT_STATUS.md` as a broad operating snapshot, with its date checked.
5. `.claude/CLAUDE.md`, `.cursor/rules/**`, and `AGENTS.md` for agent workflow.
6. Historical plans, audits, and research as evidence, not current contracts.
7. Chat memory only as a temporary hint.

When this constitution conflicts with a domain SSOT on domain-specific behavior, update both deliberately or create an ADR. Do not let silent drift persist.

## 18. Decision Log

| Date | Decision |
|---|---|
| 2026-06-28 | Create one top-level constitution plus evidence map and ADR instead of importing the sample prompt as 29 disconnected Markdown files. |
| 2026-06-28 | Keep Next.js App Router + Supabase/PostgreSQL as the default architecture. Do not propose FastAPI split without future ADR. |
| 2026-06-28 | Define AI as draft/evidence/action-packet layer, not autonomous source of travel facts. |
| 2026-06-28 | Define MVP around inquiry, consultation, source-backed quote, follow-up, product/content knowledge, simple dashboard, and approval-gated AI. |
