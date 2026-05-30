import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

interface SyncMetric {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  spend: number;
  roas: number;
}

interface SyncBody {
  destination?: string;
  keyword: string;
  platform: 'google' | 'naver' | 'meta';
  metrics: SyncMetric;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidPlatform(platform: unknown): platform is SyncBody['platform'] {
  return platform === 'google' || platform === 'naver' || platform === 'meta';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateBody(body: Partial<SyncBody>): SyncBody | null {
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  if (!keyword || !isValidPlatform(body.platform) || !body.metrics) return null;

  const metrics = body.metrics;
  const required: Array<keyof SyncMetric> = ['impressions', 'clicks', 'ctr', 'cpc', 'conversions', 'spend', 'roas'];
  if (!required.every((key) => isFiniteNumber(metrics[key]))) return null;

  return {
    destination: typeof body.destination === 'string' ? body.destination.trim() : undefined,
    keyword,
    platform: body.platform,
    metrics,
  };
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return isAdminRequest(request);
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  let body: SyncBody | null;
  try {
    body = validateBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) {
    return NextResponse.json({ error: 'Invalid keyword sync payload' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseAdmin.from('keyword_performance_daily').upsert(
    {
      keyword_text: body.keyword,
      platform: body.platform,
      date: today,
      impressions: body.metrics.impressions,
      clicks: body.metrics.clicks,
      ctr: body.metrics.ctr,
      cost_krw: body.metrics.spend,
      avg_cpc: body.metrics.cpc,
      conversions: body.metrics.conversions,
      conversion_value: body.metrics.conversions * 500000,
      roas: body.metrics.roas,
    },
    { onConflict: 'keyword_text,platform,date' },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days') ?? '7');
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(Math.trunc(daysParam), 1), 90) : 7;
  const platform = request.nextUrl.searchParams.get('platform');
  if (platform && !isValidPlatform(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let query = supabaseAdmin
    .from('keyword_performance_daily')
    .select('*')
    .gte('date', startDate.toISOString().slice(0, 10))
    .order('date', { ascending: false });

  if (platform) query = query.eq('platform', platform);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
