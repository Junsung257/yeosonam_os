import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Period = 'day' | 'week';

interface WebVitalRow {
  name: string;
  value: number;
}

const GOOD_THRESHOLDS: Record<string, number> = {
  LCP: 2500,
  CLS: 0.1,
  INP: 200,
  FCP: 1800,
  TTFB: 800,
};

function getPeriod(value: string | null): Period {
  return value === 'week' ? 'week' : 'day';
}

async function getHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const period = getPeriod(searchParams.get('period'));
  const since =
    period === 'day'
      ? new Date(Date.now() - 86400_000).toISOString()
      : new Date(Date.now() - 7 * 86400_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('web_vitals')
    .select('name, value')
    .gte('created_at', since);

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  const byMetric: Record<string, number[]> = {};
  for (const row of (data ?? []) as WebVitalRow[]) {
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    byMetric[row.name] ??= [];
    byMetric[row.name].push(value);
  }

  const stats: Record<string, { p75: number; goodPct: number; count: number }> = {};
  for (const [name, values] of Object.entries(byMetric)) {
    const sorted = [...values].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const threshold = GOOD_THRESHOLDS[name] ?? Infinity;
    const goodCount = values.filter((value) => value <= threshold).length;
    stats[name] = {
      p75,
      goodPct: values.length > 0 ? Math.round((goodCount / values.length) * 100) : 0,
      count: values.length,
    };
  }

  return apiResponse({ stats });
}

export const GET = withAdminGuard(getHandler);
