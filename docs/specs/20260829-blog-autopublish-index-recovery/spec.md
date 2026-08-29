# Blog Autopublish And Index Recovery Spec

Date: 2026-08-29
Owner: Blog operations
Risk tier: Tier 3 (external publishing and search-engine submission)

## Objective

Restore the existing V4 blog pipeline from its intentional safe stop, publish one fully gated production canary per KST day, and make Google/Naver indexing evidence accurate and actionable.

## In scope

- Correct Google URL Inspection classification so negative Korean coverage states are never counted as indexed.
- Use the shared visibility classifier in both GSC ingestion and the daily summary.
- Enforce the current Naver IndexNow key format and replace the invalid production key.
- Enable scheduled generation and live publication with a one-post daily ceiling, `pilot_3` rollout ceiling, and automatic ramp disabled.
- Publish one production canary only through the existing quality-gated generation and publication controller.
- Drain its indexing outbox, submit the sitemap to Google Search Console, and submit the URL to Naver/global IndexNow.
- Verify the public article, canonical/indexability, media fallback or generated cover queue, and stored visibility evidence.

## Out of scope

- Merging the broad autonomous V4 pull request.
- Using Google Indexing API for ordinary blog articles; Google documents it for JobPosting and BroadcastEvent pages only.
- Claiming that a submission guarantees immediate Google or Naver indexing.
- Raising the public ceiling above one post per day during this recovery.

## Acceptance criteria

1. `NEUTRAL` plus `발견됨 - 현재 색인이 생성되지 않음` is stored and summarized as `not_indexed`.
2. A `PASS` verdict paired with a negative Korean coverage phrase is also fail-closed as `not_indexed`.
3. Production policy is `live`, generation cron is enabled, daily public cap is `1`, rollout ceiling is `pilot_3`, and automatic ramp remains disabled.
4. The IndexNow verification URL returns HTTP 200 with the exact configured key, while an unrelated `.txt` path remains 404.
5. One approved generation run is published atomically; if any quality or safety gate fails, no public row is forced through.
6. The published URL returns 200, has a self-canonical URL, is index/follow eligible, and appears in the sitemap.
7. The indexing outbox records Google sitemap submission and successful Naver/global IndexNow provider evidence, or a concrete retryable provider failure.
8. Google URL Inspection is rerun and reported using its actual verdict/coverage state without promising immediate index inclusion.

## Rollback

- Set `BLOG_AUTOPUBLISH_MODE=draft_only`.
- Set `BLOG_GENERATION_CRON_ENABLED=0`.
- Leave generated drafts, publication evidence, and indexing evidence intact for audit.
