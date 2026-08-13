import { createHash } from 'node:crypto';
import type { GSCMetrics } from './gsc-client';

export type BlogSearchPerformanceProviderV3 = 'google_search_console' | 'naver_search_advisor';

export interface BlogSearchPerformanceImportRowV3 {
  provider: BlogSearchPerformanceProviderV3;
  metric_date: string;
  query: string;
  page_url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  average_position: number | null;
  device: string | null;
  country: string | null;
  source_batch_id: string;
  source_row_hash: string;
}

const aliases: Record<string, string[]> = {
  metric_date: ['date', 'metric_date', '날짜', '일자'],
  query: ['query', '검색어', '키워드'],
  page_url: ['page', 'page_url', 'url', '페이지', '노출 url'],
  clicks: ['clicks', '클릭', '클릭수'],
  impressions: ['impressions', '노출', '노출수'],
  ctr: ['ctr', '클릭률'],
  average_position: ['position', 'average_position', '평균 게재순위', '평균순위'],
  device: ['device', '기기'],
  country: ['country', '국가'],
};

const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const valueFor = (row: Record<string, string>, field: keyof typeof aliases): string => {
  const entries = new Map(Object.entries(row).map(([key, value]) => [normalized(key), String(value || '').trim()]));
  for (const alias of aliases[field]) {
    const value = entries.get(normalized(alias));
    if (value !== undefined) return value;
  }
  return '';
};
const nonnegative = (value: string, field: string): number => {
  const parsed = Number(value.replace(/,/g, '').replace(/%$/, ''));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid_${field}:${value}`);
  return parsed;
};

export function normalizeBlogSearchPerformanceRowV3(input: {
  provider: BlogSearchPerformanceProviderV3;
  row: Record<string, string>;
  batchId: string;
}): BlogSearchPerformanceImportRowV3 {
  const metricDate = valueFor(input.row, 'metric_date');
  const query = valueFor(input.row, 'query');
  const pageUrl = valueFor(input.row, 'page_url');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) throw new Error(`invalid_metric_date:${metricDate}`);
  if (!query) throw new Error('query_missing');
  try { new URL(pageUrl); } catch { throw new Error(`invalid_page_url:${pageUrl}`); }
  const clicks = Math.trunc(nonnegative(valueFor(input.row, 'clicks') || '0', 'clicks'));
  const impressions = Math.trunc(nonnegative(valueFor(input.row, 'impressions') || '0', 'impressions'));
  const rawCtr = valueFor(input.row, 'ctr');
  const ctr = rawCtr
    ? (rawCtr.endsWith('%') ? nonnegative(rawCtr, 'ctr') / 100 : nonnegative(rawCtr, 'ctr'))
    : (impressions > 0 ? clicks / impressions : 0);
  if (ctr > 1 || clicks > impressions) throw new Error(`metric_inconsistent:${clicks}/${impressions}/${ctr}`);
  const rawPosition = valueFor(input.row, 'average_position');
  const device = valueFor(input.row, 'device') || null;
  const country = valueFor(input.row, 'country') || null;
  const canonical = [input.provider, metricDate, query, pageUrl, device || '', country || ''].join('\u001f');
  return {
    provider: input.provider,
    metric_date: metricDate,
    query,
    page_url: pageUrl,
    clicks,
    impressions,
    ctr,
    average_position: rawPosition ? nonnegative(rawPosition, 'average_position') : null,
    device,
    country,
    source_batch_id: input.batchId,
    source_row_hash: createHash('sha256').update(canonical).digest('hex'),
  };
}

export function buildBlogGscSearchPerformanceRowsV3(
  metrics: GSCMetrics[],
  batchId: string,
): BlogSearchPerformanceImportRowV3[] {
  return metrics
    .filter((metric) => Boolean(metric.query?.trim()) && /^https?:\/\//i.test(metric.page))
    .map((metric) => normalizeBlogSearchPerformanceRowV3({
      provider: 'google_search_console',
      batchId,
      row: {
        date: metric.date,
        query: metric.query!.trim(),
        page: metric.page,
        clicks: String(metric.clicks),
        impressions: String(metric.impressions),
        ctr: String(metric.ctr),
        position: String(metric.position),
      },
    }));
}
