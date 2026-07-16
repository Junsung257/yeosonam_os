export type PublicEgressAudience = 'customer' | 'partner' | 'marketing' | 'internal';
export type PublicProjection = 'card' | 'detail' | 'public_api' | 'marketing' | 'partner' | 'none';
export type PublicEgressClassification =
  | 'direct_external'
  | 'indirect_external'
  | 'internal_admin'
  | 'internal_analytics'
  | 'ingestion_or_audit';

export type PublicEgressEntry = {
  file: string;
  audience: PublicEgressAudience;
  projection: PublicProjection;
  rawRead: 'forbidden' | 'selection_only' | 'internal';
  canExport: boolean;
  classification?: PublicEgressClassification;
  owner: string;
  reason?: string;
  allowedFields?: string[];
  reviewBy?: string;
  lastVerifiedCommit: string;
  screenshotProof: string | null;
  expiresAt?: string;
};

const PUBLIC_EGRESS_REVIEW_BY = '2026-09-30';

export const SELECTION_ONLY_ALLOWED_FIELDS = [
  'travel_packages.id',
  'travel_packages.destination',
  'travel_packages.status',
  'travel_packages.publication_state',
  'travel_packages.published_snapshot_id',
  'travel_packages.created_at',
  'travel_packages.updated_at',
  'published_public_package_cards_v1.card_projection',
  'published_public_package_details_v1.detail_projection',
  'published_public_package_api_v1.public_api_projection',
  'published_public_package_marketing_v1.marketing_projection',
  'published_public_package_partner_v1.partner_projection',
  'published_public_packages_v1.snapshot_hash',
  'published_public_packages_v1.published_snapshot_id',
] as const;

const SELECTION_ONLY_REASON =
  'May use raw package rows only to choose candidate ids, rank/filter records, or join a promoted snapshot pointer; any customer/export copy must be rehydrated from an immutable public projection.';

function defaultClassification(entry: PublicEgressEntry): PublicEgressClassification {
  if (entry.classification) return entry.classification;
  if (!entry.canExport) return entry.audience === 'internal' ? 'internal_admin' : 'internal_analytics';
  if (entry.audience === 'customer' || entry.audience === 'partner') return 'direct_external';
  if (entry.audience === 'marketing') return 'indirect_external';
  return 'internal_admin';
}

function withManifestDefaults(entry: PublicEgressEntry): PublicEgressEntry {
  if (entry.rawRead !== 'selection_only') return entry;
  return {
    ...entry,
    classification: defaultClassification(entry),
    reason: entry.reason ?? SELECTION_ONLY_REASON,
    allowedFields: entry.allowedFields ?? [...SELECTION_ONLY_ALLOWED_FIELDS],
    reviewBy: entry.reviewBy ?? PUBLIC_EGRESS_REVIEW_BY,
  };
}

