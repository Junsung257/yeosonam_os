# Upload Function Timeout Queue-First Audit

Date: 2026-06-24

## Incident

Admin upload for a long multi-product source failed with Vercel `FUNCTION_INVOCATION_TIMEOUT` before the browser received a durable registration result.

The affected source was expected to produce six product variants, but a prior timeout replay row only preserved a truncated source excerpt. That meant the replay path could not recover the missing final variant without the full original source being uploaded again.

## Root Cause

The `/api/upload` request attempted to run the full registration pipeline inside the browser request until a late soft timeout. Heavy direct-text uploads could reach platform timeout before the route returned a queued replay response.

Two safeguards were missing:

- long or multi-product direct text should enter replay before running the full pipeline in the request
- replay queue insertion should have its own short timeout so a slow Supabase write cannot consume the whole request window

## Fix

The upload route now uses a queue-first path for heavy direct text:

- raw text length at or above `UPLOAD_QUEUE_FIRST_TEXT_LENGTH`
- or at least four likely `PKG` product sections

Those requests return `UPLOAD_DEFERRED_FOR_REPLAY` with HTTP 202 after saving the full replay source. Normal smaller uploads still run inline, but the route now uses a shorter soft timeout and the same replay deferral helper if the pipeline is slow.

The replay queue now records `UPLOAD_PIPELINE_DEFERRED_FOR_REPLAY` as a recoverable reason, bounds Supabase insert time, and wakes the replay cron immediately.

## Verification

- `npx vitest run src/lib/product-registration/upload-route-boundary.test.ts src/lib/product-registration/upload-timeout-replay-queue.test.ts src/lib/product-registration/upload-review-regression-verifier.test.ts src/lib/product-registration/failure-diagnostics.test.ts`
- `npm run type-check`
- `npm run check:doc-automation:ci`
- `git diff --check`

## Operating Note

For already-failed uploads whose replay row was created before the long-source preservation fix, the saved queue row may still be truncated. Re-upload the original full source after this deployment so the queue-first path can save the complete replay source and split all variants.

## Follow-Up: Mobile Final Arrival QA False Positive

The replayed Guilin source confirmed the queue-first fix: the full 15,046-character source was preserved and six product variants were created.

The remaining blocker was not catalog splitting. `auto_mobile_qa` blocked all six rows with `mobile_final_arrival_rendered_as_departure`, while the stored itinerary already had the correct final flight sequence: Guilin departure followed by Busan Gimhae arrival.

Root cause: the QA rule used the first `DAY N` marker in rendered text. On the customer package page, day navigation and flight-summary text can appear before the actual final-day itinerary body, so the QA window could include an earlier home-departure phrase and falsely mark the final arrival as a departure.

Fix: final-day QA now uses the last `DAY N` marker to prefer the itinerary body, and the regression covers a page where an earlier navigation window contains `Busan Gimhae departure` while the actual final day correctly renders `Busan Gimhae arrival`.
