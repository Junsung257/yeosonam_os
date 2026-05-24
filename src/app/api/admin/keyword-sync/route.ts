/**
 * ══════════════════════════════════════════════════════════
 * 키워드 성과 동기화 API — 클라이언트 → Supabase
 * ══════════════════════════════════════════════════════════
 *
 * POST /api/admin/keyword-sync
 *   - 키워드 성과 데이터를 DB에 upsert
 *   - authenticated 세션 인증 (어드민 사용자)
 *   - body: { destination, keyword, platform, metrics }
 *
 * GET /api/admin/keyword-sync
 *   - 최근 7일 키워드 성과 조회
 *   - authenticated 세션 인증
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSecret } from '@/lib/secret-registry';

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
  destination: string;
  keyword: string;
  platform: 'google' | 'naver' | 'meta';
  metrics: SyncMetric;
}

export const dynamic = 'force-dynamic';

// ── POST: 성과 저장 ─────────────────────────────────────

export async function POST(request: NextRequest) {
  // 인증: 세션 쿠키 또는 Bearer 토큰
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Bearer 토큰 인증
  const auth = request.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  const isAuthed = (cronSecret && auth === `Bearer ${cronSecret}`) || (serviceKey && auth === `Bearer ${serviceKey}`);

  if (!isAuthed) {
    // 세션 인증 시도
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = (await request.json()) as SyncBody;
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await supabase.from('keyword_performance_daily').upsert(
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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── GET: 최근 성과 조회 ─────────────────────────────────

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Bearer 토큰 인증
  const auth = request.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  const isAuthed = (cronSecret && auth === `Bearer ${cronSecret}`) || (serviceKey && auth === `Bearer ${serviceKey}`);

  if (!isAuthed) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '7');
  const platform = searchParams.get('platform');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    let query = supabase
      .from('keyword_performance_daily')
      .select('*')
      .gte('date', startDate.toISOString().slice(0, 10))
      .order('date', { ascending: false });

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
