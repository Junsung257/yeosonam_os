import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getSecret, type SecretKey } from '@/lib/secret-registry';
import { runMarketingIntegrationProbes } from '@/lib/marketing/integration-probes';

export const dynamic = 'force-dynamic';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  key: string;
  label: string;
  status: Status;
  message: string;
  detail?: Record<string, unknown>;
}

const SECRET_GROUPS: Array<{ key: string; label: string; required: SecretKey[]; recommended?: SecretKey[] }> = [
  {
    key: 'site',
    label: 'Site runtime',
    required: ['NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    recommended: ['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'],
  },
  {
    key: 'analytics',
    label: 'Analytics pixels',
    required: [],
    recommended: ['NEXT_PUBLIC_GA4_ID', 'NEXT_PUBLIC_META_PIXEL_ID', 'NEXT_PUBLIC_NAVER_ANALYTICS_ID', 'NEXT_PUBLIC_KAKAO_PIXEL_ID', 'NEXT_PUBLIC_CLARITY_PROJECT_ID'],
  },
  {
    key: 'indexing',
    label: 'Indexing',
    required: [],
    recommended: ['GSC_SITE_URL', 'GSC_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'INDEXNOW_KEY'],
  },
  {
    key: 'meta',
    label: 'Meta and Instagram',
    required: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_APP_ID', 'META_APP_SECRET'],
    recommended: ['META_PAGE_ID', 'META_IG_USER_ID', 'THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'],
  },
  {
    key: 'ads',
    label: 'Search ads',
    required: [],
    recommended: ['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
  },
];

function secretCheck(group: (typeof SECRET_GROUPS)[number]): Check {
  const missingRequired = group.required.filter((key) => !getSecret(key));
  const missingRecommended = (group.recommended ?? []).filter((key) => !getSecret(key));
  const status: Status = missingRequired.length ? 'fail' : missingRecommended.length ? 'warn' : 'ok';
  return {
    key: `env.${group.key}`,
    label: group.label,
    status,
    message: status === 'ok'
      ? 'All required and recommended settings are present.'
      : status === 'fail'
        ? `Missing required settings: ${missingRequired.join(', ')}`
        : `Missing recommended settings: ${missingRecommended.join(', ')}`,
    detail: {
      required: group.required.map((key) => ({ key, configured: Boolean(getSecret(key)) })),
      recommended: (group.recommended ?? []).map((key) => ({ key, configured: Boolean(getSecret(key)) })),
    },
  };
}

async function countRows(table: string): Promise<number> {
  const { count } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  return count ?? 0;
}

async function dbChecks(): Promise<Check[]> {
  if (!isSupabaseConfigured) {
    return [{ key: 'db.supabase', label: 'Supabase', status: 'fail', message: 'Supabase is not configured.' }];
  }

  const [content, queue, cardNews, distributions, adAccounts, campaigns, traffic, conversions] = await Promise.all([
    countRows('content_creatives'),
    countRows('blog_topic_queue'),
    countRows('card_news'),
    countRows('content_distributions'),
    countRows('ad_accounts'),
    countRows('ad_campaigns'),
    countRows('ad_traffic_logs'),
    countRows('ad_conversion_logs'),
  ]);

  return [
    { key: 'db.content', label: 'Content inventory', status: content > 0 ? 'ok' : 'fail', message: `content_creatives rows: ${content}` },
    { key: 'db.queue', label: 'Blog queue', status: queue > 0 ? 'ok' : 'warn', message: `blog_topic_queue rows: ${queue}` },
    { key: 'db.card_news', label: 'Card news', status: cardNews > 0 ? 'ok' : 'warn', message: `card_news rows: ${cardNews}; distributions: ${distributions}` },
    { key: 'db.ads', label: 'Ads inventory', status: adAccounts > 0 && campaigns > 0 ? 'ok' : 'warn', message: `ad accounts: ${adAccounts}; campaigns: ${campaigns}` },
    { key: 'db.attribution', label: 'Attribution logs', status: traffic > 0 ? (conversions > 0 ? 'ok' : 'warn') : 'fail', message: `traffic logs: ${traffic}; conversion logs: ${conversions}` },
  ];
}

async function cronChecks(): Promise<Check[]> {
  if (!isSupabaseConfigured) return [];
  const names = ['blog-publisher', 'gsc-index-rank', 'rank-tracking', 'publish-scheduled', 'sync-engagement', 'daily-marketing', 'marketing-rules', 'meta-token-refresh'];
  const { data, error } = await supabaseAdmin
    .from('cron_health')
    .select('cron_name, last_status, last_run_at, last_error_count, last_summary')
    .in('cron_name', names)
    .order('last_run_at', { ascending: false });

  if (error) return [{ key: 'cron.health', label: 'Cron health', status: 'warn', message: error.message }];

  return names.map((name) => {
    const row = data?.find((r) => r.cron_name === name);
    const errors = Number(row?.last_error_count ?? 0);
    return {
      key: `cron.${name}`,
      label: name,
      status: !row ? 'warn' : errors > 0 || row.last_status === 'partial_failure' ? 'warn' : row.last_status === 'success' ? 'ok' : 'fail',
      message: row ? `${row.last_status} | ${row.last_run_at ?? 'never'} | errors ${errors}` : 'No recent run found.',
      detail: row?.last_summary ? { last_summary: row.last_summary } : undefined,
    };
  });
}

async function getHandler(_request: NextRequest) {
  const [db, cron, probes] = await Promise.all([
    dbChecks(),
    cronChecks(),
    runMarketingIntegrationProbes(),
  ]);

  const probeChecks: Check[] = probes.map((probe) => ({
    key: `probe.${probe.key}`,
    label: probe.label,
    status: probe.status === 'fail' ? 'fail' : probe.status === 'warn' ? 'warn' : 'ok',
    message: probe.message,
    detail: { probe_status: probe.status, ...(probe.detail ?? {}) },
  }));

  const checks = [...SECRET_GROUPS.map(secretCheck), ...db, ...cron, ...probeChecks];
  const score = Math.round((checks.filter((check) => check.status === 'ok').length / Math.max(checks.length, 1)) * 100);

  return NextResponse.json({
    ok: checks.every((check) => check.status !== 'fail'),
    score,
    checked_at: new Date().toISOString(),
    checks,
    probes,
  });
}

export const GET = withAdminGuard(getHandler);
