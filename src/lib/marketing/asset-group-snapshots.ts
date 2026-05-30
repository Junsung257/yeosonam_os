import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isMissingSnapshotTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === '42P01' || maybe.message?.includes('marketing_asset_group_snapshots') === true;
}

export async function captureMarketingAssetGroupSnapshots(limit = 100) {
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase is not configured', inserted: 0, errors: [] as string[] };
  }

  const { groups } = await getMarketingAssetGroups(limit);
  const capturedDate = todayIsoDate();
  const rows = groups.map((group) => ({
    product_id: group.product.id,
    captured_date: capturedDate,
    readiness_score: group.readiness_score,
    blog_total: group.stages.blog.total,
    blog_published: group.stages.blog.published,
    latest_blog_slug: group.stages.blog.latest_slug,
    gsc_impressions: group.stages.indexing.gsc_impressions,
    gsc_clicks: group.stages.indexing.gsc_clicks,
    gsc_position: group.stages.indexing.gsc_position,
    gsc_health_score: group.stages.indexing.health_score,
    card_news_total: group.stages.card_news.total,
    card_news_confirmed: group.stages.card_news.confirmed,
    social_published: group.stages.card_news.ig_published + group.stages.card_news.threads_published,
    active_campaigns: group.stages.ads.active_campaigns,
    deployed_creatives: group.stages.ads.deployed_creatives,
    total_spend_krw: group.stages.ads.total_spend_krw,
    distribution_failed: group.stages.distribution.failed + group.stages.card_news.ig_failed,
    actions_total: group.next_actions.length,
    critical_actions: group.next_actions.filter((action) => action.severity === 'critical').length,
    high_actions: group.next_actions.filter((action) => action.severity === 'high').length,
    flags: group.flags,
    raw: group,
  }));

  if (rows.length === 0) {
    return { captured_date: capturedDate, inserted: 0, groups: 0, errors: [] as string[] };
  }

  const { error } = await supabaseAdmin
    .from('marketing_asset_group_snapshots')
    .upsert(rows, { onConflict: 'product_id,captured_date', ignoreDuplicates: false });

  if (isMissingSnapshotTableError(error)) {
    return {
      captured_date: capturedDate,
      inserted: 0,
      groups: groups.length,
      errors: ['marketing_asset_group_snapshots migration is not applied yet'],
    };
  }
  if (error) throw error;

  return {
    captured_date: capturedDate,
    inserted: rows.length,
    groups: groups.length,
    avg_readiness: Math.round(groups.reduce((sum, group) => sum + group.readiness_score, 0) / groups.length),
    errors: [] as string[],
  };
}
