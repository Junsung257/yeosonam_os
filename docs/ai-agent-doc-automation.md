# AI Agent Documentation Automation

Last updated: 2026-06-23

This is the operating system for keeping Yeosonam OS documentation current without asking the user to separately organize documents later.

## Goal

Every meaningful improvement should leave behind one of these artifacts automatically:

- a stricter fixture or test,
- a clearer SSOT rule,
- a repeated-mistake entry in `db/error-registry.md`,
- a short audit note when evidence matters,
- or no document change when the change is too small and already covered.

The user should not need to remember which document to update.

## Non-Negotiable Rule

Do not create a new plan document by default.

First choose the smallest durable artifact:

```text
new behavior or invariant -> current domain SSOT
repeated mistake -> db/error-registry.md
new failed supplier sample -> fixture/golden corpus
completed investigation -> docs/audits/YYYY-MM-DD-*.md
temporary note -> no docs; final answer only
```

## Document Hierarchy

Always-loaded entry files stay short:

- `AGENTS.md`: routing table and shortest global rules.
- `.claude/CLAUDE.md`: deeper harness rules and domain entry points.

Domain SSOT files define current behavior:

- `docs/product-registration-current-ssot.md`: supplier upload, mobile landing, A4 readiness.
- `docs/product-registration-v3-standard-language.md`: customer-safe notice language.
- `docs/blog-autopublish-contract.md`: blog generation, publish quality, images, SEO, indexing.
- `docs/affiliate-current-ssot.md`: affiliate attribution, referral cookies, partner evidence, commission boundary.
- `docs/settlement-current-ssot.md`: payments, ledger, settlement, payout, reconciliation.
- `docs/marketing-current-ssot.md`: marketing automation, Ad OS, external publish boundary.
- `docs/ai-ops-current-ssot.md`: AI provider policy, Jarvis, RAG, prompt/eval boundary.
- `db/FIELD_POLICY.md`: customer/internal field exposure.

History and evidence files are not current playbooks:

- `docs/audits/*`: investigation evidence. Use `docs/audits/README.md` as the archive index.
- `docs/register-changelog.md`: decision history.
- `docs/registration-improvement-plan.md`: historical planning.

When searching for current rules, exclude audit history first:

```bash
rg "keyword" docs AGENTS.md .claude --glob "!docs/audits/**"
```

## Automatic Doc Decision Matrix

| Change type | Required durable artifact |
|---|---|
| New product-registration parser behavior | golden fixture and expected JSON |
| New price-table shape | price IR parser test and golden corpus if supplier raw failed |
| New blog generation, prompt, render, publish, indexing, image, SEO, or quality-gate behavior | blog regression test plus `docs/blog-autopublish-contract.md` or `docs/errors/blog.md` update |
| New affiliate attribution, referral, influencer, or commission behavior | test plus `docs/affiliate-current-ssot.md` or `docs/errors/affiliate.md` update |
| New payment, ledger, settlement, payout, or reconciliation behavior | test plus `docs/settlement-current-ssot.md` or `docs/errors/settlement.md` update |
| New marketing automation, Ad OS, external publish, campaign action, or spend behavior | test plus `docs/marketing-current-ssot.md` or `docs/errors/marketing.md` update |
| New AI provider, Jarvis, RAG, prompt, eval, or learning-loop behavior | eval/test plus `docs/ai-ops-current-ssot.md` or `docs/errors/ai-ops.md` update |
| New customer-visible rule | current domain SSOT |
| Repeated operational mistake | `db/error-registry.md` ACTIVE CHECKLIST + full entry |
| Route/pipeline architecture change | current domain SSOT and boundary test |
| Render contract change | current domain SSOT and customer render tests |
| DB schema/guard change | migration + domain SSOT if behavior changes |
| One-off investigation | `docs/audits/YYYY-MM-DD-short-title.md` plus one index row in `docs/audits/README.md` |
| Manual legacy workaround | final answer only unless it becomes repeatable |

