import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { normalizeBlogTitleSkeletonV3, extractBlogHeadingTreeV3 } from '../../src/lib/blog-corpus-diversity-v3';
import { evaluateBlogPublicEligibility } from '../../src/lib/blog-public-eligibility';
import { isHighRiskInformationalTopic } from '../../src/lib/blog-publication-review-policy';
import { evaluateBlogImageAltV3 } from '../../src/lib/blog-image-quality-v3';

dotenv.config({ path: '.env.prod' });

export type CorpusAction = 'KEEP' | 'REFRESH' | 'MERGE' | 'QUARANTINE' | 'NOINDEX' | 'REMOVE' | 'REDIRECT';

export interface CorpusRowV3 {
  id: string;
  slug: string | null;
  seo_title: string | null;
  title: string | null;
  status: string | null;
  review_status: string | null;
  product_id: string | null;
  category: string | null;
  content_type: string | null;
  destination: string | null;
  blog_html: string | null;
  published_at: string | null;
  created_at: string | null;
  generation_meta: Record<string, unknown> | null;
  quality_gate: Record<string, unknown> | null;
  seo_score: { score?: number } | number | null;
  readability_score: number | null;
  og_image_url: string | null;
}

export interface CorpusDispositionV3 {
  creative_id: string;
  slug: string;
  title: string;
  current_status: string;
  public_eligible: boolean;
  review_status: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  action: CorpusAction;
  canonical_target: string;
  duplicate_cluster_id: string;
  stale_claim_count: number;
  unsupported_claim_count: number;
  language_issue_count: number;
  image_duplicate_count: number;
  performance_signal: string;
  reason: string;
  recommended_next_step: string;
}

const languagePatterns = [
  /고민을에서\s*덜어드리겠습니다\.에서\s*엄선한/u, /여\s*여소남\s*에디터/u,
  /낮춝니다/u, /어렵편입니다/u, /여행\s*준비\s*여행/u, /쉥겐\s*협약국\s*2\s*[-~]\s*6개국/u,
];
const invalidDestination = /^(?:top|undefined|null|unknown|\d+)$/i;

export function getReadOnlySupabaseV3(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('read_only_supabase_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function loadCorpusRowsV3(client = getReadOnlySupabaseV3()): Promise<CorpusRowV3[]> {
  const { data, error } = await client.from('content_creatives')
    .select('id, slug, seo_title, title, status, review_status, product_id, category, content_type, destination, blog_html, published_at, created_at, generation_meta, quality_gate, seo_score, readability_score, og_image_url')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw new Error(`corpus_read_failed:${error.message}`);
  return (data || []) as CorpusRowV3[];
}

export function extractImagesV3(markdown: string): Array<{ url: string; alt: string }> {
  const result: Array<{ url: string; alt: string }> = [];
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi)) {
    result.push({ alt: match[1].trim(), url: match[2].trim() });
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] || '';
    result.push({ alt: alt.trim(), url: match[1].trim() });
  }
  return result;
}

