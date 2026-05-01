/**
 * 시즌 캘린더 토픽 생성기
 *
 * 분기마다 1회 Claude/Gemini 에게 "다음 3개월 여행 시즌 키워드" 생성시켜 DB 저장.
 * 매주 월요일 blog-scheduler 가 이 풀에서 N개 뽑아 큐에 주입.
 *
 * Fallback: AI 키 없으면 하드코딩된 월별 기본 토픽 사용 (파이프라인 정지 방지).
 */

import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { supabaseAdmin } from './supabase';

export interface SeasonalTopicSeed {
  year_month: string;
  topic: string;
  keywords: string[];
  destination?: string | null;
  season_tag?: string | null;
}

// AI 키 없을 때 쓰는 최소 한국인 여행 시즌 토픽 — 실제론 AI 로 대체됨
const FALLBACK_MONTHLY: Record<string, SeasonalTopicSeed[]> = {
  '01': [
    { year_month: '', topic: '설연휴 해외여행 준비 체크리스트', keywords: ['설연휴', '해외여행'], season_tag: '설연휴' },
    { year_month: '', topic: '1월 동남아 여행 기온과 옷차림', keywords: ['1월', '동남아', '기온'], season_tag: '겨울' },
    { year_month: '', topic: '1월 비수기 항공권 저렴한 시기', keywords: ['1월', '비수기', '항공권'], season_tag: '비수기' },
  ],
  '02': [
    { year_month: '', topic: '2월 졸업여행 추천 목적지', keywords: ['2월', '졸업여행'], season_tag: '졸업시즌' },
    { year_month: '', topic: '겨울 끝자락 따뜻한 휴양지', keywords: ['겨울', '휴양지'], season_tag: '겨울' },
  ],
  '03': [
    { year_month: '', topic: '3월 봄맞이 해외여행 추천', keywords: ['3월', '봄'], season_tag: '봄' },
    { year_month: '', topic: '봄 벚꽃 여행 해외 명소', keywords: ['벚꽃', '봄여행'], season_tag: '봄' },
  ],
  '04': [
    { year_month: '', topic: '4월 가족여행 추천지', keywords: ['4월', '가족여행'], season_tag: '봄' },
    { year_month: '', topic: '어버이날 해외여행 상품', keywords: ['어버이날', '효도여행'], season_tag: '봄' },
  ],
  '05': [
    { year_month: '', topic: '어린이날 해외여행 추천', keywords: ['어린이날', '가족'], season_tag: '황금연휴' },
    { year_month: '', topic: '5월 황금연휴 여행지', keywords: ['5월', '황금연휴'], season_tag: '황금연휴' },
  ],
  '06': [
    { year_month: '', topic: '6월 초여름 해외 휴양지', keywords: ['6월', '초여름'], season_tag: '여름' },
    { year_month: '', topic: '여름 방학 대비 조기 예약 팁', keywords: ['여름방학', '조기예약'], season_tag: '성수기준비' },
  ],
  '07': [
    { year_month: '', topic: '7월 여름휴가 베스트 목적지', keywords: ['여름휴가', '7월'], season_tag: '성수기' },
    { year_month: '', topic: '장마 피하는 해외 여행지', keywords: ['장마', '피서'], season_tag: '여름' },
  ],
  '08': [
    { year_month: '', topic: '8월 여름휴가 막바지 상품', keywords: ['8월', '막바지'], season_tag: '성수기' },
    { year_month: '', topic: '여름 피서 가족여행지', keywords: ['피서', '가족여행'], season_tag: '여름' },
  ],
  '09': [
    { year_month: '', topic: '9월 추석연휴 해외여행', keywords: ['추석', '연휴'], season_tag: '추석연휴' },
    { year_month: '', topic: '가을 단풍 해외 명소', keywords: ['단풍', '가을여행'], season_tag: '가을' },
  ],
  '10': [
    { year_month: '', topic: '10월 가을 해외 여행지', keywords: ['10월', '가을'], season_tag: '가을' },
    { year_month: '', topic: '가을 트래킹 추천 코스', keywords: ['트래킹', '가을'], season_tag: '가을' },
  ],
  '11': [
    { year_month: '', topic: '11월 비수기 해외여행 꿀팁', keywords: ['11월', '비수기'], season_tag: '비수기' },
    { year_month: '', topic: '초겨울 따뜻한 휴양지 추천', keywords: ['초겨울', '휴양지'], season_tag: '겨울시작' },
  ],
  '12': [
    { year_month: '', topic: '연말연시 해외여행 상품', keywords: ['연말', '연시'], season_tag: '연말' },
    { year_month: '', topic: '겨울 스키 + 온천 투어', keywords: ['스키', '온천'], season_tag: '겨울' },
  ],
};

