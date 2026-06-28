# 99 Next Steps

Last updated: 2026-06-28
Status: Implementation handoff after `docs/yeosonam-os-constitution.md`

## 한글 요약

다음 구현은 큰 리뉴얼이 아니라 "문의가 들어오면 상담 의도와 상품 근거를 묶어 견적 초안과 팔로업 액션까지 이어지는" 얇은 세로 흐름이어야 한다. 이 흐름이 매일 쓰이면 그 다음에 대시보드, 콘텐츠, 광고, Jarvis 자동화 범위를 넓힌다.

## Recommended MVP Scope

Build the first daily-use Yeosonam OS around this sequence:

1. Inquiry inbox: landing leads, channel/referral context, chat session linkage, and idempotent booking-request creation.
2. Consultation timeline: notes, summaries, extracted preferences, customer facts, next question, and next action.
3. Source-backed quote draft: product eligibility, price/date evidence, comparison reasons, and human confirmation.
4. Follow-up action queue: quote follow-up, seat check, document request, unpaid balance, review request, and stale RFQ.
5. Product/content knowledge base: eligible packages, supplier/land operator facts, content briefs, and customer-safe fields.
6. Blog/Threads/card-news/ad-copy drafts: generated only from eligible products or clearly marked editorial briefs.
7. Simple dashboard: today actions, blocked products, overdue follow-ups, lead sources, quote status, and AI approval packets.
8. Jarvis packet layer: evidence, dry-run, risk, recommendation, rollback hint, and approval state.

## First Implementation Slice

The next coding run should not start with a large redesign. Start with a thin vertical slice:

```text
lead or consultation record
  -> extracted customer intent
  -> source-backed product candidates
  -> quote draft with reasons
  -> follow-up task
  -> dashboard card
```

Suggested first target:

- audit existing `/admin/leads`, `/admin/customers`, `/admin/bookings`, `/admin/jarvis`, and booking task surfaces;
- identify the smallest missing UI/API link for "inquiry -> consultation -> quote draft -> follow-up";
- implement only that link;
- add one durable test or verification command;
- update the matching domain SSOT only if behavior changes.

## Next Codex Prompt

```text
You are working on Yeosonam OS.

Read first:
- AGENTS.md
- docs/yeosonam-os-constitution.md
- docs/yeosonam-os-constitution-evidence-map.md
- docs/agent-workflow-current-ssot.md
- docs/ai-agent-doc-automation.md
- docs/ai-ops-current-ssot.md
- docs/product-registration-current-ssot.md

Goal:
Implement the first MVP sales-OS slice:
inquiry -> consultation intent -> source-backed quote draft -> follow-up action.

Rules:
- Do not build a generic CRM.
- Do not invent travel facts.
- Use existing Next.js App Router, src/lib services, Supabase/PostgreSQL, and current response/auth patterns.
- Respect customer/internal data separation.
- AI output must be a draft requiring human confirmation.
- Money, booking, PII, external publishing, credentials, and customer mutations need existing approval/evidence paths.
- Keep the change narrow and verify it.

Before coding:
1. Map existing lead, customer, booking, product, quote/recommendation, and booking_tasks code paths.
2. Identify the smallest missing link in the daily workflow.
3. State the out-of-scope boundaries.

After coding:
1. Run the narrowest tests/checks.
2. Run doc/workflow checks if docs changed.
3. If the work fixes a failure, add the guard that prevents recurrence or state why no guard is justified.
4. Report what changed, what evidence proves it, and what remains manual.
```

## Open Tradeoffs

| Tradeoff | Current decision |
|---|---|
| One constitution vs many files | One constitution plus evidence map. Avoid 29-file sprawl. |
| Next.js backend vs FastAPI split | Keep Next.js route handlers and `src/lib` services. Future split needs ADR. |
| AI autonomy vs approval | Drafts and decision packets now; high-risk mutations remain approval-gated. |
| CRM breadth vs sales workflow | Build the inquiry-to-booking workflow first. |
| Marketing automation vs live spend | Draft/stage/approve/confirm; no live spend autopilot before evidence gates. |
| Vector search vs source truth | Vector/RAG can retrieve context, but source-backed structured data remains truth. |
