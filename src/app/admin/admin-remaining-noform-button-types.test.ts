import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const adminNoFormInteractionScreens = [
  'src/app/admin/band-import/page.tsx',
  'src/app/admin/blog/ads/page.tsx',
  'src/app/admin/blog/categories/page.tsx',
  'src/app/admin/blog/rankings/page.tsx',
  'src/app/admin/blog/topical/page.tsx',
  'src/app/admin/concierge/page.tsx',
  'src/app/admin/concierge/transactions/[id]/page.tsx',
  'src/app/admin/content-analytics/page.tsx',
  'src/app/admin/fraud-quarantine/page.tsx',
  'src/app/admin/free-travel/FreeTravelPageClient.tsx',
  'src/app/admin/free-travel/settlements/page.tsx',
  'src/app/admin/jarvis/components/ActionCard.tsx',
  'src/app/admin/jarvis/components/McpToolGuide.tsx',
  'src/app/admin/keyword-stats/page.tsx',
  'src/app/admin/land-settlements/page.tsx',
  'src/app/admin/leads/LeadsPageClient.tsx',
  'src/app/admin/magic-links/page.tsx',
  'src/app/admin/mcp/page.tsx',
  'src/app/admin/payments/_components/AutoSuggestChip.tsx',
  'src/app/admin/payments/_components/PaymentCommandBar.tsx',
  'src/app/admin/payments/PaymentsPageClient.tsx',
  'src/app/admin/payments/reconcile/page.tsx',
  'src/app/admin/platform-learning/page.tsx',
  'src/app/admin/products/from-mrt/page.tsx',
  'src/app/admin/prompts/[key]/page.tsx',
  'src/app/admin/rfqs/[id]/page.tsx',
  'src/app/admin/scoring/trends/page.tsx',
  'src/app/admin/tenant-tokens/page.tsx',
  'src/app/admin/tmp-pipeline/page.tsx',
  'src/app/admin/web-vitals/WebVitalsDashboard.tsx',
  'src/components/AdminLayout.tsx',
  'src/components/LedgerViewer.tsx',
  'src/components/admin/AnalyticsDashboard.tsx',
  'src/components/admin/JarvisQuickAsk.tsx',
  'src/components/admin/MarketingPromptGenerator.tsx',
  'src/components/admin/PosterStudio.tsx',
  'src/components/admin/SidebarAIWidget.tsx',
  'src/components/admin/ui/CommandPalette.tsx',
];

describe('admin no-form interaction button types', () => {
  it.each(adminNoFormInteractionScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
