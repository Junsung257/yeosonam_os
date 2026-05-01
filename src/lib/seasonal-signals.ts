/**
 * 시즌 시그널 — Naver DataLab + Wikipedia 페이지뷰 자동 합성
 *
 * 산출물: 12개월 popularity_score(한국인 인기도, 0-100) + 시즌 라벨
 *
 * 데이터 출처
 *   ① Naver DataLab API (한국인 검색량, 가중 0.7)
 *   ② Wikipedia 한국어 페이지뷰 (글로벌 검증, 가중 0.3)
 *
 * 학술적 근거:
 *   - ScienceDirect 2023: Wikipedia 페이지뷰가 12개월 시즌성을 명확히 보임
 *   - ACM (Hinnosaar et al.): pageviews → 월별 방문자 변동 가장 잘 설명
 *
 * 모든 점수는 결정론적 산식 (LLM 의존 0). 라벨 텍스트도 데이터 기반 규칙으로 생성.
 */

export interface SeasonalSignal {
  month: number;             // 1-12
  naver_idx: number;         // 평균 1.0 기준 비율 (0이면 데이터 없음)
  naver_ratio: number;       // Naver DataLab 원본 비율 (max=100)
  wiki_idx: number;          // 평균 1.0 기준 비율
  wiki_views: number;        // Wikipedia 한국어 월 페이지뷰
  seasonality_index: number; // 합성 (0.7 × naver + 0.3 × wiki)
  agreement: number;         // 두 출처 일치도 (0~1)
  popularity_score: number;  // 0-100 (한국인 인기도)
  label: string;             // "한국인 매우 인기 시즌" 등 자동 라벨
  badge: string | null;      // 시즌 칩 텍스트 (예: "❄️ 눈여행 시즌") — climate 충돌 시 표시
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ─── Naver DataLab API ────────────────────────────────────────────

interface NaverDataLabResp {
  results: Array<{
    title: string;
    keywords: string[];
    data: Array<{ period: string; ratio: number }>;
  }>;
}

/**
 * Naver DataLab — 5개 키워드 그룹까지 단일 호출 (rate limit 절약).
 * keywordGroups: [{ groupName: 'destination', keywords: [...] }]
 */
export async function fetchNaverTrend(
  keywordGroups: { groupName: string; keywords: string[] }[],
  startDate: string,
  endDate: string,
): Promise<NaverDataLabResp> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('NAVER_CLIENT_ID/SECRET 미설정');

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startDate, endDate, timeUnit: 'month', keywordGroups }),
  });
  if (!res.ok) throw new Error(`Naver ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Wikipedia 한국어 페이지뷰 ─────────────────────────────────────

/** 한 article의 월별 페이지뷰 (Wikimedia Analytics REST API, 키 불필요) */
export async function fetchWikiPageviews(
  articleTitle: string,
  startYYYYMM: string, // "202401"
  endYYYYMM: string,
): Promise<{ year: number; month: number; views: number }[]> {
  const encoded = encodeURIComponent(articleTitle.replace(/ /g, '_'));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ko.wikipedia/all-access/all-agents/${encoded}/monthly/${startYYYYMM}0100/${endYYYYMM}0100`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'yeosonam-os-research/1.0 (zzbaa0317@gmail.com)' },
  });
  if (res.status === 404) return []; // 페이지 없음
  if (!res.ok) throw new Error(`Wikipedia ${res.status}: ${await res.text()}`);
  const data = await res.json() as { items?: Array<{ timestamp: string; views: number }> };
  return (data.items ?? []).map(x => ({
    year: Number(x.timestamp.slice(0, 4)),
    month: Number(x.timestamp.slice(4, 6)),
    views: x.views,
  }));
}

// ─── 시그널 합성 ──────────────────────────────────────────────────

