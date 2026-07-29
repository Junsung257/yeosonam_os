export type RevenueRescueCapabilityMode =
  | 'observe_only'
  | 'draft_only'
  | 'human_approval_required'
  | 'disabled'
  | 'enabled';

export const REVENUE_RESCUE_CAPABILITIES = {
  advertising: 'observe_only',
  content_generation: 'draft_only',
  public_publishing: 'human_approval_required',
  price_change: 'disabled',
  refund_settlement_payout: 'human_approval_required',
  agent_autonomous_write: 'disabled',
  reservation_lead_collection: 'enabled',
  audit_logging: 'enabled',
} as const satisfies Record<string, RevenueRescueCapabilityMode>;

const ENABLED_CRON_PATHS = new Set([
  '/api/cron/refresh-registration-mv',
  '/api/cron/booking-tasks-runner',
  '/api/cron/payment-stale-alert',
  '/api/cron/ledger-reconcile',
  '/api/cron/booking-attribution-audit',
  '/api/cron/snapshot-inventory',
  '/api/cron/sync-flight-availability',
  '/api/cron/affiliate-settlement-draft',
  '/api/cron/agent-housekeeping',
  '/api/cron/affiliate-anomaly-detect',
  '/api/cron/hard-block-alert',
  '/api/cron/magic-tokens-cleanup',
  '/api/cron/fraud-detect',
  '/api/cron/content-drift-detect',
  '/api/cron/meta-token-refresh',
]);

const DISABLED_CRON_PATHS = new Set([
  '/api/cron/meta-optimize',
  '/api/cron/post-travel',
  '/api/cron/post-travel-reels',
  '/api/cron/ad-optimizer',
  '/api/cron/ad-os-keyword-growth',
  '/api/cron/ad-os-safe-pipelines',
  '/api/cron/auto-archive',
  '/api/cron/unmatched-orchestrator',
  '/api/cron/legacy-sections-backfill',
  '/api/cron/fill-attraction-photos',
  '/api/cron/agent-executor',
  '/api/cron/embed-products',
  '/api/cron/blog-lifecycle',
  '/api/cron/blog-scheduler',
  '/api/cron/publish-scheduled',
  '/api/cron/auto-publish-loop',
  '/api/cron/blog-publisher',
  '/api/cron/blog-regenerate-zero-click',
  '/api/cron/dlq-replay',
  '/api/cron/variant-winner-decide',
  '/api/cron/free-travel-retarget',
  '/api/cron/concierge-cart-retarget',
  '/api/cron/dynamic-pricing',
  '/api/cron/weather-upsell',
  '/api/cron/band-rss',
  '/api/cron/solapi-review-request',
  '/api/cron/programmatic-seo-generator',
  '/api/cron/blog-orchestrator',
]);

export function getRevenueRescueCronMode(pathname: string): RevenueRescueCapabilityMode {
  if (DISABLED_CRON_PATHS.has(pathname)) return 'disabled';
  if (ENABLED_CRON_PATHS.has(pathname)) return 'enabled';
  if (pathname.startsWith('/api/cron/')) return 'observe_only';
  return 'enabled';
}

export function isRevenueRescueCronExecutionAllowed(pathname: string): boolean {
  return getRevenueRescueCronMode(pathname) !== 'disabled';
}
