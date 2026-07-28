import type { GSCMetrics } from './gsc-client';
import { extractSlugFromUrl } from './gsc-client';
import { blogIndexingUrlForSlug } from './blog-canonical-url';

export interface BlogGscQueryRankHistoryRow {
  slug: string;
  query: string;
  date: string;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  page_url: string;
  source: 'gsc';
}

interface GroupedMetric {
  slug: string;
  query: string;
  impressions: number;
  clicks: number;
  weightedPosition: number;
  positionWeight: number;
}

export function buildBlogGscQueryRankHistoryRows(
  metrics: GSCMetrics[],
  date: string,
): BlogGscQueryRankHistoryRow[] {
  const grouped = new Map<string, GroupedMetric>();

  for (const metric of metrics) {
    const slug = extractSlugFromUrl(metric.page);
    const query = metric.query?.trim();
    if (!slug || !query) continue;

    const impressions = Number.isFinite(metric.impressions)
      ? Math.max(0, metric.impressions)
      : 0;
    const clicks = Number.isFinite(metric.clicks) ? Math.max(0, metric.clicks) : 0;
    const position = Number.isFinite(metric.position) ? Math.max(0, metric.position) : 0;
    const positionWeight = impressions > 0 ? impressions : 1;
    const key = `${slug}\u0000${query}`;
    const current = grouped.get(key) ?? {
      slug,
      query,
      impressions: 0,
      clicks: 0,
      weightedPosition: 0,
      positionWeight: 0,
    };

    current.impressions += impressions;
    current.clicks += clicks;
    current.weightedPosition += position * positionWeight;
    current.positionWeight += positionWeight;
    grouped.set(key, current);
  }

  return [...grouped.values()].map((row) => ({
    slug: row.slug,
    query: row.query,
    date,
    position: row.positionWeight > 0 ? row.weightedPosition / row.positionWeight : 0,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
    page_url: blogIndexingUrlForSlug(row.slug),
    source: 'gsc',
  }));
}
