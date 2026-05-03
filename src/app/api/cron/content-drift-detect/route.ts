import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const maxDuration = 60;

// 최소 기준 — 이 이상 급증한 키워드만 드리프트로 판정
const DRIFT_RATIO_THRESHOLD = 1.8; // 지난주 대비 80%+ 증가
const MIN_WEEKLY_COUNT = 3;        // 최소 3회 이상 등장한 키워드만

interface TrendRow {
  keyword: string;
  related_destination: string | null;
  trend_score: number | null;
  observed_at: string;
}

interface KeywordStat {
  count: number;
  avgScore: number;
  destinations: Set<string>;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });

  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const day7ago = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const day14ago = new Date(now.getTime() - 14 * 86400_000).toISOString();

    // 지난 14일 트렌드 아카이브 조회
    const { data: rows, error } = await supabaseAdmin
      .from('trend_keyword_archive')
      .select('keyword, related_destination, trend_score, observed_at')
      .gte('observed_at', day14ago)
      .order('observed_at', { ascending: true });

    if (error) throw error;
    if (!rows?.length) {
      return NextResponse.json({ message: '트렌드 데이터 없음', drifts: 0 });
    }

    // 이번 주 / 지난주 분리
    const thisWeek = (rows as TrendRow[]).filter((r) => r.observed_at >= day7ago);
    const lastWeek = (rows as TrendRow[]).filter((r) => r.observed_at < day7ago);

    const buildStats = (list: TrendRow[]): Map<string, KeywordStat> => {
      const m = new Map<string, KeywordStat>();
      for (const r of list) {
        const kw = r.keyword.toLowerCase().trim();
        const s = m.get(kw) ?? { count: 0, avgScore: 0, destinations: new Set<string>() };
        s.count++;
        s.avgScore += r.trend_score ?? 0;
        if (r.related_destination) s.destinations.add(r.related_destination);
        m.set(kw, s);
      }
      for (const s of m.values()) {
        s.avgScore = s.avgScore / s.count;
      }
      return m;
    };

    const thisStats = buildStats(thisWeek);
    const lastStats = buildStats(lastWeek);

    // 드리프트 키워드 탐지: 이번 주 count가 지난주 대비 DRIFT_RATIO 이상 증가
    type DriftItem = {
      keyword: string;
      thisWeekCount: number;
      lastWeekCount: number;
      ratio: number;
      avgScore: number;
      destinations: string[];
    };

    const drifts: DriftItem[] = [];

    for (const [kw, thisStat] of thisStats.entries()) {
      if (thisStat.count < MIN_WEEKLY_COUNT) continue;
      const lastStat = lastStats.get(kw);
      const lastCount = lastStat?.count ?? 0;

      // 지난주 없거나 급증한 경우
      const ratio =
        lastCount === 0 ? thisStat.count : thisStat.count / lastCount;

      if (ratio >= DRIFT_RATIO_THRESHOLD) {
        drifts.push({
          keyword: kw,
          thisWeekCount: thisStat.count,
          lastWeekCount: lastCount,
          ratio: Math.round(ratio * 10) / 10,
          avgScore: Math.round(thisStat.avgScore),
          destinations: [...thisStat.destinations],
        });
      }
    }

    drifts.sort((a, b) => b.ratio - a.ratio);
    const topDrifts = drifts.slice(0, 8);

    if (topDrifts.length === 0) {
      return NextResponse.json({ thisWeek: thisStats.size, drifts: 0 });
    }

    // Slack 역제안
    const lines = topDrifts.map(
      (d) =>
        `• *${d.keyword}* — ${d.lastWeekCount}회 → ${d.thisWeekCount}회 (×${d.ratio})` +
        (d.destinations.length ? ` [${d.destinations.join(', ')}]` : ''),
    );

    await sendSlackAlert(
      `📡 [콘텐츠 드리프트] 이번 주 급증 키워드 ${topDrifts.length}개 감지`,
      {
        items: lines,
        action: '👉 관련 공지·블로그 업데이트 검토 필요',
        period: `${day7ago.slice(0, 10)} ~ ${now.toISOString().slice(0, 10)}`,
      },
    );

    return NextResponse.json({
      thisWeek: thisStats.size,
      lastWeek: lastStats.size,
      drifts: topDrifts.length,
      topDrifts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendSlackAlert(`[content-drift-detect] 크론 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
