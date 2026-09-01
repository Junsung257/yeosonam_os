---
name: yeosonam-seo-brief
description: Build or review a source-bounded Korean Yeosonam `/blog` content brief from a topic, demand signal, existing posts, and approved evidence. Use for search intent, reader questions, required facts, outline, entities, internal-link candidates, and unique-angle decisions before drafting. Do not use for writing or publishing the final article.
---

# Yeosonam SEO Brief

Produce a brief that the DeepSeek writer can execute without inventing facts.

## Required inputs

- Topic, locale, destination, intent, and channel.
- A verified demand signal from GSC, Naver, a customer question, active product, editor seed, or operator note.
- Approved source snapshots and claims. Missing evidence remains a gap; never fill it from memory.
- Existing representatives and keyword-family members for duplicate and cannibalization checks.

## Output contract

Return a structured brief containing `intent`, `reader_questions`, `required_facts`, `required_decisions`, `outline`, `entities`, `primary_sources`, `internal_link_candidates`, `avoid_topics`, `unique_angle`, `keyword_family_key`, and `evidence_gaps`.

Prefer answer-first structure and the minimum length needed to resolve the reader task. Do not impose keyword density, fixed word count, or fixed heading count. A candidate cannot become `ready` until the brief and source bundle are durably stored.

## Boundaries

- Follow `docs/blog-autopublish-contract.md` and `docs/blog-ops-runbook.md`.
- Product price, dates, hotel, flight, visa, and contractual facts come only from their canonical source.
- Do not call a model, mutate a queue, publish, or submit a URL unless the user separately requests that action.