const PUBLIC_EGRESS_MANIFEST_ENTRIES: PublicEgressEntry[] = [
  { file: 'src/app/packages/[id]/page.tsx', audience: 'customer', projection: 'detail', rawRead: 'selection_only', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/load-lp-package.ts', audience: 'customer', projection: 'detail', rawRead: 'selection_only', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/itinerary/[id]/print/page.tsx', audience: 'customer', projection: 'detail', rawRead: 'forbidden', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/blog/[slug]/page.tsx', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/blog/BlogData.tsx', audience: 'customer', projection: 'none', rawRead: 'forbidden', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/destinations/[city]/page.tsx', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'destination-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/destinations/page.tsx', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'destination-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/destinations/region/[region]/page.tsx', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'destination-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/v1/packages/route.ts', audience: 'partner', projection: 'public_api', rawRead: 'selection_only', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/b2b/packages/route.ts', audience: 'partner', projection: 'partner', rawRead: 'forbidden', canExport: true, owner: 'partner-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/b2b/packages/[id]/route.ts', audience: 'partner', projection: 'partner', rawRead: 'forbidden', canExport: true, owner: 'partner-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/packages/[id]/terms/route.ts', audience: 'customer', projection: 'detail', rawRead: 'forbidden', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/packages/[id]/reviews/route.ts', audience: 'customer', projection: 'detail', rawRead: 'selection_only', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/influencer/assets/route.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'marketing-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/partner/packages/route.ts', audience: 'partner', projection: 'partner', rawRead: 'selection_only', canExport: true, owner: 'partner-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/partner/bookings/route.ts', audience: 'partner', projection: 'partner', rawRead: 'selection_only', canExport: true, owner: 'partner-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/meta/campaigns/[id]/route.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'marketing-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/jarvis/agents/concierge.ts', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ai-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/jarvis/agents/marketing.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'ai-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/qa-chat-packages.ts', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ai-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/scoring/recommend.ts', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'recommendation-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/user-actions.ts', audience: 'customer', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/content-public-package.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/campaign-public-packages.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'marketing-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/angle-matcher.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/pilot-setup/route.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/publish-drafts/route.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/seo-keyword-bridge/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/search-term-growth/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/publisher/naver/create-assets/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/creative-factory/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/creative-factory/asset-group/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/creative-factory/search-rsa/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/generate-candidates/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/keyword-brain/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/ops-plan/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/admin/ad-os/expiry-cleanup/route.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/app/api/admin/ad-os/optimizer/portfolio-plan/route.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/app/api/admin/ad-os/summary/route.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/lib/db/ads.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/marketing-pipeline/agents/ad-publish-agent.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/marketing-pipeline/agents/ad-agent.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/marketing-pipeline/agents/content-agent.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/blog-pillar-generator.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/blog/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/content-gaps/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/content-hub/route.ts', audience: 'marketing', projection: 'card', rawRead: 'forbidden', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/content-hub/publish/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/cron/card-news-seasonal/route.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/cron/trend-topic-miner/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/cron/threads-trend-miner/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/cron/blog-publisher/route.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/content-analytics/route.ts', audience: 'internal', projection: 'marketing', rawRead: 'forbidden', canExport: false, classification: 'internal_analytics', owner: 'content-platform', reason: 'Internal reporting API may show only blog metrics plus public package projection labels; it must not feed external copy generation.', allowedFields: ['content_creatives.id', 'slug', 'seo_title', 'angle_type', 'product_id', 'published_at', 'published_public_package_marketing_v1.marketing_projection'], reviewBy: '2026-09-30', lastVerifiedCommit: '170dd1b4', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/app/api/cron/blog-regenerate-zero-click/route.ts', audience: 'marketing', projection: 'none', rawRead: 'forbidden', canExport: true, classification: 'indirect_external', owner: 'content-platform', reason: 'Zero-click regeneration handles destination-only info posts and must not join raw package copy.', allowedFields: ['content_creatives.id', 'slug', 'seo_title', 'seo_description', 'blog_html', 'destination', 'angle_type', 'product_id'], reviewBy: '2026-09-30', lastVerifiedCommit: '170dd1b4', screenshotProof: null },
  { file: 'src/app/api/cron/blog-lifecycle/route.ts', audience: 'marketing', projection: 'public_api', rawRead: 'forbidden', canExport: true, classification: 'indirect_external', owner: 'content-platform', reason: 'Product-backed blog lifecycle decisions must use published public snapshot projections, never raw travel_packages fields.', allowedFields: ['content_creatives.id', 'slug', 'product_id', 'published_public_package_api_v1.public_api_projection'], reviewBy: '2026-09-30', lastVerifiedCommit: '170dd1b4', screenshotProof: null },
  { file: 'src/lib/social-publishing/distribution-publisher.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, classification: 'direct_external', owner: 'social-publishing', reason: 'Social/blog distribution is an external publisher and must require current marketing projection snapshot id/hash before publishing product-backed content.', allowedFields: ['content_creatives.id', 'slug', 'status', 'blog_html', 'seo_title', 'seo_description', 'destination', 'angle_type', 'product_id', 'source_snapshot_id', 'source_snapshot_hash', 'marketing_projection_version', 'published_public_package_marketing_v1.marketing_projection'], reviewBy: '2026-09-30', lastVerifiedCommit: '170dd1b4', screenshotProof: null },
  { file: 'src/app/admin/blog/BlogDataFetcher.tsx', audience: 'internal', projection: 'marketing', rawRead: 'forbidden', canExport: false, classification: 'internal_admin', owner: 'content-platform', reason: 'Admin blog list may inspect internal blog rows, but customer preview labels must come from public package projections.', allowedFields: ['content_creatives.id', 'slug', 'seo_title', 'status', 'category', 'published_at', 'created_at', 'view_count', 'topic_source', 'product_id', 'published_public_package_marketing_v1.marketing_projection'], reviewBy: '2026-09-30', lastVerifiedCommit: '170dd1b4', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/app/api/products/stub/route.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/lib/jarvis/agents/products.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'ai-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/app/api/content-queue/route.ts', audience: 'marketing', projection: 'card', rawRead: 'forbidden', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
];

export const PUBLIC_EGRESS_MANIFEST: PublicEgressEntry[] =
  PUBLIC_EGRESS_MANIFEST_ENTRIES.map(withManifestDefaults);
