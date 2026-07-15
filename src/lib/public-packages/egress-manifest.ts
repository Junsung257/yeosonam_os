export type PublicEgressAudience = 'customer' | 'partner' | 'marketing' | 'internal';
export type PublicProjection = 'card' | 'detail' | 'public_api' | 'marketing' | 'partner' | 'none';

export type PublicEgressEntry = {
  file: string;
  audience: PublicEgressAudience;
  projection: PublicProjection;
  rawRead: 'forbidden' | 'selection_only' | 'internal';
  canExport: boolean;
  owner: string;
  lastVerifiedCommit: string;
  screenshotProof: string | null;
  expiresAt?: string;
};

export const PUBLIC_EGRESS_MANIFEST: PublicEgressEntry[] = [
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
  { file: 'src/lib/db/ads.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/marketing-pipeline/agents/ad-publish-agent.ts', audience: 'marketing', projection: 'marketing', rawRead: 'forbidden', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/marketing-pipeline/agents/ad-agent.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'ad-os', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/marketing-pipeline/agents/content-agent.ts', audience: 'marketing', projection: 'marketing', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/lib/blog-pillar-generator.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/blog/route.ts', audience: 'marketing', projection: 'card', rawRead: 'selection_only', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
  { file: 'src/app/api/products/stub/route.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'package-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/lib/jarvis/agents/products.ts', audience: 'internal', projection: 'none', rawRead: 'internal', canExport: false, owner: 'ai-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null, expiresAt: '2026-09-30' },
  { file: 'src/app/api/content-queue/route.ts', audience: 'marketing', projection: 'card', rawRead: 'forbidden', canExport: true, owner: 'content-platform', lastVerifiedCommit: 'ba690147', screenshotProof: null },
];
