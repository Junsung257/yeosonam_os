import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { collectAllTrends, classifyKeywordTier, detectDestination } from '@/lib/keyword-research';
import { classifySearchIntent } from '@/lib/blog-search-intent';
import { withCronLogging } from '@/lib/cron-observability';

/**
 * 트렌드 토픽 마이너 — 매일 06:00 KST (21:00 UTC) 실행
 *
 * 흐름:
 *   1) Google Trends RSS + Naver News + DataLab 통합 수집
 *   2) trend_keyword_archive 에 영구 INSERT (시계열 분석용)
 *   3) 우리 destination 매칭된 항목만 blog_topic_queue 로 변환
 *      (active destination + score >= 30 + 최근 7일 미발행)
 *   4) priority=70, source='trend', keyword_tier 자동 분류
 *
 * Why: 시즌 토픽(미리 만든 것)은 좋지만 "지금 한국인이 검색하는 것"을 따라잡지 못함.
 *      트렌드 마이너가 매일 신선한 토픽을 큐에 주입 → 검색 의도 즉시 대응.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const MAX_TOPICS_PER_DAY = 5;        // 트렌드는 노이즈 많음 — 상위 5개만
const MIN_TREND_SCORE = 30;
const PRIORITY_TREND = 70;

async function runTrendMiner(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];
  const observed_at = new Date().toISOString();

  // 1) 트렌드 수집
  const trends = await collectAllTrends().catch(err => {
    errors.push(`수집 실패: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });

  if (trends.length === 0) {
    return { collected: 0, archived: 0, queued: 0, errors, message: '수집된 트렌드 없음' };
  }

  // 2) 활성 destination 화이트리스트 (있는 destination만 큐에 넣음)
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('destination')
    .in('status', ['approved', 'active']);
  const activeDestinations = new Set(
    ((pkgs || []) as Array<{ destination: string | null }>)
      .map(p => p.destination)
      .filter((d): d is string => Boolean(d))
  );

  // 3) trend_keyword_archive 일괄 저장 (UNIQUE: observed_at,source,keyword 충돌은 무시)
  const archiveRows = trends.map(t => ({
    observed_at,
    source: t.source,
    keyword: t.keyword,
    related_destination: t.related_destination ?? null,
    trend_score: t.trend_score ?? null,
    search_volume: t.search_volume ?? null,
    raw: t.raw ?? {},
  }));

  let archived = 0;
  if (archiveRows.length > 0) {
    const { error: archErr } = await supabaseAdmin
      .from('trend_keyword_archive')
      .upsert(archiveRows, { onConflict: 'observed_at,source,keyword', ignoreDuplicates: true });
    if (archErr) errors.push(`archive 실패: ${archErr.message}`);
    else archived = archiveRows.length;
  }

  // 4) 큐잉 후보 선별:
  //    - destination 매칭됨 + 활성 카탈로그
  //    - trend_score >= MIN
  //    - 최근 14일 내 같은 키워드/destination 큐 없음
  const candidates = trends
    .filter(t => {
      if ((t.trend_score ?? 0) < MIN_TREND_SCORE) return false;
      const dest = t.related_destination || detectDestination(t.keyword);
      return dest && activeDestinations.has(dest);
    })
    .sort((a, b) => (b.trend_score ?? 0) - (a.trend_score ?? 0))
    .slice(0, MAX_TOPICS_PER_DAY);

  if (candidates.length === 0) {
    return { collected: trends.length, archived, queued: 0, errors, message: '큐잉 후보 없음' };
  }

  // 중복 방어 — 14일 내 같은 keyword 토픽 큐 존재하면 스킵
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data: recent } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('primary_keyword, destination')
    .gte('created_at', since.toISOString())
    .in('source', ['trend', 'seasonal']);
  const recentKeys = new Set(
    ((recent || []) as Array<{ primary_keyword: string | null; destination: string | null }>)
      .map(r => `${r.destination || ''}::${r.primary_keyword || ''}`)
  );

  const queueRows: any[] = [];
  const poolRowsPending: Array<{
    keyword: string;
    source: string;
    related_destination: string;
    trend_score: number | null;
    search_intent: ReturnType<typeof classifySearchIntent>;
    raw: object;
  }> = [];
  const archiveLink: Array<{ keyword: string; observed_at: string; source: string }> = [];

  for (const c of candidates) {
    const dest = c.related_destination || detectDestination(c.keyword)!;
    const key = `${dest}::${c.keyword}`;
    if (recentKeys.has(key)) continue;

    const tier = classifyKeywordTier(c.keyword, c.search_volume);
    // 토픽 생성: "{destination} {trend keyword} 여행 가이드"
    const topic = c.keyword.includes('여행')
      ? `지금 뜨는 ${c.keyword} — 검색량 급등 분석`
      : `${dest} ${c.keyword} — 최신 트렌드 가이드`;

    poolRowsPending.push({
      keyword: c.keyword,
      source: c.source,
      related_destination: dest,
      trend_score: c.trend_score ?? null,
      search_intent: classifySearchIntent(c.keyword),
      raw: (c as { raw?: object }).raw ?? {},
    });

    queueRows.push({
      topic,
      source: 'trend',
      priority: PRIORITY_TREND,
      destination: dest,
      angle_type: 'trend',
      category: 'travel_tips',
      primary_keyword: c.keyword,
      keyword_tier: tier,
      monthly_search_volume: c.search_volume ?? null,
      competition_level: tier === 'head' ? 'high' : tier === 'mid' ? 'medium' : 'low',
      trend_score: c.trend_score ?? null,
      meta: {
        keywords: [c.keyword, dest],
        trend_source: c.source,
        raw: c.raw,
        search_intent: classifySearchIntent(c.keyword),
      },
    });
    archiveLink.push({ keyword: c.keyword, observed_at, source: c.source });
  }

  let queued = 0;
  if (queueRows.length > 0) {
    const { data: inserted, error: qErr } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert(queueRows)
      .select('id, primary_keyword');
    if (qErr) {
      errors.push(`큐 INSERT 실패: ${qErr.message}`);
    } else {
      queued = inserted?.length ?? 0;
      // 아카이브에 used_at + topic_queue_id 연결
      if (inserted && inserted.length > 0) {
        const updates = inserted.map((row: any) => {
          const link = archiveLink.find(l => l.keyword === row.primary_keyword);
          return link ? {
            ...link,
            used_at: new Date().toISOString(),
            topic_queue_id: row.id,
          } : null;
        }).filter(Boolean);

        for (const u of updates) {
          await supabaseAdmin
            .from('trend_keyword_archive')
            .update({ used_at: u!.used_at, topic_queue_id: u!.topic_queue_id })
            .eq('observed_at', u!.observed_at)
            .eq('source', u!.source)
            .eq('keyword', u!.keyword);
        }
      }
    }
  }

  return {
    collected: trends.length,
    archived,
    queued,
    candidates: candidates.length,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('trend-topic-miner', runTrendMiner);