function getFallbackForMonth(yearMonth: string): SeasonalTopicSeed[] {
  const mm = yearMonth.split('-')[1];
  const list = FALLBACK_MONTHLY[mm] || [];
  return list.map(t => ({ ...t, year_month: yearMonth }));
}

/**
 * 다음 3개월치 시즌 토픽을 AI 로 생성해 DB 에 저장
 * 이미 해당 year_month 에 토픽 존재하면 skip.
 */
export async function generateNextQuarterTopics(opts?: { force?: boolean }): Promise<{
  inserted: number;
  skipped: number;
  months: string[];
}> {
  const now = new Date();
  const targetMonths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    targetMonths.push(ym);
  }

  let inserted = 0;
  let skipped = 0;

  for (const ym of targetMonths) {
    if (!opts?.force) {
      const { count } = await supabaseAdmin
        .from('blog_seasonal_calendar')
        .select('*', { count: 'exact', head: true })
        .eq('year_month', ym);
      if ((count ?? 0) > 0) { skipped++; continue; }
    }

    const seeds = await generateMonthTopics(ym);

    if (seeds.length > 0) {
      const { error } = await supabaseAdmin
        .from('blog_seasonal_calendar')
        .insert(seeds.map(s => ({
          year_month: s.year_month,
          topic: s.topic,
          keywords: s.keywords,
          destination: s.destination ?? null,
          season_tag: s.season_tag ?? null,
        })));

      if (!error) inserted += seeds.length;
      else console.warn(`[seasonal-calendar] ${ym} insert 실패:`, error.message);
    }
  }

  return { inserted, skipped, months: targetMonths };
}

async function generateMonthTopics(yearMonth: string): Promise<SeasonalTopicSeed[]> {
  if (!hasBlogApiKey()) return getFallbackForMonth(yearMonth);

  try {

    const [year, month] = yearMonth.split('-');

    const prompt = `너는 한국 여행사의 SEO 에디터다.
${year}년 ${month}월에 한국인들이 네이버/구글에서 실제로 검색할 법한 해외여행 정보성 블로그 토픽 15개를 생성하라.

## 조건
- 시기적 맥락 반영 (국내 공휴일, 학사일정, 계절, 기상)
- 각 토픽은 검색 의도가 명확해야 함 (FAQ/가이드/비교형 우선)
- 특정 상품 광고 아닌 "정보성" — "XX 여행 준비물", "XX 비자 필요한가요?" 등
- 너무 일반적이거나 클리셰(아름다운, 환상적인) 사용 금지

## 출력 JSON (반드시 이 형식)
[
  {
    "topic": "6월 다낭 날씨와 옷차림 완벽 가이드",
    "keywords": ["6월 다낭 날씨", "다낭 옷차림", "우기"],
    "destination": "다낭",
    "season_tag": "초여름"
  }
]

- destination 이 특정 국가/도시가 아니라 일반 토픽이면 null
- keywords 2~4개
- 정확히 15개`;

    const text = await generateBlogJSON(prompt, { temperature: 0.4 });
    const parsed = JSON.parse(text) as Array<Omit<SeasonalTopicSeed, 'year_month'>>;
    return parsed.map(p => ({ ...p, year_month: yearMonth }));
  } catch (err) {
    console.warn(`[seasonal-calendar] ${yearMonth} AI 생성 실패 — fallback 사용:`, err);
    return getFallbackForMonth(yearMonth);
  }
}

/**
 * 아직 사용 안 한 시즌 토픽 N개 추출 (used=false).
 * 현재 월 + 다음 월 우선.
 */
export async function pickSeasonalTopics(limit: number): Promise<SeasonalTopicSeed[]> {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  const { data } = await supabaseAdmin
    .from('blog_seasonal_calendar')
    .select('*')
    .in('year_month', [thisMonth, nextMonth])
    .eq('used', false)
    .order('year_month', { ascending: true })
    .limit(limit);

  return (data || []) as SeasonalTopicSeed[];
}
