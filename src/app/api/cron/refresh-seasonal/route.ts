/**
 * GET /api/cron/refresh-seasonal
 *
 * 매월 1일 04:00 UTC (KST 13:00) 자동 실행.
 * destination_climate.seasonal_signals 를 최근 12개월 데이터로 재빌드.
 *
 * Pipeline (서버사이드 fetch):
 *   1. destination_climate 모든 row 로드 (primary_city별 그룹)
 *   2. Naver DataLab API → 최근 12개월 검색 트렌드 (한국인 인기도)
 *   3. Wikipedia 한국어 페이지뷰 API → 같은 12개월 페이지뷰 (보조 신호)
 *   4. synthesizeSignals → popularity_score(0-100) + 자동 라벨/배지
 *   5. seasonal_signals jsonb UPSERT
 *
 * 결과: 매월 1회 destination별 시즌성 자동 갱신. 사장님 손 0%.
 *
 * 학술적 근거:
 *   - ScienceDirect 2023: Wikipedia 페이지뷰 12개월 시즌성 검증
 *   - ACM (Hinnosaar): 페이지뷰가 월별 방문자 변동 가장 잘 설명
 *
 * 보호:
 *   - CRON_SECRET 필요 (Vercel Cron 헤더)
 *   - Naver chunk 5개씩, 호출 사이 500ms sleep
 *   - 한 destination이 실패해도 나머지 진행
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import {
  fetchNaverTrend, fetchWikiPageviews, synthesizeSignals,
  type SeasonalSignal,
} from '@/lib/seasonal-signals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5분 + buffer

// destination별 검색 키워드 (build_seasonal.js의 KEYWORD_MAP과 동기화 필요)
const KEYWORD_MAP: Record<string, string[]> = {
  '장가계': ['장가계', '장가계여행'],
  '칭다오': ['칭다오', '청도', '칭다오여행'],
  '서안': ['서안', '시안', '서안여행'],
  '석가장': ['석가장', '태항산'],
  '천진': ['천진', '톈진', '천진여행'],
  '베이징': ['베이징', '북경', '북경여행'],
  '구채구': ['구채구', '주자이거우'],
  '란주': ['란주', '란저우'],
  '황산': ['황산', '황산여행'],
  '라싸': ['라싸', '티벳', '티베트'],
  '호화호특': ['호화호특', '후허하오터', '내몽골'],
  '시즈오카': ['시즈오카', '시즈오카여행'],
  '나가사키': ['나가사키', '나가사키여행'],
  '삿포로': ['삿포로', '북해도', '홋카이도'],
  '후쿠오카': ['후쿠오카', '후쿠오카여행'],
  '오사카': ['오사카', '오사카여행'],
  '나하': ['오키나와', '나하', '오키나와여행'],
  '나트랑': ['나트랑', '냐짱', '나트랑여행'],
  '다낭': ['다낭', '다낭여행', '호이안'],
  '하노이': ['하노이', '하롱베이', '하노이여행'],
  '푸꾸옥': ['푸꾸옥', '푸꾸옥여행'],
  '호치민': ['호치민', '사이공', '호치민여행'],
  '보홀': ['보홀', '보홀여행'],
  '세부': ['세부', '세부여행'],
  '치앙마이': ['치앙마이', '치앙라이', '치앙마이여행'],
  '비엔티엔': ['비엔티엔', '라오스', '루앙프라방', '방비엥'],
  '울란바토르': ['울란바토르', '몽골', '몽골여행'],
  '덴파사르': ['발리', '덴파사르', '발리여행'],
  '쿠알라룸푸르': ['쿠알라룸푸르', '말레이시아', '싱가포르'],
  '마카오': ['마카오', '홍콩', '마카오여행'],
  '타이페이': ['타이페이', '타이베이', '대만'],
};

function rangeForLast12Months() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0);     // 지난달 말일
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1); // 12개월 전 시작일
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtYM = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return {
    naverStart: fmt(start), naverEnd: fmt(end),
    wikiStart: fmtYM(start), wikiEnd: fmtYM(end),
  };
}

async function handleRefresh(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'supabase 미설정' }, { status: 500 });

  // Vercel Cron 인증
  const auth = req.headers.get('authorization') ?? '';
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret && auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from('destination_climate')
    .select('destination, primary_city, fitness_scores');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // primary_city별 그룹
  const byCity = new Map<string, { primary_city: string; members: { destination: string; fitness_scores: unknown }[] }>();
  for (const r of rows ?? []) {
    if (!byCity.has(r.primary_city)) byCity.set(r.primary_city, { primary_city: r.primary_city, members: [] });
    byCity.get(r.primary_city)!.members.push(r);
  }

  const groups = [...byCity.values()];
  const { naverStart, naverEnd, wikiStart, wikiEnd } = rangeForLast12Months();

  // 1) Naver — 5개씩
  const cityNaver = new Map<string, { period: string; ratio: number }[]>();
  for (let i = 0; i < groups.length; i += 5) {
    const chunk = groups.slice(i, i + 5);
    const keywordGroups = chunk.map(c => ({
      groupName: c.primary_city,
      keywords: KEYWORD_MAP[c.primary_city] || [c.primary_city],
    }));
    try {
      const resp = await fetchNaverTrend(keywordGroups, naverStart, naverEnd);
      for (const res of resp.results) {
        cityNaver.set(res.title, res.data);
      }
    } catch {
      for (const c of chunk) cityNaver.set(c.primary_city, []);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // 2) Wikipedia
  const cityWiki = new Map<string, { year: number; month: number; views: number }[]>();
  for (const g of groups) {
    try {
      const data = await fetchWikiPageviews(g.primary_city, wikiStart, wikiEnd);
      cityWiki.set(g.primary_city, data);
    } catch {
      cityWiki.set(g.primary_city, []);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 3) 합성 + UPSERT
  let updated = 0, failed = 0;
  for (const g of groups) {
    const naver = cityNaver.get(g.primary_city) || [];
    const wiki = cityWiki.get(g.primary_city) || [];
    for (const m of g.members) {
      const climateScores = (Array.isArray(m.fitness_scores) ? m.fitness_scores as { month: number; score: number }[] : [])
        .map(s => ({ month: Number(s.month), score: Number(s.score) }));
      const signals: SeasonalSignal[] = synthesizeSignals(naver, wiki, climateScores);
      const { error: uErr } = await supabaseAdmin
        .from('destination_climate')
        .update({ seasonal_signals: signals })
        .eq('destination', m.destination);
      if (uErr) failed++; else updated++;
    }
  }

  return NextResponse.json({ ok: true, updated, failed, cities: groups.length });
}

export const GET = withCronLogging('refresh-seasonal', handleRefresh);
