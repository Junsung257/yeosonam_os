import { getSupabaseAdmin } from '@/lib/supabase';
import { fmtDateTime } from '@/lib/admin-utils';
import { resolveSlackAlertWebhookUrl } from '@/lib/slack-alert';

type LooseSupabaseAdmin = {
  from(table: string): any;
};

function getLooseSupabaseAdmin(): LooseSupabaseAdmin | null {
  return getSupabaseAdmin() as unknown as LooseSupabaseAdmin | null;
}

export interface WebVitalPayload {
  /** 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB' */
  name: string;
  /** 밀리초 단위 값 (CLS는 dimensionless) */
  value: number;
  /** 측정 시각 (브라우저 timestamp) */
  timestamp: number;
  /** 현재 페이지 URL path (query 제외) */
  path: string;
  /** 'blog' | 'package' | 'page' 등 */
  pageType: string;
  /** blog slug (blog 페이지인 경우) */
  slug?: string;
}

export interface CwvThreshold {
  name: string;
  good: number;
  needsImprovement: number;
  poor: number;
}

export const CWV_THRESHOLDS: CwvThreshold[] = [
  { name: 'LCP', good: 2500, needsImprovement: 4000, poor: Infinity },
  { name: 'FCP', good: 1800, needsImprovement: 3000, poor: Infinity },
  { name: 'INP', good: 200, needsImprovement: 500, poor: Infinity },
  { name: 'CLS', good: 0.1, needsImprovement: 0.25, poor: Infinity },
  { name: 'TTFB', good: 800, needsImprovement: 1800, poor: Infinity },
];

export function classifyCwv(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const t = CWV_THRESHOLDS.find((x) => x.name === name);
  if (!t) return 'needs-improvement';
  if (value <= t.good) return 'good';
  if (value <= t.needsImprovement) return 'needs-improvement';
  return 'poor';
}

export async function saveWebVital(payload: WebVitalPayload): Promise<void> {
  const supabase = getLooseSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase.from('web_vitals').insert({
    name: payload.name,
    value: payload.value,
    timestamp: new Date(payload.timestamp).toISOString(),
    path: payload.path,
    page_type: payload.pageType,
    slug: payload.slug || null,
    rating: classifyCwv(payload.name, payload.value),
  });
  if (error) {
    // 중복 키 또는 rate limit은 silent
    if (error.code === '23505' || error.code === '42501') return;
    return;
  }
}

const CWV_ALERT_COOLDOWN_MS = 3600_000; // 1시간

export async function alertIfPoorVital(payload: WebVitalPayload): Promise<void> {
  const slackWebhookUrl = resolveSlackAlertWebhookUrl();
  if (!slackWebhookUrl) return;
  const supabase = getLooseSupabaseAdmin();
  if (!supabase) return;

  const rating = classifyCwv(payload.name, payload.value);
  if (rating !== 'poor') return;

  const { error: recentError } = await supabase
    .from('web_vital_alerts')
    .insert({
      name: payload.name,
      value: payload.value,
      path: payload.path,
      rating,
    });
  if (recentError) return; // cooldown 내 중복이면 unique constraint 에러

  await fetch(slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: [
        `🚨 *CWV Poor 감지*`,
        `· 메트릭: ${payload.name} = ${payload.name === 'CLS' ? payload.value.toFixed(3) : Math.round(payload.value)}ms`,
        `· 경로: ${payload.path}`,
        `· 등급: ${rating}`,
        `· 시간: ${fmtDateTime(new Date().toISOString())}`,
      ].join('\n'),
    }),
  });
}

/** 일/주간 CWV 통계 집계 */
export async function getCwvStats(
  period: 'day' | 'week' = 'day',
  pageType?: string,
) {
  const supabase = getLooseSupabaseAdmin();
  if (!supabase) return null;

  const since =
    period === 'day'
      ? new Date(Date.now() - 86400_000).toISOString()
      : new Date(Date.now() - 7 * 86400_000).toISOString();

  let query = supabase
    .from('web_vitals')
    .select('name, value, rating, path, slug')
    .gte('timestamp', since);

  if (pageType) query = query.eq('page_type', pageType);

  const { data, error } = await query;
  if (error || !data) return null;

  const byMetric: Record<string, number[]> = {};
  for (const row of data) {
    if (!byMetric[row.name]) byMetric[row.name] = [];
    byMetric[row.name].push(row.value);
  }

  const stats: Record<string, { p75: number; goodPct: number; count: number }> = {};
  for (const [name, values] of Object.entries(byMetric)) {
    const sorted = values.sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const goodCount = values.filter((v) => {
      const t = CWV_THRESHOLDS.find((x) => x.name === name);
      return t ? v <= t.good : false;
    }).length;
    stats[name] = { p75, goodPct: Math.round((goodCount / values.length) * 100), count: values.length };
  }

  return stats;
}
