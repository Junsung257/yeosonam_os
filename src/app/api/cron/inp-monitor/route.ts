import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendSlackAlert } from '@/lib/slack-alert';
import { getSecret } from '@/lib/secret-registry';
import { logWarning } from '@/lib/sentry-logger';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import { fetchBlogPageSpeedObservationV4 } from '@/lib/blog-pagespeed-v4';

/**
 * INP 모니터링 — 매일 1회 실행 (PR-D)
 *
 * 흐름:
 *   1) 모니터 대상 URL = 홈 + 핫 카테고리 + 최근 7일 클릭 상위 패키지/블로그
 *   2) Google PageSpeed Insights API (CrUX field data) 모바일 호출
 *   3) inp_measurements 누적 + INP > 200ms URL은 Slack 알림
 *
 * Why:
 *   2026-03부터 INP < 200ms 가 ranking signal 동등 승격.
 *   업계 평균 43% 사이트가 fail — 우리는 모니터링부터 박제해 차별화.
 *
 * env (옵션):
 *   GOOGLE_PAGESPEED_API_KEY — 미설정 시 rate-limit 낮은 비인증 호출(개발용)
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const INP_THRESHOLD_MS = 200;       // 2026 ranking signal 임계값
const MAX_URLS_PER_RUN = 12;         // 호출 수 통제

async function pickTargetUrls(baseUrl: string): Promise<string[]> {
  const urls = new Set<string>([baseUrl, `${baseUrl}/packages`, `${baseUrl}/blog`]);

  if (!isSupabaseConfigured) return Array.from(urls).slice(0, MAX_URLS_PER_RUN);

  // 최근 7일 GSC 클릭 상위 슬러그 → 블로그 URL
  const since = new Date();
  since.setDate(since.getDate() - 7);

  try {
    const { data: hot } = await supabaseAdmin
      .from('rank_history')
      .select('slug, page_url, clicks')
      .gte('date', since.toISOString().split('T')[0])
      .order('clicks', { ascending: false })
      .limit(20);

    for (const row of (hot || []) as Array<{ slug: string; page_url: string | null; clicks: number }>) {
      if (row.page_url && /^https?:\/\//.test(row.page_url)) {
        urls.add(row.page_url);
      } else if (row.slug) {
        urls.add(`${baseUrl}/blog/${row.slug}`);
      }
      if (urls.size >= MAX_URLS_PER_RUN) break;
    }
  } catch {
    // rank_history 비어있으면 무시
  }

  // 부족하면 활성 패키지 상위 추가
  if (urls.size < MAX_URLS_PER_RUN) {
    try {
      const { data: pkgs } = await supabaseAdmin
        .from('travel_packages')
        .select('id, view_count')
        .in('status', [...CUSTOMER_VISIBLE_STATUSES])
        .order('view_count', { ascending: false, nullsFirst: false })
        .limit(MAX_URLS_PER_RUN - urls.size);
      for (const p of (pkgs || []) as Array<{ id: string }>) {
        urls.add(`${baseUrl}/packages/${p.id}`);
      }
    } catch {
      /* skip */
    }
  }

  return Array.from(urls).slice(0, MAX_URLS_PER_RUN);
}

async function runInpMonitor(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/+$/, '');
  const apiKey = getSecret('GOOGLE_PAGESPEED_API_KEY') || null;
  const errors: string[] = [];
  const targets = await pickTargetUrls(baseUrl);

  let measured = 0;
  const exceeded: Array<{ url: string; inp: number }> = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const url of targets) {
    const observation = await fetchBlogPageSpeedObservationV4({ url, apiKey }).catch((error) => {
      logWarning('[cron/inp-monitor] PSI request failed', { url, error });
      return null;
    });
    if (!observation) {
      errors.push(`PSI 실패: ${url}`);
      continue;
    }
    const inpMs = observation.inpMs;

    rows.push({
      url,
      device: 'mobile',
      inp_ms: inpMs,
      lcp_ms: observation.lcpMs,
      cls: observation.cls,
      ttfb_ms: observation.ttfbMs,
      fcp_ms: observation.fcpMs,
      performance_score: observation.performanceScore,
      raw: {
        contract_version: observation.contractVersion,
        field_source: observation.fieldSource,
        receipt: observation.receipt,
      },
      measured_at: new Date().toISOString(),
    });

    measured += 1;
    if (typeof inpMs === 'number' && inpMs > INP_THRESHOLD_MS) {
      exceeded.push({ url, inp: inpMs });
    }

    // PSI rate-limit 방어
    await new Promise(r => setTimeout(r, 600));
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('inp_measurements').insert(rows);
    if (insErr) errors.push(`inp_measurements insert: ${insErr.message}`);
  }

  // INP 임계 초과 Slack 알림 (병합 1건)
  if (exceeded.length > 0) {
    const lines = exceeded
      .sort((a, b) => b.inp - a.inp)
      .slice(0, 10)
      .map(e => `• ${e.inp}ms — ${e.url}`)
      .join('\n');
    await sendSlackAlert(
      `⚡ INP 임계 초과 ${exceeded.length}건 (>${INP_THRESHOLD_MS}ms)\n${lines}\n\n2026-03부터 ranking signal 동등 — 우선순위 점검 권장.`,
      { source: 'inp-monitor', count: exceeded.length },
    );
  }

  return {
    measured,
    targets: targets.length,
    exceeded_count: exceeded.length,
    threshold_ms: INP_THRESHOLD_MS,
    pagespeed_key_used: Boolean(apiKey),
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('inp-monitor', runInpMonitor);
