# Yeosonam OS Constitution Evidence Map

Last updated: 2026-06-28
Status: Accepted companion to `docs/yeosonam-os-constitution.md`

This file maps constitution claims to local repo evidence and external research. It prevents the constitution from becoming opinion-only.

## 한글 요약

이 근거 맵의 목적은 헌법이 "좋아 보이는 말"로 끝나지 않게 하는 것이다. 각 조항은 실제 코드, 마이그레이션, 현재 SSOT, 외부 여행업 소프트웨어 리서치 중 하나 이상에 연결되어야 한다.

판단 기준은 단순하다.

- 기존 문서는 존중하지만, 날짜가 오래되었거나 코드와 다르면 그대로 따르지 않는다.
- 외부 제품은 참고만 한다. 여소남의 실제 업무 흐름과 레포 근거가 우선이다.
- AI 기능은 매출, 상담, 견적, 예약, 정산, 콘텐츠 운영 중 하나에 매일 쓰일 때만 MVP 가치가 있다.

## Source Rule

- Local implementation and migrations prove what already exists.
- Current domain SSOT files prove current operating contracts.
- External products show market patterns and gaps, not Yeosonam requirements by themselves.
- Historical docs and audits are evidence, not current playbooks.

## Local Evidence Matrix

| Constitution claim | Local evidence | Interpretation |
|---|---|---|
| Yeosonam OS is B2B2C, not a simple agency site | `AGENTS.md`, `CURRENT_STATUS.md`, `/admin/tenants`, affiliate docs, settlement docs | Product must support land operator, platform, partner/tenant, affiliate, and customer roles. |
| Inquiry must connect to booking request | `src/app/api/leads/route.ts`, `src/lib/lead-booking-request.ts` | Lead capture already creates idempotent booking requests and links conversations/customer facts when possible. |
| Action queue beats passive dashboard | `supabase/migrations/20260427000000_booking_tasks_inbox.sql` | Booking tasks encode open/snoozed/resolved/auto_resolved/superseded states and health views. |
| Consultation memory is core | `supabase/migrations/20260414120000_add_customer_facts.sql` | Customer facts store reusable preferences, constraints, and history with tenant/customer/conversation scope. |
| AI learning must be PII-aware | `supabase/migrations/20260502160000_platform_learning_events.sql`, `docs/platform-ai-roadmap.md` | Learning events store message hashes and structured payloads by default, separating platform learning from raw PII. |
| Product source truth controls public eligibility | `docs/product-registration-current-ssot.md`, `db/FIELD_POLICY.md` | Upload/product engine requires source evidence, customer render proof, and customer/internal field separation. |
| Strong guard systems are references, not universal playbooks | `docs/product-registration-current-ssot.md`, `docs/blog-autopublish-contract.md` | 상품등록 참고 and 블로그 참고 mean reuse the pattern of evidence -> guard -> verification, not their exact mechanics. |
| Recommendations should explain reasons, not fake certainty | `docs/recommendation-comparison-v1-plan.md` | V1 strategy is package comparison and "least regret" recommendation, not OTA-style unlimited planning. |
| Affiliate attribution and payout are separate | `docs/affiliate-current-ssot.md`, `docs/settlement-current-ssot.md` | Referral capture is evidence; payable commission requires booking/payment/settlement state. |
| Ledger is finance truth | `docs/settlement-current-ssot.md` | Payments, refunds, settlements, reversals, and adjustments must create or reference ledger evidence. |
| Marketing must stage before external write | `docs/marketing-current-ssot.md`, `docs/specs/20260628-marketing-ad-os-95/spec.md` | Generated, staged, approved, externally applied, and confirmed states must stay separate. |
| Jarvis must prepare decision packets, not free-run risky mutations | `docs/ai-ops-current-ssot.md`, `docs/jarvis-orchestration.md`, `docs/specs/20260628-jarvis-autopilot-95/spec.md` | HITL is mandatory for money/bookings/customer/external/credential/privacy mutations. |
| Private group travel and re-quote loops matter | `docs/private-tour-ecosystem-plan.md`, `supabase/migrations/20260526141400_private_tour_share_passport.sql` | RFQ share token, reactions, and travel history/passport already point toward group decision and repeat marketing loops. |
| Documentation must avoid plan sprawl | `docs/ai-agent-doc-automation.md`, `docs/agent-workflow-current-ssot.md` | New durable docs are allowed only when they clarify current rules, evidence, or Tier 2/3 contracts. |
| `CURRENT_STATUS.md` is useful but dated | `CURRENT_STATUS.md`, `package.json` | `CURRENT_STATUS.md` is a 2026-05-28 operating snapshot; actual manifest currently shows Node 24.x, Next 15.5.18, React 19.2.6, Supabase JS 2.106.2. |

## External Research Matrix

