import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getSecret, type SecretKey } from '@/lib/secret-registry';
import { runMarketingIntegrationProbes } from '@/lib/marketing/integration-probes';
import { withTimeout } from '@/lib/promise-timeout';
import {
  COMPLETION_REQUIREMENT_EXTERNAL_WRITE_ZERO,
  COMPLETION_REQUIREMENT_FULL_AUTO_DEFAULT_OFF,
} from '@/lib/ad-os-completion-view';

export const dynamic = 'force-dynamic';
const SYSTEM_HEALTH_TIMEOUT_MS = 8000;

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

async function adOsCompletionChecks(request: NextRequest): Promise<Check[]> {
  const auditUrl = new URL('/api/admin/ad-os/completion-audit', request.url);
  const response = await fetch(auditUrl, {
    cache: 'no-store',
    headers: {
      cookie: request.headers.get('cookie') || '',
      authorization: request.headers.get('authorization') || '',
    },
  });
  const payload = await response.json().catch(() => ({}));
  const audit = payload?.audit;

  if (!response.ok || !audit) {
    return [{
      key: 'ad_os.completion_audit',
      label: 'Ad OS completion audit',
      status: 'fail',
      message: payload?.error
        ? `Completion audit is unavailable: ${payload.error}`
        : 'Completion audit is unavailable. Run /api/admin/ad-os/completion-audit and inspect the JSON response.',
      detail: {
        next_action: payload?.next_action || 'Recover the Ad OS completion audit endpoint before using marketing health as the final readiness monitor.',
        source: '/api/admin/ad-os/completion-audit',
        read_only: true,
        external_api_write: false,
        database_mutation: false,
      },
    }];
  }

  const failed = Number(audit.failed || 0);
  const warnings = Number(audit.warnings || 0);
  const requirements = Array.isArray(audit.requirements) ? audit.requirements : [];
  const externalSpendRequirement = requirements.find((row: { id?: string }) => row.id === COMPLETION_REQUIREMENT_EXTERNAL_WRITE_ZERO);
  const fullAutoRequirement = requirements.find((row: { id?: string }) => row.id === COMPLETION_REQUIREMENT_FULL_AUTO_DEFAULT_OFF);

  return [
    {
      key: 'ad_os.completion_audit',
      label: 'Ad OS completion audit',
      status: failed > 0 || audit.status === 'blocked' ? 'fail' : warnings > 0 ? 'warn' : 'ok',
      message: `status ${audit.status || 'unknown'} | score ${Number(audit.readiness_score || 0)}% | pass ${Number(audit.passed || 0)} / warn ${warnings} / fail ${failed}`,
      detail: {
        top_blocker: audit.top_blocker || 'No blocker',
        next_action: audit.next_action || 'Collect current evidence before declaring Ad OS complete.',
        source: '/api/admin/ad-os/completion-audit',
        read_only: true,
      },
    },
    {
      key: 'ad_os.external_write_safety',
      label: 'External spend safety',
      status: externalSpendRequirement?.status === 'fail' ? 'fail' : externalSpendRequirement?.status === 'warn' ? 'warn' : 'ok',
      message: externalSpendRequirement?.evidence || 'No live external API write was detected in the Ad OS runtime layers.',
      detail: {
        next_action: externalSpendRequirement?.next_action || 'Keep all external writes behind approval, budget, and confirmation gates.',
        source: `completion_audit.requirements.${COMPLETION_REQUIREMENT_EXTERNAL_WRITE_ZERO}`,
      },
    },
    {
      key: 'ad_os.full_auto_policy',
      label: 'Full auto policy',
      status: fullAutoRequirement?.status === 'fail' ? 'fail' : fullAutoRequirement?.status === 'warn' ? 'warn' : 'ok',
      message: fullAutoRequirement?.evidence || 'Full autopilot remains disabled by default.',
      detail: {
        next_action: fullAutoRequirement?.next_action || 'Keep full auto disabled unless separate operational approval exists.',
        source: `completion_audit.requirements.${COMPLETION_REQUIREMENT_FULL_AUTO_DEFAULT_OFF}`,
      },
    },
  ];
}

async function getHandler(request: NextRequest) {
  const baseChecks = SECRET_GROUPS.map(secretCheck);
  let db: Check[] = [];
  let cron: Check[] = [];
  let adOs: Check[] = [];
  let probes: Awaited<ReturnType<typeof runMarketingIntegrationProbes>> = [];

  try {
    [db, cron, adOs, probes] = await withTimeout(
      Promise.all([
        dbChecks(),
        cronChecks(),
        adOsCompletionChecks(request),
        runMarketingIntegrationProbes(),
      ]),
      SYSTEM_HEALTH_TIMEOUT_MS,
      'marketing system health',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Marketing system health unavailable';
    db = [{ key: 'db.supabase', label: 'Supabase', status: 'fail', message }];
    cron = [{ key: 'cron.health', label: 'Cron health', status: 'warn', message: 'Skipped because Supabase health check timed out.' }];
    adOs = [{
      key: 'ad_os.completion_audit',
      label: 'Ad OS completion audit',
      status: 'fail',
      message: 'Skipped because marketing system health timed out before Ad OS completion audit finished.',
      detail: { read_only: true, external_api_write: false, database_mutation: false },
    }];
    probes = [];
  }

  const probeChecks: Check[] = probes.map((probe) => ({
    key: `probe.${probe.key}`,
    label: probe.label,
    status: probe.status === 'fail' ? 'fail' : probe.status === 'warn' ? 'warn' : 'ok',
    message: probe.message,
    detail: { probe_status: probe.status, ...(probe.detail ?? {}) },
  }));

  const checks = [...baseChecks, ...db, ...cron, ...adOs, ...probeChecks];
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
