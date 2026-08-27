export interface PublicCatalogEgressSurface {
  id: string;
  source: string;
  requiredMarker: 'listPublicCatalog' | 'getPublicCatalogDetail' | 'public_catalog_view';
  purpose: 'discovery' | 'detail' | 'recommendation' | 'marketing' | 'customer-ai' | 'seo';
}

/**
 * Customer-channel egress manifest. Adding a new proactive product surface
 * requires registering it here and proving it consumes the exact catalog.
 * B2B and partner channels intentionally use their own exact channel pointers.
 */
export const PUBLIC_CATALOG_EGRESS_SURFACES: readonly PublicCatalogEgressSurface[] = [
  { id: 'home', source: 'src/app/page.tsx', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'package-list', source: 'src/app/packages/page.tsx', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'package-search-api', source: 'src/app/api/packages/search/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'legacy-package-api', source: 'src/app/api/packages/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'external-package-api', source: 'src/app/api/v1/packages/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'package-detail', source: 'src/app/packages/[id]/page.tsx', requiredMarker: 'getPublicCatalogDetail', purpose: 'detail' },
  { id: 'package-metadata', source: 'src/app/packages/[id]/layout.tsx', requiredMarker: 'getPublicCatalogDetail', purpose: 'seo' },
  { id: 'package-landing', source: 'src/lib/load-lp-package.ts', requiredMarker: 'getPublicCatalogDetail', purpose: 'detail' },
  { id: 'package-print', source: 'src/app/itinerary/[id]/print/page.tsx', requiredMarker: 'getPublicCatalogDetail', purpose: 'detail' },
  { id: 'package-reviews', source: 'src/app/api/packages/[id]/reviews/route.ts', requiredMarker: 'getPublicCatalogDetail', purpose: 'detail' },
  { id: 'destination-detail', source: 'src/app/destinations/[city]/page.tsx', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'destination-region', source: 'src/app/destinations/region/[region]/page.tsx', requiredMarker: 'listPublicCatalog', purpose: 'discovery' },
  { id: 'destination-rss', source: 'src/app/destinations/[city]/rss.xml/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'seo' },
  { id: 'attraction-region', source: 'src/app/things-to-do/[region]/page.tsx', requiredMarker: 'listPublicCatalog', purpose: 'seo' },
  { id: 'sitemap', source: 'src/app/sitemap.ts', requiredMarker: 'listPublicCatalog', purpose: 'seo' },
  { id: 'qa-chat', source: 'src/lib/qa-chat-packages.ts', requiredMarker: 'listPublicCatalog', purpose: 'customer-ai' },
  { id: 'jarvis-agent', source: 'src/lib/jarvis/agents/products.ts', requiredMarker: 'listPublicCatalog', purpose: 'customer-ai' },
  { id: 'jarvis-tools', source: 'src/lib/jarvis/tools/product-tools.ts', requiredMarker: 'listPublicCatalog', purpose: 'customer-ai' },
  { id: 'ranked-recommendation', source: 'src/lib/scoring/recommend.ts', requiredMarker: 'listPublicCatalog', purpose: 'recommendation' },
  { id: 'top-recommendation', source: 'src/lib/scoring/top-recommended.ts', requiredMarker: 'listPublicCatalog', purpose: 'recommendation' },
  { id: 'similar-recommendation', source: 'src/lib/user-actions.ts', requiredMarker: 'listPublicCatalog', purpose: 'recommendation' },
  { id: 'recent-recommendation-api', source: 'src/app/api/user-actions/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'recommendation' },
  { id: 'campaign-launch', source: 'src/lib/campaign-public-packages.ts', requiredMarker: 'listPublicCatalog', purpose: 'marketing' },
  { id: 'influencer-assets', source: 'src/app/api/influencer/assets/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'marketing' },
  { id: 'affiliate-public-api', source: 'src/app/api/affiliate/public/[referral_code]/route.ts', requiredMarker: 'listPublicCatalog', purpose: 'marketing' },
  { id: 'affiliate-landing', source: 'src/app/with/[slug]/page.tsx', requiredMarker: 'listPublicCatalog', purpose: 'marketing' },
  { id: 'affiliate-embed', source: 'src/app/embed/pkg/[id]/page.tsx', requiredMarker: 'getPublicCatalogDetail', purpose: 'marketing' },
  { id: 'affiliate-referral', source: 'src/app/r/[code]/[slug]/page.tsx', requiredMarker: 'getPublicCatalogDetail', purpose: 'marketing' },
  { id: 'affiliate-og', source: 'src/app/api/og/affiliate/route.tsx', requiredMarker: 'public_catalog_view', purpose: 'marketing' },
] as const;
