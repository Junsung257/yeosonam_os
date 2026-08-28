# Codex Media Operations — Spec

Status: implemented locally on 2026-08-28; production migration and canary pending.

## Goal

Bring the useful parts of image generation into Yeosonam OS without installing a third-party runtime skill or using an image API key. Production publication remains server-driven and deterministic; a local signed-in Codex automation uses the ChatGPT subscription built-in ImageGen to upgrade durable queued assets behind Yeosonam's policy, persistence, QA, approval, and audit boundaries.

## Asset policy

| Class | Contract |
|---|---|
| `reality_required` | Supplier, official, or otherwise verified real image only. Generative calls fail closed. |
| `conceptual_allowed` | GPT image allowed with public disclosure. No factual product representation. |
| `deterministic_graphic` | Sharp/SVG-rendered information and CTA graphics. Model-generated text is prohibited. |

No customer photo, identity document, passport, payment data, or other PII may be placed in a media brief or provider prompt.

## `media-brief-v1`

The runtime brief is `MediaBriefV1` in `src/lib/media-generation/types.ts`.

Required identity and policy fields:

- version, tenant/owner identity, purpose, asset class;
- locale, subject/visual message, optional destination;
- factual constraints and forbidden representation boundary;
- style preset, aspect ratio, disclosure requirement.

The owner identity plus the normalized brief, snapshot/content context carried by the caller, purpose, and prompt version produce a SHA-256 idempotency key. Text, prices, dates, hotel names, and other exact labels are rendered by code, not by the image model.

## Asset manifest

`media_assets` stores:

- owner, purpose, class, source kind;
- provider, model, prompt version, brief digest, idempotency key;
- immutable Storage path, content hash, MIME, dimensions, variants;
- source metadata, QA report, usage and estimated cost;
- disclosure, review actor/note/time, status and replacement link.

The table is service-role only. Public pages receive content-hashed Storage URLs and the required disclosure, never direct ledger access.

## Surfaces

- Blog cover: deterministic brand image at publication, followed by one rollout-eligible asynchronous Codex conceptual upgrade.
- Blog inline: reviewed real images first, then deterministic summary/CTA cards.
- Homepage: only the latest approved `home_campaign_hero` is added to the hero carousel.
- Product detail: generated/code-rendered assets are excluded from `images_public`.
- Product card news: verified public snapshot images only.
- Informational card news: one GPT/brand master background; readable copy rendered by code.
- Social/OG: manual conceptual master plus normalized OG variant.

## Non-goals

- Installing `GENEXIS-AI/gpt-image-skill` or any global image skill.
- Calling the OpenAI Images API, imagegen CLI fallback, or using `OPENAI_API_KEY` for this media flow.
- Generating a hotel, room, meal, aircraft, attraction, or included activity.
- Treating local Codex availability as a prerequisite for publication.
- Adding a second agent/workflow runtime.