## Product Registration Specific Flow

For supplier upload registration:

```text
source failure
  -> add full raw fixture
  -> define expected customer outcome
  -> update parser/IR or registration object
  -> run recovery and deliverability tests
  -> update SSOT only if the invariant changed
  -> update error registry only if this was a repeated mistake
```

Never make the document the only fix. The document records the fix; the fixture/test prevents regression.

## Blog Automation Specific Flow

For blog generation, publishing, rendering, images, SEO, or indexing:

```text
source failure
  -> identify whether it is prompt, queue, repair, gate, render, image, SEO, indexing, or cron policy
  -> add a deterministic ERR-BLOG regression case when feasible
  -> update `docs/errors/blog.md` for repeated failures
  -> update `docs/blog-autopublish-contract.md` or the active blog runbook if the invariant changed
  -> run the narrow unit/regression test and the relevant blog audit command
  -> deploy only after the live path and document contract agree
```

Do not call a blog fix complete from a repaired DB row or a one-time manual publish. Completion requires the live publisher, shared publish helper, quality gates, rendered public page, and indexing outbox to enforce the same rule.

## Prompt/Harness Best Practices

Use stable, cacheable context:

- Put stable project rules first.
- Put volatile user input last.
- Keep always-loaded memory short.
- Link to SSOT instead of copying long rules everywhere.

Use structured outputs for extraction:

- Prefer schema-adherent objects over loose JSON.
- Validate model output with local types before persistence.
- Store failure causes as structured codes, not prose-only messages.

Use evals and traces:

- Every previous failure becomes a reproducible dataset item when feasible.
- Trace/audit logs are evidence; a convincing chat answer is not evidence.
- Customer deliverability is judged by rendered payload readiness, not parser confidence.

Use MCP/app tools carefully:

- Tools should expose narrow, typed operations.
- Resources/prompts can provide stable context, but must not silently override repo SSOT.
- Sensitive credentials or payment data must not be collected through generic in-chat forms.

## 100-Point Documentation Rubric

| Area | Points | Passing standard |
|---|---:|---|
| One current SSOT per domain | 20 | Any agent can identify the active rule document in under 30 seconds. |
| No stale-doc ambiguity | 15 | Historical docs are labeled historical or superseded. |
| Mistakes become guards | 20 | Repeated failures enter tests, fixtures, or error registry. |
| Customer safety | 15 | Customer-visible rules distinguish evidence, fallback, manual approval, and internal-only data. |
| Automation fit | 10 | Prompt/cache/eval/structured-output practices are encoded in repo rules. |
| Minimality | 10 | New docs are rare; existing SSOT is updated first. |
| Verification | 10 | Required commands and live audits are stated next to the contract. |

Target: 95+ before calling a domain "documented well enough".

## Agent Closeout Contract

At the end of meaningful work, the agent should report:

- what changed,
- what durable artifact captured it,
- what verification ran,
- what remains manual or intentionally deferred.

If no document was updated, say why: already covered, no behavior change, or temporary investigation.

## External Basis Checked

- [OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching): stable prompt prefixes and repeated static context improve cache reuse.
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs): schema-adherent model outputs are preferable to loose JSON when possible.
- [OpenAI Agent Evals](https://platform.openai.com/docs/guides/agent-evals): reproducible evals and trace grading are the right loop for agent reliability.
- [OpenAI Prompting](https://platform.openai.com/docs/guides/prompting): long-lived, versioned prompts and templates help teams reuse and test prompts.
- [Anthropic Claude Code memory](https://docs.anthropic.com/en/docs/claude-code/memory): project memory should be structured, specific, and periodically reviewed.
- [Model Context Protocol concepts](https://modelcontextprotocol.io/docs/concepts): tools, resources, prompts, and elicitation should be explicit, typed, and user-controlled.
