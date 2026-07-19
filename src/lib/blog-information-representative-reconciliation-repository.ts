import { supabaseAdmin } from './supabase';
import type { BlogInformationRepresentativeRecord } from './blog-information-representative';
import {
  assertBlogInformationReconciliationApplyAuthorized,
  reconcileBlogInformationRepresentativesDryRun,
  type BlogInformationLegacyArticle,
  type BlogInformationReconciliationReport,
} from './blog-information-representative-reconciliation';

export async function loadBlogInformationRepresentativeReconciliationReport(): Promise<BlogInformationReconciliationReport> {
  const [{ data: articles, error: articleError }, { data: representatives, error: registryError }] = await Promise.all([
    supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, blog_html, destination, status, product_id, review_status, published_at, generation_meta')
      .eq('status', 'published')
      .is('product_id', null),
    supabaseAdmin
      .from('blog_information_representatives')
      .select('representative_key, destination_id, intent, audience, locale, canonical_creative_id, canonical_slug, status, reservation_owner'),
  ]);
  if (articleError) throw new Error(`blog_information_reconciliation_articles_failed:${articleError.message}`);
  if (registryError) throw new Error(`blog_information_reconciliation_registry_failed:${registryError.message}`);
  const mappedArticles: BlogInformationLegacyArticle[] = (articles ?? []).map((row) => ({
    id: row.id,
    slug: row.slug ?? '',
    title: row.seo_title ?? row.slug ?? '',
    markdown: row.blog_html ?? '',
    destination: row.destination,
    status: row.status,
    productId: row.product_id,
    reviewStatus: row.review_status,
    publishedAt: row.published_at,
    generationMeta: row.generation_meta,
  }));
  const mappedRegistry: BlogInformationRepresentativeRecord[] = (representatives ?? []).map((row) => ({
    representativeKey: row.representative_key,
    destinationId: row.destination_id,
    intent: row.intent,
    audience: row.audience,
    locale: row.locale,
    canonicalCreativeId: row.canonical_creative_id,
    canonicalSlug: row.canonical_slug,
    status: row.status,
    reservationOwner: row.reservation_owner,
  })) as BlogInformationRepresentativeRecord[];
  return reconcileBlogInformationRepresentativesDryRun({ articles: mappedArticles, representatives: mappedRegistry });
}

export async function applyBlogInformationRepresentativeReconciliation(input: {
  report: BlogInformationReconciliationReport;
  apply: boolean;
  confirmation?: string | null;
  environmentValue?: string | null;
}): Promise<{ inserted: number }> {
  assertBlogInformationReconciliationApplyAuthorized(input);
  if (!input.apply) return { inserted: 0 };
  const rows = input.report.items.filter((item) => item.mayApply).map((item) => ({
    representative_key: item.representativeKey,
    destination_id: item.identity?.destinationId,
    intent: item.identity?.intent,
    audience: item.identity?.audience,
    locale: item.identity?.locale,
    canonical_creative_id: item.canonicalCreativeId,
    canonical_slug: item.canonicalSlug,
    status: 'active',
    reservation_owner: `legacy-reconciliation:${item.canonicalCreativeId}`,
    activated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return { inserted: 0 };
  const { data, error } = await supabaseAdmin
    .from('blog_information_representatives')
    .insert(rows)
    .select('representative_key');
  if (error) throw new Error(`blog_information_reconciliation_apply_failed:${error.message}`);
  return { inserted: data?.length ?? 0 };
}