| Market evidence | Source | What it does well | What Yeosonam should learn | What Yeosonam should not copy blindly |
|---|---|---|---|---|
| Travel advisor all-in-one platforms combine CRM, itineraries, and payments | [TravelJoy](https://traveljoy.com/) | Advisor workflow consolidation | Inquiry, client, itinerary/quote, and payment context should be connected | Do not become a US-style advisor CRM that ignores Korean Naver/Kakao/supplier workflows |
| Proposal/itinerary/client management reduces tab switching | [Travefy](https://travefy.com/), [Travefy proposal tool](https://travefy.com/products/proposal) | Polished proposals and comparison links | Quote drafts should be shareable, comparison-oriented, and client-readable | Do not prioritize visual proposal polish before source-backed travel facts |
| Tour operator tools connect itinerary, pricing, supplier, CRM, operations, and reporting | [Tourwriter](https://www.tourwriter.com/), [Tourwriter plans](https://www.tourwriter.com/software-pricing-plans/) | Itinerary/pricing/supplier workflow | Supplier rates and quote creation need one workflow | Do not import enterprise implementation complexity before Yeosonam daily MVP |
| Larger tour operator systems automate suppliers, partners, travelers, reservations, and finances | [Lemax](https://lemax.net/), [Lemax reservation system](https://lemax.net/reservation-system/), [Lemax travel products](https://lemax.net/travel-products/) | Full sales/booking/operations coverage | B2B/B2C/partner boundaries are valid for a travel operating system | Do not clone a mid/large enterprise ERP before proving small-agency daily flow |
| Korean travel ERP centers on 상담, 예약, 수배, 결산, 회계, CRM, CEM, 여행정보 | [Avatar ERP](https://avatarsystem.co.kr/page/erp-land.php), [GTN ERP article](https://www.gtn.co.kr/mobile/news_view.asp?news_seq=71848) | Real Korean travel-office vocabulary and workflow | Yeosonam workflow must include 상담-예약-수배-확정-송출-결산 | Do not stop at ERP; Yeosonam needs AI, content, affiliate, and platform learning loops |
| Korean ERP vendors emphasize 상담, 견적, 예약, 문서, 발송, 정산 in one screen | [Nestro ERP](https://www.nestro.co.kr/) | Small/medium agency operational data centralization | Inquiry through settlement is the correct operational span | Do not treat homepage/app marketing as a substitute for internal operating data |
| KakaoTalk Channel is a real Korean consultation and messaging surface | [KakaoTalk Channel](https://business.kakao.com/info/kakaotalkchannel/) | 1:1 chat and channel home behavior | Kakao-origin inquiries and follow-ups should be first-class later | Do not hard-code Kakao as the only channel |
| Naver Search Advisor supports search diagnosis and index/search-friendly site management | [Naver Search Advisor](https://searchadvisor.naver.com/), [Naver webmaster guide](https://searchadvisor.naver.com/guide) | Korean search visibility operations | Blog/landing pages need indexability and quality proof | Do not treat generated blog text as marketing success without search/index evidence |
| Naver Search Ads exposes keyword-based paid acquisition with budget, CPC, and reporting | [Naver Search Ads](https://ads.naver.com/sa), [Naver Ads](https://ads.naver.com/) | Paid search acquisition and measurement | Ad OS should model budget, keyword, report, and approval states | Do not let AI mutate live ad spend without approval and provider confirmation |

## Product Gap Analysis

Existing travel CRMs and tour-operator tools do useful things: client management, proposals, itineraries, pricing, reservations, payments, supplier workflows, and reporting. Korean ERP tools correctly reflect the domestic operational chain: 상담, 예약, 수배, 송출, 결산, 회계.

Yeosonam OS should exist because it combines these into a Korean, AI-assisted, evidence-backed operating loop:

- Naver/Kakao/social/ad lead generation;
- source-backed package and land-operator products;
- consultation memory;
- quote/recommendation/RFQ workflows;
- affiliate and tenant attribution;
- booking task queue;
- ledger/settlement truth;
- blog/Threads/card-news/ad drafts;
- Jarvis decision packets and HITL boundaries;
- future YIOS/MCP/tool readiness.

The key missing category in generic tools is not "AI text generation." The missing category is a source-backed sales operating system where content, consultation, quote, booking, payment, settlement, and marketing are connected by evidence and approval gates.

## Pattern Reference Boundary

Product registration and blog automation are the strongest current guard examples, but they are not copy-paste standards. Each domain should choose its own minimum guard:

| Domain | Evidence | Guard |
|---|---|---|
| Product registration | supplier source, source spans, render proof | fixture/eval, customer-open contract, mobile proof |
| Blog | content brief, rendered page, image/SEO/indexing evidence | editorial/render/SEO/indexing gates |
| Settlement | ledger entries, allocations, reconciliation status | idempotent ledger path, reversal proof, drift block |
| Affiliate | referral touchpoints, booking snapshot, settlement state | attribution snapshot, payout eligibility boundary |
| Marketing | product eligibility, provider result, budget state | draft/stage/approve/confirmed boundary |
| Jarvis/AI | prompt/version, trace, decision packet, eval result | HITL, scoped tools, eval/readiness gate |
| Consultation/CRM | consent, customer facts, tenant/customer scope | PII guard, customer fact audit, scope check |

## MVP Evidence Checklist

Before building or expanding an MVP feature, answer:

| Question | Evidence needed |
|---|---|
| Does this help the daily inquiry-to-booking workflow? | User journey, route/service path, or action queue item |
| If this fixes a failure, what prevents recurrence? | Domain-specific guard: fixture, regression test, eval, deterministic gate, error-registry entry, SSOT rule, readiness check, or explicit no-guard rationale |
| Is customer-facing travel information source-backed? | Product source hash, supplier data, eligibility proof, or explicit manual-review state |
| Is AI output a draft or an approved fact? | Approval state, schema validation, eval, or domain gate |
| Does it reduce manual duplicate entry? | Existing data reuse or one-write/many-read flow |
| Does it affect money, booking, PII, external publishing, or credentials? | HITL, ledger/evidence, and audit trail |
| Does it help revenue? | Lead, conversion, follow-up, quote speed, product readiness, or marketing metric |
| Is it better than current docs, not merely consistent with them? | Code/migration/package evidence checked against dated docs |
