# Jarvis RAG Audit Runbook

> Last updated: 2026-06-05

## Purpose

Jarvis answers are only as good as the knowledge chunks behind retrieval. This runbook defines the live audit loop for `jarvis_knowledge_chunks` so operators can detect stale, malformed, duplicated, or under-covered RAG data before it becomes a customer-facing answer quality issue.

## Commands

- Local check: `npm run audit:jarvis-rag`
- CI/ops gate: `npm run audit:jarvis-rag:ci`
- JSON output: `npm run audit:jarvis-rag -- --json`
- Narrow source check: `npm run audit:jarvis-rag -- --source=package`
- Reindex all sources: `node db/rag_reindex_all.js`

`audit:jarvis-rag` skips gracefully when Supabase env vars are missing. `audit:jarvis-rag:ci` requires DB access and fails when the audit is blocked or below the strict score threshold.

## Remediation Loop

Every audit summary includes `remediationActions`. Treat these as the operator queue for Jarvis knowledge quality:

1. Start with the lowest `priority` number.
2. Review the affected samples and source types.
3. Run the suggested audit command to narrow the source.
4. Fix adapter/content issues before reindexing when the finding is metadata or empty content.
5. Re-run `npm run audit:jarvis-rag` and keep the evidence with the release or incident notes.

The CLI prints the top remediation actions under `Next actions`. `/admin/jarvis` shows the same first actions in the RAG card.

For read-only automation, use `GET /api/admin/jarvis/remediation-plan`. It returns the current sampled audit, affected samples, and prioritized actions without running any reindex or delete operation.

## Status Rules

| Level | Meaning | Operator action |
|---|---|---|
| `ready` | Sampled chunks have acceptable quality and expected source coverage. | Keep weekly audit in the release checklist. |
| `watch` | No hard blocker, but coverage or quality drift exists. | Inspect samples, then reindex or fix the affected source. |
| `blocked` | Critical issues exist or score is too low. | Do not rely on Jarvis RAG answers until the source is fixed and re-audited. |

## Finding Playbook

| Finding | Likely cause | Fix |
|---|---|---|
| `empty_chunk_text` / `empty_contextual_text` | Broken source adapter or failed contextualization. | Fix adapter output, then reindex affected source. |
| `short_chunk_text` / `short_contextual_text` | Thin content or bad chunk split. | Improve source content, merge tiny chunks, or re-run contextualization. |
| `context_not_enriched` | Contextual retrieval prefix was not generated. | Check Gemini/OpenAI key, contextualizer errors, then reindex. |
| `missing_source_title` / `missing_source_ref` | Source adapter omitted citation metadata. | Patch adapter mapping so Jarvis can cite the source. |
| `duplicate_source_chunk` | Shared `tenant_id IS NULL` rows bypassed unique semantics. | Delete duplicates by `source_type/source_id/chunk_index`, then reindex. |
| `missing_expected_source` | Recent sample lacks `package`, `blog`, or `attraction`. | Run source-specific audit and reindex the missing source if count is actually low. |
| `stale_chunk` | Source has not been refreshed within the stale threshold. | Run incremental or full reindex for the stale source. |

## Admin Surface

`/admin/jarvis` shows the same audit summary returned by `/api/admin/jarvis/rag-status`:

- audit score
- readiness level
- sampled row count
- source counts
- top issue counts
- sample affected chunks

Use the UI as a triage view. Use the CLI for release gates and reproducible evidence.