export function titleOf(row: CorpusRowV3): string {
  return String(row.seo_title || row.title || '').trim();
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

export function buildCorpusAuditV3(rows: CorpusRowV3[]) {
  const published = rows.filter((row) => row.status === 'published');
  const destinations = [...new Set(rows.map((row) => row.destination || '').filter(Boolean))];
  const titleGroups = new Map<string, CorpusRowV3[]>();
  const skeletonGroups = new Map<string, CorpusRowV3[]>();
  const h2Groups = new Map<string, CorpusRowV3[]>();
  const introGroups = new Map<string, CorpusRowV3[]>();
  const imageUses = new Map<string, CorpusRowV3[]>();

  for (const row of rows) {
    const title = titleOf(row);
    titleGroups.set(title, [...(titleGroups.get(title) || []), row]);
    const skeleton = normalizeBlogTitleSkeletonV3(title, { cities: destinations });
    skeletonGroups.set(skeleton, [...(skeletonGroups.get(skeleton) || []), row]);
    const body = row.blog_html || '';
    const headings = extractBlogHeadingTreeV3(body, { cities: destinations }).join('|');
    if (headings) h2Groups.set(headings, [...(h2Groups.get(headings) || []), row]);
    const paragraphs = body.replace(/<[^>]+>/g, ' ').split(/\n\s*\n/).map((v) => v.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const intro = normalizeBlogTitleSkeletonV3(paragraphs[0] || '', { cities: destinations }).slice(0, 240);
    if (intro) introGroups.set(intro, [...(introGroups.get(intro) || []), row]);
    for (const image of extractImagesV3(body)) imageUses.set(image.url, [...(imageUses.get(image.url) || []), row]);
    if (row.og_image_url) imageUses.set(row.og_image_url, [...(imageUses.get(row.og_image_url) || []), row]);
  }
  const duplicate = (groups: Map<string, CorpusRowV3[]>, minimum = 2) => [...groups.entries()]
    .filter(([key, members]) => key && members.length >= minimum)
    .map(([signature, members]) => ({ signature, count: members.length, ids: members.map((row) => row.id), slugs: members.map((row) => row.slug) }));
  const score = (row: CorpusRowV3) => typeof row.seo_score === 'number' ? row.seo_score : Number(row.seo_score?.score || 0);
  const hostCounts: Record<string, number> = {};
  let imageOccurrences = 0;
  for (const row of published) for (const image of [
    ...extractImagesV3(row.blog_html || ''),
    ...(row.og_image_url ? [{ url: row.og_image_url, alt: '' }] : []),
  ]) {
    imageOccurrences += 1;
    try { const host = new URL(image.url).hostname; hostCounts[host] = (hostCounts[host] || 0) + 1; } catch { /* ignore */ }
  }
  return {
    generated_at: new Date().toISOString(),
    corpus: { total: rows.length, published: published.length, informational: published.filter((r) => !r.product_id).length, product_linked: published.filter((r) => r.product_id).length },
    review_status_distribution: Object.fromEntries([...new Set(rows.map((r) => r.review_status || 'null'))].map((status) => [status, rows.filter((r) => (r.review_status || 'null') === status).length])),
    exact_title_duplicates: duplicate(titleGroups),
    normalized_title_skeleton_duplicates: duplicate(skeletonGroups, 3),
    normalized_h2_tree_duplicates: duplicate(h2Groups, 2),
    intro_signature_duplicates: duplicate(introGroups, 2),
    images: { occurrences: imageOccurrences, hosts: hostCounts, duplicate_urls: duplicate(imageUses, 2) },
    quality: {
      seo_average: published.length ? Math.round(published.reduce((sum, row) => sum + score(row), 0) / published.length * 100) / 100 : null,
      seo_95_or_more: published.filter((row) => score(row) >= 95).length,
      readability_100: published.filter((row) => Number(row.readability_score) === 100).length,
    },
  };
}

export function planCorpusDispositionV3(rows: CorpusRowV3[], performanceByCreative: Map<string, { clicks: number; impressions: number }> = new Map()): CorpusDispositionV3[] {
  const destinations = [...new Set(rows.map((r) => r.destination || '').filter(Boolean))];
  const exact = new Map<string, CorpusRowV3[]>();
  const skeleton = new Map<string, CorpusRowV3[]>();
  const images = new Map<string, CorpusRowV3[]>();
  for (const row of rows) {
    exact.set(titleOf(row), [...(exact.get(titleOf(row)) || []), row]);
    const key = normalizeBlogTitleSkeletonV3(titleOf(row), { cities: destinations });
    skeleton.set(key, [...(skeleton.get(key) || []), row]);
    for (const image of [
      ...extractImagesV3(row.blog_html || ''),
      ...(row.og_image_url ? [{ url: row.og_image_url, alt: '' }] : []),
    ]) images.set(image.url, [...(images.get(image.url) || []), row]);
  }
  const canonicalFor = (members: CorpusRowV3[]) => [...members].sort((a, b) => {
    const pa = performanceByCreative.get(a.id)?.clicks || 0;
    const pb = performanceByCreative.get(b.id)?.clicks || 0;
    return pb - pa || Date.parse(a.published_at || a.created_at || '') - Date.parse(b.published_at || b.created_at || '');
  })[0];
  return rows.map((row) => {
    const title = titleOf(row);
    const body = row.blog_html || '';
    const exactMembers = exact.get(title) || [];
    const skeletonKey = normalizeBlogTitleSkeletonV3(title, { cities: destinations });
    const skeletonMembers = skeleton.get(skeletonKey) || [];
    const cluster = exactMembers.length > 1 ? exactMembers : skeletonMembers.length >= 3 ? skeletonMembers : [];
    const canonical = cluster.length ? canonicalFor(cluster) : row;
    const reviewBlocked = ['pending_review','in_review','rejected','changes_requested'].includes(row.review_status || '');
    const highRisk = isHighRiskInformationalTopic({ title, category: row.category, contentType: row.content_type });
    const stale = /ETIAS[\s\S]{0,80}(?:2025년\s*상반기|7\s*유로)/iu.test(body) ? 1 : 0;
    const unsupported = (body.match(/\d+(?:[.,]\d+)?\s*(?:원|유로|달러|엔|분|시간|km)/giu) || []).length
      - Number((row.generation_meta?.information_claim_validation as Record<string, unknown> | undefined)?.supported_claims || 0);
    const languageIssues = languagePatterns.filter((pattern) => pattern.test(body)).length;
    const rowImages = [
      ...extractImagesV3(body),
      ...(row.og_image_url ? [{ url: row.og_image_url, alt: '' }] : []),
    ];
    const imageDuplicates = rowImages.filter((image) => new Set((images.get(image.url) || []).map((use) => use.destination).filter(Boolean)).size > 1).length;
    const altIssues = rowImages.reduce((sum, image) => sum + evaluateBlogImageAltV3(image.alt, title).length, 0);
    const performance = performanceByCreative.get(row.id) || { clicks: 0, impressions: 0 };
    const publicEligibility = evaluateBlogPublicEligibility({
      id: row.id, slug: row.slug, status: row.status, channel: 'naver_blog', productId: row.product_id,
      reviewStatus: row.review_status, title, category: row.category, contentType: row.content_type,
      publishedAt: row.published_at, createdAt: row.created_at, generationMeta: row.generation_meta,
      qualityGate: row.quality_gate,
    });
    let action: CorpusAction = 'KEEP';
    const reasons: string[] = [];
    if (reviewBlocked || (highRisk && row.review_status !== 'approved') || stale) { action = 'QUARANTINE'; reasons.push(reviewBlocked ? 'review_blocked' : stale ? 'stale_high_risk_claim' : 'high_risk_unapproved'); }
    else if (cluster.length && canonical.id !== row.id) { action = 'MERGE'; reasons.push(exactMembers.length > 1 ? 'exact_title_duplicate' : 'template_skeleton_cluster'); }
    else if (invalidDestination.test(row.destination || '')) { action = 'QUARANTINE'; reasons.push('invalid_destination'); }
    else if (languageIssues || unsupported > 0 || imageDuplicates || altIssues) { action = 'REFRESH'; reasons.push(languageIssues ? 'malformed_korean' : unsupported > 0 ? 'unsupported_numbers' : 'image_quality'); }
    else if (!performance.impressions && !row.product_id && row.status !== 'draft') { action = 'NOINDEX'; reasons.push('no_observed_demand_or_performance'); }
    const target = canonical.id !== row.id ? canonical.slug || '' : '';
    return {
      creative_id: row.id, slug: row.slug || '', title, current_status: row.status || '',
      public_eligible: publicEligibility.eligible, review_status: row.review_status || 'null',
      risk_level: highRisk ? 'HIGH' : /날씨|교통|요금|가격|환율|공항/.test(title) ? 'MEDIUM' : 'LOW',
      action, canonical_target: target, duplicate_cluster_id: cluster.length ? `dup-${hash(skeletonKey)}` : '',
      stale_claim_count: stale, unsupported_claim_count: Math.max(0, unsupported),
      language_issue_count: languageIssues, image_duplicate_count: imageDuplicates,
      performance_signal: `clicks=${performance.clicks};impressions=${performance.impressions}`,
      reason: reasons.join('|') || 'no_blocking_issue_detected',
      recommended_next_step: action === 'KEEP' ? 'monitor' : action === 'MERGE' ? `merge_into:${target}` : action === 'QUARANTINE' ? 'human_review_before_any_publication' : action === 'NOINDEX' ? 'validate_demand_then_refresh_or_remove' : 'editorial_refresh_with_claim_and_image_evidence',
    };
  });
}

export function toCsvV3(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [headers.map(cell).join(','), ...rows.map((row) => headers.map((key) => cell(row[key])).join(','))].join('\n');
}
