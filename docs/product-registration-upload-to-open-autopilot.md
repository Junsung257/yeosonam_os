# Product Registration Upload-to-Open Autopilot

## Completion Standard

An upload is not complete when rows are saved. It is complete only when the customer `/packages/:id` mobile landing proof and the A4/source publish gates pass.

The upload-to-open autopilot must run after every successful upload or upload-review replay:

1. Resolve and promote safe unmatched itinerary entities.
2. Apply source-backed repairs for price dates, airline, inclusions, and excludes.
3. Re-run source verification.
4. Re-run actual customer mobile landing QA.
5. Check Product Registration V3 notice safety.
6. Check final customer delivery readiness.
7. Open only packages that pass every gate.

## Blocking Policy

The autopilot must not publish a product when any of these remain:

- source-vs-saved price/date/flight disagreement
- unresolved customer-visible attraction/entity blockers
- unsafe or missing V3 customer notice payload
- missing or stale actual `/packages` mobile browser proof
- render claim without source evidence
- known customer leak risk

## Photo Policy

Missing attraction photos are quality warnings when the attraction name and source-backed description are correct. Wrong or context-mismatched photos are blockers.

## Operational Entry Points

- Automatic after upload: `scheduleUploadToOpenAutopilot`
- Cron endpoint: `/api/cron/upload-to-open-autopilot`
- Manual production run: `npm run quality:upload-to-open`

Use small batches while Supabase is under pressure. The cron is resource-saver allowlisted, but it still defaults to a limited batch size.