/** 월별 합계 → 12개월 평균 인덱스 (1.0 = 평균) */
function monthlyIndex(values: { month: number; value: number }[]): Map<number, { idx: number; raw: number }> {
  const byMonth = new Map<number, number[]>();
  for (const v of values) {
    if (!byMonth.has(v.month)) byMonth.set(v.month, []);
    byMonth.get(v.month)!.push(v.value);
  }
  const monthAvg = new Map<number, number>();
  for (const [m, arr] of byMonth) {
    monthAvg.set(m, arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  const totalAvg = [...monthAvg.values()].reduce((a, b) => a + b, 0) / Math.max(1, monthAvg.size);
  if (!totalAvg) return new Map();

  const result = new Map<number, { idx: number; raw: number }>();
  for (const m of MONTHS) {
    const v = monthAvg.get(m) ?? 0;
    result.set(m, { idx: v / totalAvg, raw: v });
  }
  return result;
}

/** popularity_score 산출 (0-100) */
function popularityScore(idx: number): number {
  // idx 1.0 → 50점 / 1.5 → 90 / 0.5 → 10
  return Math.round(Math.max(0, Math.min(100, 50 + (idx - 1) * 80)));
}

/**
 * 데이터 기반 자동 라벨 생성 (LLM 없음, 결정론적).
 * climate context와 결합해 "추워도 가는 인기 시즌" 류 합성.
 */
function autoLabel(
  idx: number,
  climateScore: number,
  month: number,
): { label: string; badge: string | null } {
  // 인기 시즌
  if (idx >= 1.30) {
    if (climateScore < 35) return { label: '한국인 매우 인기 시즌', badge: badgeFor(month, climateScore, 'snow_or_special') };
    return { label: '한국인 매우 인기 시즌', badge: badgeFor(month, climateScore, 'peak') };
  }
  if (idx >= 1.15) {
    if (climateScore < 35) return { label: '한국인 인기 시즌', badge: badgeFor(month, climateScore, 'snow_or_special') };
    return { label: '한국인 인기 시즌', badge: badgeFor(month, climateScore, 'peak') };
  }
  if (idx >= 0.95) return { label: '평균 수준', badge: null };
  if (idx >= 0.80) return { label: '비수기 (수요 ↓)', badge: null };
  return { label: '비수기 (수요 매우 낮음)', badge: null };
}

/**
 * 시즌 칩 자동 라벨 — climate score 와 인기도 충돌 시(점수 낮은데 인기 높음) 더 풍부하게.
 * 진짜 origin 정보는 P1에서 Wikivoyage 텍스트로 보강 가능.
 */
function badgeFor(month: number, climate: number, type: 'snow_or_special' | 'peak'): string | null {
  if (type === 'snow_or_special') {
    // 추운데 인기 = 눈/온천 시즌 가능성 (12-2월)
    if (month >= 12 || month <= 2) return '❄️ 눈여행·온천 시즌';
    // 우기인데 인기 = 한국 휴가 시즌 (5-9월)
    if (month >= 5 && month <= 9) return '☔ 우기지만 한국 휴가 시즌';
    return '🎯 시즌 이벤트 추정';
  }
  // peak: 평범한 인기 시즌
  if (month === 1 || month === 2) return '🇰🇷 설·겨울 휴가 시즌';
  if (month >= 3 && month <= 5) return '🌸 봄 여행 시즌';
  if (month >= 6 && month <= 8) return '☀️ 여름 휴가 시즌';
  if (month >= 9 && month <= 11) return '🍁 가을 여행 시즌';
  return '⭐ 한국인 선호 시즌';
}

/**
 * Naver + Wikipedia 데이터 → 12개월 SeasonalSignal 배열.
 *
 * @param naverData    Naver DataLab 결과의 한 그룹 data 배열 ({period, ratio}[])
 * @param wikiData     Wikipedia 페이지뷰 결과 ({year, month, views}[])
 * @param climateScores destination_climate.fitness_scores (12개) — 충돌 검출용
 */
export function synthesizeSignals(
  naverData: { period: string; ratio: number }[],
  wikiData: { year: number; month: number; views: number }[],
  climateScores: { month: number; score: number }[],
): SeasonalSignal[] {
  // 인덱스 계산
  const naverIdx = monthlyIndex(
    naverData.map(d => ({ month: Number(d.period.slice(5, 7)), value: d.ratio })),
  );
  const wikiIdx = monthlyIndex(
    wikiData.map(d => ({ month: d.month, value: d.views })),
  );

  return MONTHS.map(month => {
    const n = naverIdx.get(month);
    const w = wikiIdx.get(month);
    const naver_idx = Number((n?.idx ?? 0).toFixed(3));
    const wiki_idx = Number((w?.idx ?? 0).toFixed(3));
    const naver_ratio = Number((n?.raw ?? 0).toFixed(2));
    const wiki_views = Math.round(w?.raw ?? 0);

    // Naver 우선 (0.7) — 한국인 직접 데이터. Wiki 없으면 Naver 단독.
    let seasonality_index: number;
    if (naver_idx > 0 && wiki_idx > 0) {
      seasonality_index = 0.7 * naver_idx + 0.3 * wiki_idx;
    } else if (naver_idx > 0) {
      seasonality_index = naver_idx;
    } else if (wiki_idx > 0) {
      seasonality_index = wiki_idx;
    } else {
      seasonality_index = 1.0; // fallback
    }
    seasonality_index = Number(seasonality_index.toFixed(3));

    const agreement = (naver_idx > 0 && wiki_idx > 0)
      ? 1 - Math.abs(naver_idx - wiki_idx) / Math.max(naver_idx, wiki_idx)
      : 0.5;
    const agreement_fixed = Number(agreement.toFixed(2));

    const popularity_score = popularityScore(seasonality_index);
    const climate = climateScores.find(c => c.month === month)?.score ?? 50;
    const { label, badge } = autoLabel(seasonality_index, climate, month);

    return {
      month, naver_idx, naver_ratio, wiki_idx, wiki_views,
      seasonality_index, agreement: agreement_fixed, popularity_score, label, badge,
    };
  });
}
