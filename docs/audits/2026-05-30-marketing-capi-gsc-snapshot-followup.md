# Marketing Follow-up: CAPI, GSC Health, Asset Snapshots

Date: 2026-05-30

## Why Meta MCP is not enough

Meta MCP, when available, is useful for operator-side inspection and management: accounts, campaigns, diagnostics, or recommendations. Meta Conversions API is different. CAPI is production application code that receives user events from Yeosonam, attaches consent/cookies/session/user-agent/IP context, hashes user data when provided, and sends the event to Meta with the same `event_id` used by the browser Pixel for deduplication.

In short:

- MCP = workbench/control-plane connector.
- CAPI = live conversion telemetry inside the product.

## Implemented

- Added `meta_conversion_events` migration for server-side conversion event logs.
- Added `src/lib/meta-conversions.ts` for Meta CAPI payload creation, SHA-256 PII hashing, consent-aware send/skip, and DB logging.
- Added `POST /api/tracking/meta-conversion`.
- Rewired `MetaPixel.tsx` so `ViewContent`, `Lead`, and `Purchase` create a shared `event_id`, send browser Pixel with `eventID`, and send server CAPI through `/api/tracking/meta-conversion`.
- Switched Meta Pixel gating to marketing consent instead of generic analytics consent.
- Restricted Meta Pixel/CAPI browser triggers to `yeosonam.com`, `www.yeosonam.com`, and localhost by default so Vercel preview domains do not pollute Meta diagnostics.
- Added GSC page-level health into `MarketingAssetGroup.stages.indexing`.
- Added weak-GSC-signal Next Best Action when a published blog has low/missing Search Console signal.
- Added `marketing_asset_group_snapshots` migration.
- Added `captureMarketingAssetGroupSnapshots(...)` and `/api/cron/marketing-asset-snapshot`.
- Added `GET /api/admin/marketing/snapshots` for recent readiness/GSC/action trend summaries.
- Added a 14-day Automation Trend section to the Marketing Command Center.
- Scheduled the snapshot cron in `vercel.json` at `50 2 * * *`.

## Supabase Activation

Applied to the active Supabase project `Yeosonam_OS` (`ixaxnvbmhzjvupissmly`) on 2026-05-30 via Supabase MCP SQL execution, then recorded in `supabase_migrations.schema_migrations`:

- `20260530090000_marketing_recommendations_ledger.sql`
- `20260530091000_marketing_capi_and_asset_snapshots.sql`

Verification:

- Tables exist with RLS enabled and service-role-only policies.
- Rollback insert smoke passed for recommendations, CAPI events, and asset snapshots.
- Function-level CAPI smoke logged a consent-missing event into `meta_conversion_events`.
- Function-level snapshot smoke inserted 3 rows into `marketing_asset_group_snapshots`.
- Migration files were made re-run safe with `DROP POLICY IF EXISTS`.

## Env Required for Live Meta CAPI

- `NEXT_PUBLIC_META_PIXEL_ID`
- `META_CAPI_ACCESS_TOKEN` or `META_ACCESS_TOKEN` or `META_ADS_ACCESS_TOKEN`
- Optional `META_PIXEL_ID` when the server Pixel ID should differ from the public Pixel ID
- Optional `META_GRAPH_API_VERSION` when overriding the default Graph API version
- Optional `NEXT_PUBLIC_META_PIXEL_ALLOW_PREVIEW=1` only when intentionally testing Meta Pixel/CAPI from preview deployments

## Env Required for GSC Health

- `GSC_SITE_URL`
- `GSC_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_JSON`
- Search Console Owner permission for the service account
