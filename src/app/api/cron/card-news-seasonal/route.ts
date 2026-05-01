/**
 * @file src/app/api/cron/card-news-seasonal/route.ts
 *
 * 매주 월요일 09:00 KST — 시즈널 카드뉴스 자동 변형 풀 생성.
 *
 * 동작:
 *   1. 현재 월의 시즌 컨텍스트 조회 (themes, toneHint, preferredAngles)
 *   2. travel_packages 에서 시즌 적합도 높은 후보 N개 자동 선정
 *      - 출발일 4~12주 이내 (충분한 광고 노출 시간)
 *      - status='approved' 또는 'active'
 *      - 같은 destination 으로 최근 14일 내 이미 카드뉴스 있으면 제외
 *   3. 후보별로 generate-variants 호출 (시즌 preferredAngles 기준)
 *   4. 결과: variant_group_id 목록 + 비용
 *
 * 보호:
 *   - max_per_run = 2 (그룹) — 한 번 실행에 2 그룹 × 5변형 = 10건. 비용 ~$3
 *   - 동일 destination 중복 방지
 *
 * Vercel cron: "0 0 * * 1" UTC = 월요일 09:00 KST.
 * 인증: x-vercel-cron 또는 CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSeasonalContext } from '@/lib/card-news-html/seasonal';
import { getPackageRawText } from '@/lib/packages/raw-text';

export const runtime = 'nodejs';
export const maxDuration = 300; // Hobby plan 상한(300s). 2 그룹 처리는 MAX_GROUPS_PER_RUN로 분할.

const MAX_GROUPS_PER_RUN = 2;
const SAME_DESTINATION_LOOKBACK_DAYS = 14;

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const authorized =
    isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY 미설정' },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  const ctx = getSeasonalContext();

  // 1. 출발일 4~12주 이내 후보 상품 조회
  const now = Date.now();
  const minDate = new Date(now + 4 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const maxDate = new Date(now + 12 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, duration, nights, departure_dates, products(selling_price)')
    .or('status.eq.approved,status.eq.active')
    .not('departure_dates', 'is', null)  // 출발일 없는 상품 DB 단계 제외
    .order('created_at', { ascending: false })
    .limit(50);

  if (candErr) {
    return NextResponse.json({ error: candErr.message }, { status: 500 });
  }

  // 2. 최근 14일 내 카드뉴스 만든 destination 제외
  const cutoff = new Date(now - SAME_DESTINATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from('card_news')
    .select('package_id')
    .gte('created_at', cutoff);
  const recentPackageIds = new Set(
    ((recent ?? []) as Array<{ package_id: string | null }>)
      .map((r) => r.package_id)
      .filter((id): id is string => !!id),
  );

  // 3. 출발일 윈도우 + 중복 제외
  type Candidate = {
    id: string;
    title: string;
    destination: string | null;
    duration: number | null;
    nights: number | null;
    departure_dates: string[] | null;
    products?: { selling_price?: number | null } | null;
  };
  const fitsSeason = (c: Candidate): boolean => {
    if (recentPackageIds.has(c.id)) return false;
    const dates = Array.isArray(c.departure_dates) ? c.departure_dates : [];
    return dates.some((d) => typeof d === 'string' && d >= minDate && d <= maxDate);
  };
  const eligible = ((candidates ?? []) as Candidate[]).filter(fitsSeason);
  const selected = eligible.slice(0, MAX_GROUPS_PER_RUN);

  if (selected.length === 0) {
    return NextResponse.json({
      season: ctx,
      eligible_count: 0,
      generated: [],
      reason: '시즌 윈도우(4-12주) 후보 없음 또는 모두 최근 카드뉴스 있음',
      duration_ms: Date.now() - startedAt,
    });
  }

  // 4. 각 상품에 대해 generate-variants 호출
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const generated: Array<{
    package_id: string;
    title: string;
    variant_group_id?: string;
    success_count?: number;
    totalCostUsd?: number;
    error?: string;
  }> = [];

  for (const pkg of selected) {
    try {
      // raw-text 직접 호출 (self-fetch 제거)
      const rawResult = await getPackageRawText(pkg.id);
      if (!rawResult.ok) {
        generated.push({
          package_id: pkg.id,
          title: pkg.title,
          error: rawResult.error,
        });
        continue;
      }
      const { rawText, productMeta } = rawResult.data;

      // generate-variants 는 DB INSERT 부수효과가 있어 별도 라우트 호출 유지.
      // 추후 동일 패턴으로 lib 함수 분리 가능.
      const variantsRes = await fetch(`${baseUrl}/api/card-news/generate-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          productMeta,
          package_id: pkg.id,
          title: `[${ctx.month}월 시즌] ${pkg.title}`,
          angles: ctx.preferredAngles,
          count: ctx.preferredAngles.length,
          toneHint: ctx.toneHint,
          brandCode: 'yeosonam',
          skipCritic: false,
        }),
      });
      const variantsData = await variantsRes.json();
      if (!variantsRes.ok) {
        generated.push({
          package_id: pkg.id,
          title: pkg.title,
          error: variantsData?.error ?? `HTTP ${variantsRes.status}`,
        });
        continue;
      }
      generated.push({
        package_id: pkg.id,
        title: pkg.title,
        variant_group_id: variantsData.variant_group_id,
        success_count: variantsData.success_count,
        totalCostUsd: variantsData.totalCostUsd,
      });
    } catch (e) {
      generated.push({
        package_id: pkg.id,
        title: pkg.title,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const totalCost = generated.reduce((sum, g) => sum + (g.totalCostUsd ?? 0), 0);

  return NextResponse.json({
    season: ctx,
    eligible_count: eligible.length,
    generated,
    total_cost_usd: totalCost,
    duration_ms: Date.now() - startedAt,
  });
}
