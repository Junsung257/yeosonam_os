/**
 * Predictive Marketing Engine — 예측 마케팅 엔진
 *
 * GSC 데이터 + 키워드 트렌드로 참고용 수요 신호와 콘텐츠 기회를 계산한다.
 *
 * 사용 통계 기법 (순수 TypeScript, 외부 ML 라이브러리 불필요):
 *   - 단순 이동평균 (Simple Moving Average)
 *   - 지수 평활 (Double Exponential Smoothing + 계절성)
 *   - 선형 추세 (Linear Trend)
 *   - 변동계수 기반 변동성 측정
 *
 * 파이프라인:
 *   GSC/트렌드 데이터 → detectTrend → forecast → findSeasonalPatterns
 *   → findKeywordOpportunities → generatePredictiveInsights
 *
 * `persistInsights`는 명시적으로 호출하는 기존 원장 helper이고,
 * `autoQueueFromInsights`는 안전 경계로서 항상 비활성 응답을 반환한다.
 */
import { supabaseAdmin } from '@/lib/supabase';

// ─── 타입 ────────────────────────────────────────────────────

export type ForecastMethod = 'seasonal_naive' | 'moving_average' | 'exponential_smoothing' | 'linear_trend';

export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  predictedValue: number;
  lowerBound?: number;
  upperBound?: number;
  confidence?: number;
}

export type TrendDirection = 'rising' | 'falling' | 'stable';
export type SeasonalPhase = 'seasonal_peak' | 'seasonal_trough';

export interface TrendSignal {
  keyword: string;
  destination: string;
  currentTrend: TrendDirection | SeasonalPhase;
  changePercent: number;
  forecast: ForecastPoint[];
  recommendation: string; // e.g. '지금 콘텐츠 준비', '발행 중단', '광고 입찰 상향'
  priority: number; // 1-100
}

export type InsightType = 'content_opportunity' | 'ad_optimization' | 'seasonal_preparation' | 'trend_alert';
export type InsightStatus = 'pending' | 'actioned' | 'dismissed' | 'expired';

export interface PredictiveInsight {
  id?: string;
  type: InsightType;
  title: string;
  description: string;
  signal: TrendSignal;
  suggestedAction: string;
  estimatedImpact: string;
  createdAt: string;
  status?: InsightStatus;
}

export interface TrendResult {
  direction: TrendDirection;
  changePercent: number;
  volatility: number; // coefficient of variation
}

export interface SeasonalPattern {
  peakMonth: number;
  averageValue: number;
  isSignificant: boolean;
}

export type KeywordOpportunityRun =
  | { status: 'ready'; signals: TrendSignal[] }
  | { status: 'data_insufficient'; signals: []; reason: string; minimumDailyPoints: number };

export type PredictiveInsightsRun =
  | { status: 'ready'; insights: PredictiveInsight[] }
  | { status: 'data_insufficient'; insights: []; reason: string; minimumDailyPoints: number };

const PREDICTIVE_MIN_DAILY_POINTS = 28;

// ─── 코어 예측 함수 ──────────────────────────────────────────

/**
 * 단순 이동평균 예측
 * @param historical - 시간순 값 배열 (마지막이 최신)
 * @param windowSize - 평균에 사용할 기간 수 (기본 7, 주간 계절성)
 * @param forecastHorizon - 예측할 미래 기간 수
 */
export function movingAverageForecast(
  historical: number[],
  windowSize: number = 7,
  forecastHorizon: number = 14,
): ForecastPoint[] {
  if (historical.length < windowSize) {
    // 데이터 부족 — 평균 가능한 최대치로 fallback
    const avg = historical.length > 0
      ? historical.reduce((a, b) => a + b, 0) / historical.length
      : 0;
    const today = new Date();
    return Array.from({ length: forecastHorizon }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return {
        date: d.toISOString().split('T')[0],
        predictedValue: Math.round(avg * 100) / 100,
      };
    });
  }

  const ma = historical.slice(-windowSize).reduce((a, b) => a + b, 0) / windowSize;
  const residuals = [];
  for (let i = windowSize; i < historical.length; i++) {
    const window = historical.slice(i - windowSize, i);
    const mean = window.reduce((a, b) => a + b, 0) / windowSize;
    residuals.push(historical[i] - mean);
  }
  const std = residuals.length > 0
    ? Math.sqrt(residuals.map(r => r * r).reduce((a, b) => a + b, 0) / residuals.length)
    : ma * 0.1;

  const today = new Date();
  return Array.from({ length: forecastHorizon }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return {
      date: d.toISOString().split('T')[0],
      predictedValue: Math.round(ma * 100) / 100,
      lowerBound: Math.round((ma - 1.96 * std) * 100) / 100,
      upperBound: Math.round((ma + 1.96 * std) * 100) / 100,
    };
  });
}

/**
 * 지수 평활 예측 (Holt-Winters 스타일 단순화)
 * 추세 + 계절성이 있는 데이터에 적합
 *
 * level_t = alpha * value_t + (1-alpha) * (level_{t-1} + trend_{t-1})
 * trend_t = beta * (level_t - level_{t-1}) + (1-beta) * trend_{t-1}
 * seasonal_t = gamma * (value_t - level_t) + (1-gamma) * seasonal_{t-period}
 * forecast_{t+h} = level_t + h * trend_t + seasonal_{t-period+h}
 */
export function exponentialSmoothingForecast(
  historical: number[],
  alpha: number = 0.3,
  beta: number = 0.1,
  gamma: number = 0.1,
  seasonalityPeriod: number = 7,
  forecastHorizon: number = 14,
): ForecastPoint[] {
  if (historical.length < 2) {
    return movingAverageForecast(historical, Math.max(1, historical.length), forecastHorizon);
  }
  if (historical.length < seasonalityPeriod + 2) {
    // 데이터 부족 — 이동평균 fallback
    return movingAverageForecast(historical, Math.max(1, Math.floor(historical.length / 2)), forecastHorizon);
  }

  // 초기화
  let level = historical[0];
  let trend = historical[1] - historical[0];

  // 초기 계절성: 첫 seasonalityPeriod 개로 패턴 추정
  const seasonal = new Array(seasonalityPeriod).fill(0);
  const baseAvg = historical.slice(0, seasonalityPeriod).reduce((a, b) => a + b, 0) / seasonalityPeriod;
  for (let i = 0; i < seasonalityPeriod && i < historical.length; i++) {
    seasonal[i] = historical[i] - baseAvg;
  }

  // Smoothing
  for (let i = 0; i < historical.length; i++) {
    const lastLevel = level;
    const seasonIdx = i % seasonalityPeriod;
    const seasonVal = seasonal[seasonIdx];
    level = alpha * historical[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - lastLevel) + (1 - beta) * trend;
    seasonal[seasonIdx] = gamma * (historical[i] - level) + (1 - gamma) * seasonVal;
  }

  // 잔차 기반 신뢰구간
  const fitted = historical.map((v, i) => {
    const idx = i % seasonalityPeriod;
    return level + trend * 0 + seasonal[idx];
  });
  const residuals = historical.map((v, i) => v - fitted[i]);
  const std = Math.sqrt(residuals.map(r => r * r).reduce((a, b) => a + b, 0) / Math.max(1, residuals.length));

  const today = new Date();
  return Array.from({ length: forecastHorizon }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const h = i + 1;
    const seasonalIdx = (historical.length - 1 + h) % seasonalityPeriod;
    const predicted = level + h * trend + seasonal[seasonalIdx];

    return {
      date: d.toISOString().split('T')[0],
      predictedValue: Math.round(predicted * 100) / 100,
      lowerBound: Math.round((predicted - 1.96 * std) * 100) / 100,
      upperBound: Math.round((predicted + 1.96 * std) * 100) / 100,
    };
  });
}

/**
 * 선형 추세 예측 (최소제곱법)
 */
export function linearTrendForecast(
  historical: number[],
  forecastHorizon: number = 14,
): ForecastPoint[] {
  const n = historical.length;
  if (n < 2) {
    return movingAverageForecast(historical, 1, forecastHorizon);
  }

  // 최소제곱법: y = a + b*x
  const xMean = (n - 1) / 2;
  const yMean = historical.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const xDev = i - xMean;
    const yDev = historical[i] - yMean;
    num += xDev * yDev;
    den += xDev * xDev;
  }

  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;

  // 잔차 표준편차
  const residuals = historical.map((v, i) => v - (intercept + slope * i));
  const std = Math.sqrt(residuals.map(r => r * r).reduce((a, b) => a + b, 0) / (n - 2 || 1));

  const today = new Date();
  return Array.from({ length: forecastHorizon }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const predicted = intercept + slope * (n + i);

    return {
      date: d.toISOString().split('T')[0],
      predictedValue: Math.round(predicted * 100) / 100,
      lowerBound: Math.round((predicted - 1.96 * std) * 100) / 100,
      upperBound: Math.round((predicted + 1.96 * std) * 100) / 100,
    };
  });
}

/**
 * 계절성 단순법 — 전년 동기 값 그대로 사용
 */
export function seasonalNaiveForecast(
  historical: number[],
  seasonalityPeriod: number = 7,
  forecastHorizon: number = 14,
): ForecastPoint[] {
  if (historical.length < seasonalityPeriod) {
    return movingAverageForecast(historical, Math.max(1, historical.length), forecastHorizon);
  }

  const today = new Date();
  return Array.from({ length: forecastHorizon }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const srcIdx = Math.max(0, historical.length - seasonalityPeriod + (i % seasonalityPeriod));
    const predicted = historical[srcIdx];

    return {
      date: d.toISOString().split('T')[0],
      predictedValue: Math.round(predicted * 100) / 100,
    };
  });
}

// ─── 트렌드 분석 ─────────────────────────────────────────────

/**
 * 트렌드 방향 탐지
 * 최근 7일 vs 이전 14일 비교
 */
export function detectTrend(values: number[]): TrendResult {
  if (values.length < 7) {
    return { direction: 'stable', changePercent: 0, volatility: 0 };
  }

  const recent = values.slice(-7);
  const older = values.slice(-21, -7);

  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderMean = older.length > 0
    ? older.reduce((a, b) => a + b, 0) / older.length
    : recentMean;

  const changePercent = olderMean > 0
    ? ((recentMean - olderMean) / olderMean) * 100
    : recentMean > 0 ? 100 : 0;

  // 변동계수 (CV) = 표준편차 / 평균
  const allMean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - allMean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const volatility = allMean > 0 ? std / allMean : 0;

  // 방향 분류
  let direction: TrendDirection;
  if (changePercent > 15) {
    direction = 'rising';
  } else if (changePercent < -15) {
    direction = 'falling';
  } else {
    direction = 'stable';
  }

  return { direction, changePercent: Math.round(changePercent * 100) / 100, volatility };
}

/**
 * 키워드 검색량에서 계절 패턴 찾기
 */
export function findSeasonalPatterns(
  dailyData: Array<{ date: string; value: number }>,
): SeasonalPattern[] {
  if (dailyData.length < 30) return [];

  // 월별 그룹핑
  const byMonth = new Map<number, number[]>();
  for (const d of dailyData) {
    const month = new Date(d.date).getMonth(); // 0-based
    const arr = byMonth.get(month) ?? [];
    arr.push(d.value);
    byMonth.set(month, arr);
  }

  const overallAvg = dailyData.reduce((s, d) => s + d.value, 0) / dailyData.length;
  const threshold = overallAvg * 1.5;

  const patterns: SeasonalPattern[] = [];
  for (const [month, values] of byMonth) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    patterns.push({
      peakMonth: month + 1, // 1-based
      averageValue: Math.round(avg * 100) / 100,
      isSignificant: avg >= threshold,
    });
  }

  return patterns.sort((a, b) => b.averageValue - a.averageValue);
}

// ─── 마케팅 전용 함수 ────────────────────────────────────────

/**
 * GSC/blog_rankings 데이터로 키워드 트렌드 분석
 * 마지막 90일 치 daily impression/click 시계열을 추출 → 예측
 */
export async function findKeywordOpportunities(): Promise<KeywordOpportunityRun> {
  const signals: TrendSignal[] = [];
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // 1) GSC 데이터 직접 수집: keyword_trend_snapshots 테이블에서 최근 90일
  const { data: snapshots } = await supabaseAdmin
    .from('keyword_trend_snapshots')
    .select('keyword, destination, date, impressions, trend_score')
    .gte('snapshot_date', since.toISOString())
    .order('date', { ascending: true })
    .limit(5000);

  if (!snapshots || snapshots.length === 0) {
    return {
      status: 'data_insufficient',
      signals: [],
      reason: 'NO_DAILY_KEYWORD_SERIES',
      minimumDailyPoints: PREDICTIVE_MIN_DAILY_POINTS,
    };
  }

  // 2) 키워드별 시계열 그룹핑
  const seriesMap = new Map<string, Array<{ date: string; value: number }>>();
  const destMap = new Map<string, string>();
  for (const row of snapshots as Array<{ keyword: string; destination: string | null; date: string; impressions: number; trend_score: number | null }>) {
    const kw = row.keyword;
    const arr = seriesMap.get(kw) ?? [];
    arr.push({ date: row.date, value: row.impressions });
    seriesMap.set(kw, arr);
    if (row.destination) destMap.set(kw, row.destination);
  }

  // 3) 각 키워드 분석
  for (const [kw, series] of seriesMap) {
    if (new Set(series.map((point) => point.date)).size < PREDICTIVE_MIN_DAILY_POINTS) continue;

    const values = series.map(s => s.value);
    const trendResult = detectTrend(values);
    const seasonalPatterns = findSeasonalPatterns(series);
    const forecast = exponentialSmoothingForecast(values, 0.3, 0.1, 0.1, 7, 14);

    // 계절성 보정
    let effectiveTrend: TrendDirection | SeasonalPhase = trendResult.direction;
    const hasPeakSoon = seasonalPatterns.some(p => {
      const nextMonth = (new Date().getMonth() + 1) % 12;
      return p.isSignificant && p.peakMonth === nextMonth + 1;
    });
    if (hasPeakSoon && trendResult.direction === 'stable') {
      effectiveTrend = 'seasonal_peak';
    }

    signals.push({
      keyword: kw,
      destination: destMap.get(kw) ?? '',
      currentTrend: effectiveTrend,
      changePercent: trendResult.changePercent,
      forecast,
      recommendation: generateRecommendation(effectiveTrend, trendResult.changePercent),
      priority: computeSignalPriority(effectiveTrend, trendResult.changePercent, series[series.length - 1]?.value ?? 0),
    });
  }

  if (signals.length === 0) {
    return {
      status: 'data_insufficient',
      signals: [],
      reason: 'NO_KEYWORD_HAS_MINIMUM_DAILY_HISTORY',
      minimumDailyPoints: PREDICTIVE_MIN_DAILY_POINTS,
    };
  }
  return { status: 'ready', signals: signals.sort((a, b) => b.priority - a.priority).slice(0, 50) };
}

function generateRecommendation(
  trend: TrendDirection | SeasonalPhase,
  changePercent: number,
): string {
  if (trend === 'rising' || trend === 'seasonal_peak') {
    if (changePercent > 50) return '긴급 — 지금 콘텐츠 준비 및 광고 입찰 상향';
    if (changePercent > 20) return '콘텐츠 발행 준비 시작, 광고 예산 증액';
    return '모니터링 유지, 2주 내 콘텐츠 준비';
  }
  if (trend === 'falling') {
    if (changePercent < -50) return '발행 중단 및 콘텐츠 리프레시 검토';
    if (changePercent < -20) return '콘텐츠 리프레시 필요, 광고 입찰 하향';
    return '현재 수준 유지, 추가 하락 모니터링';
  }
  if (trend === 'seasonal_trough') {
    return '비수기, 재발행보다 재활용 콘텐츠로 대응';
  }
  // stable
  return '현재 유지, 정기 업데이트만 수행';
}

function computeSignalPriority(
  trend: TrendDirection | SeasonalPhase,
  changePercent: number,
  baseValue: number,
): number {
  let score = 50;
  if (trend === 'rising') score += Math.min(40, Math.abs(changePercent) * 0.8);
  else if (trend === 'falling') score += Math.min(20, Math.abs(changePercent) * 0.3);
  else if (trend === 'seasonal_peak') score += 30;
  if (baseValue > 1000) score += 10;
  if (baseValue > 5000) score += 10;
  return Math.min(100, Math.round(score));
}

// ─── 인사이트 생성 ───────────────────────────────────────────

/**
 * 키워드 기회에서 예측 인사이트 생성
 * 기존 content_creatives / blog_topic_queue 와 교차 참조
 */
export async function generatePredictiveInsights(): Promise<PredictiveInsightsRun> {
  const opportunityRun = await findKeywordOpportunities();
  if (opportunityRun.status === 'data_insufficient') {
    return {
      status: 'data_insufficient',
      insights: [],
      reason: opportunityRun.reason,
      minimumDailyPoints: opportunityRun.minimumDailyPoints,
    };
  }
  const signals = opportunityRun.signals;
  const insights: PredictiveInsight[] = [];

  // 기존 콘텐츠 키워드 목록
  const { data: existingContent } = await supabaseAdmin
    .from('content_creatives')
    .select('keyword, primary_keyword, slug, channel')
    .in('channel', ['naver_blog', 'card_news'])
    .not('status', 'in', '("deleted")');

  const existingKeywords = new Set<string>();
  if (existingContent) {
    for (const row of existingContent as Array<{ keyword: string | null; primary_keyword: string | null }>) {
      if (row.keyword) existingKeywords.add(row.keyword.trim().toLowerCase());
      if (row.primary_keyword) existingKeywords.add(row.primary_keyword.trim().toLowerCase());
    }
  }

  // 예약/대기 중인 토픽
  const { data: queuedTopics } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('primary_keyword, topic')
    .in('status', ['queued', 'generating']);

  const queuedKeywords = new Set<string>();
  if (queuedTopics) {
    for (const row of queuedTopics as Array<{ primary_keyword: string | null; topic: string | null }>) {
      if (row.primary_keyword) queuedKeywords.add(row.primary_keyword.trim().toLowerCase());
      if (row.topic) {
        const words = row.topic.split(/\s+/).slice(0, 3);
        queuedKeywords.add(words.join(' ').toLowerCase());
      }
    }
  }

  const now = new Date();
  for (const signal of signals) {
    const kwNormalized = signal.keyword.trim().toLowerCase();

    // 1) content_opportunity: 떠오르는 키워드인데 콘텐츠 없음
    if (
      (signal.currentTrend === 'rising' || signal.currentTrend === 'seasonal_peak') &&
      !existingKeywords.has(kwNormalized) &&
      !queuedKeywords.has(kwNormalized)
    ) {
      // 키워드 포함 여부 넓은 검색
      const covered = Array.from(existingKeywords).some(ek => ek.includes(kwNormalized) || kwNormalized.includes(ek));
      const queued = Array.from(queuedKeywords).some(qk => qk.includes(kwNormalized) || kwNormalized.includes(qk));

      if (!covered && !queued) {
        const peakForecast = signal.forecast.slice(-1)[0];
        insights.push({
          type: 'content_opportunity',
          title: `'${signal.keyword}' 검색량 증가 예상`,
          description: signal.destination
            ? `${signal.destination} 관련 '${signal.keyword}' 검색량이 ${Math.abs(signal.changePercent).toFixed(0)}% ${
                signal.changePercent > 0 ? '상승' : '하락'
              } 추세입니다.`
            : `'${signal.keyword}' 검색량이 ${Math.abs(signal.changePercent).toFixed(0)}% ${
                signal.changePercent > 0 ? '상승' : '하락'
              } 추세입니다.`,
          signal,
          suggestedAction: signal.destination
            ? `${signal.destination} 여행 블로그 콘텐츠 생성`
            : `${signal.keyword} 관련 블로그 콘텐츠 생성`,
          estimatedImpact: peakForecast
            ? `예상 검색량 ${peakForecast.predictedValue.toFixed(0)}회/일`
            : '트래픽 증가 기대',
          createdAt: now.toISOString(),
        });
        continue;
      }
    }

    // 2) seasonal_preparation: 계절성 피크 2~3개월 전
    if (signal.currentTrend === 'seasonal_peak' || signal.currentTrend === 'rising') {
      const peakForecast = signal.forecast.slice(-1)[0];
      insights.push({
        type: 'seasonal_preparation',
        title: signal.destination
          ? `${signal.destination} 성수기 준비 — '${signal.keyword}'`
          : `'${signal.keyword}' 시즌 수요 준비`,
        description: `예측 모델 기준 ${Math.abs(signal.changePercent).toFixed(0)}% 증가 예상. 지금 콘텐츠 준비 시작 권장.`,
        signal,
        suggestedAction: signal.destination
          ? `D-60 기준 ${signal.destination} 시즌 콘텐츠 발행 준비`
          : `${signal.keyword} 시즌 콘텐츠 발행 준비`,
        estimatedImpact: peakForecast
          ? `피크 예상값 ${peakForecast.predictedValue.toFixed(0)}회/일`
          : '시즌 트래픽 확보',
        createdAt: now.toISOString(),
      });
      continue;
    }

    // 3) trend_alert: 급격한 하락
    if (signal.currentTrend === 'falling') {
      insights.push({
        type: 'trend_alert',
        title: `'${signal.keyword}' 검색량 급감 (${Math.abs(signal.changePercent).toFixed(0)}%)`,
        description: signal.destination
          ? `${signal.destination} '${signal.keyword}'가 ${Math.abs(signal.changePercent).toFixed(0)}% 하락했습니다.`
          : `'${signal.keyword}' 검색량 ${Math.abs(signal.changePercent).toFixed(0)}% 하락. 콘텐츠 리프레시 검토.`,
        signal,
        suggestedAction: '콘텐츠 리프레시 및 메타 데이터 업데이트',
        estimatedImpact: '하락 추세 반전 가능',
        createdAt: now.toISOString(),
      });
    }
  }

  return { status: 'ready', insights };
}

/**
 * 시즌 콘텐츠 최적 발행 시각 계산
 * @param opts.seasonPeakMonth - 성수기 월 (1-12)
 * @param opts.leadTimeDays - 선행 발행 기간 (기본 60일)
 * @param opts.contentProductionDays - 콘텐츠 제작 소요 기간 (기본 7일)
 */
export function computeOptimalPublishTiming(opts: {
  seasonPeakMonth: number;
  leadTimeDays?: number;
  contentProductionDays?: number;
}): {
  idealPublishDate: string;
  startPreparationDate: string;
  contentWindowStart: string;
  contentWindowEnd: string;
  daysUntilPeak: number;
  recommended: string;
} {
  const leadDays = opts.leadTimeDays ?? 60;
  const prodDays = opts.contentProductionDays ?? 7;
  const now = new Date();

  let year = now.getFullYear();
  let peakDate = new Date(year, opts.seasonPeakMonth - 1, 1);
  if (peakDate <= now) {
    peakDate = new Date(year + 1, opts.seasonPeakMonth - 1, 1);
    year = year + 1;
  }

  const idealPublish = new Date(peakDate);
  idealPublish.setDate(idealPublish.getDate() - leadDays);

  const startPrep = new Date(idealPublish);
  startPrep.setDate(startPrep.getDate() - prodDays);

  const windowStart = new Date(idealPublish);
  windowStart.setDate(windowStart.getDate() - 7);

  const windowEnd = new Date(idealPublish);
  windowEnd.setDate(windowEnd.getDate() + 7);

  const daysUntilPeak = Math.ceil((peakDate.getTime() - now.getTime()) / 86400000);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const kstOpts = { timeZone: 'Asia/Seoul', year: 'numeric' as const, month: 'long' as const, day: 'numeric' as const };
  const peakLabel = peakDate.toLocaleDateString('ko-KR', kstOpts);

  return {
    idealPublishDate: fmt(idealPublish),
    startPreparationDate: fmt(startPrep),
    contentWindowStart: fmt(windowStart),
    contentWindowEnd: fmt(windowEnd),
    daysUntilPeak,
    recommended: `${peakLabel} 성수기 대비, ${fmt(idealPublish)} 발행 권장 (D-${leadDays}). 제작 시작: ${fmt(startPrep)}.`,
  };
}

// ─── DB 연동 ─────────────────────────────────────────────────

/**
 * 예측 인사이트를 DB에 저장 (대시보드 표시용)
 */
export async function persistInsights(insights: PredictiveInsight[]): Promise<{ inserted: number }> {
  if (insights.length === 0) return { inserted: 0 };

  const rows = insights.map(i => ({
    insight_type: i.type,
    title: i.title,
    description: i.description,
    keyword: i.signal.keyword,
    destination: i.signal.destination || null,
    trend_direction: i.signal.currentTrend,
    change_percent: i.signal.changePercent,
    recommendation: i.signal.recommendation,
    suggested_action: i.suggestedAction,
    estimated_impact: i.estimatedImpact,
    priority: i.signal.priority,
    status: 'pending' as const,
    created_at: i.createdAt,
  }));

  // 중복 방지: 같은 키워드 + 같은 타입의 pending insight가 있으면 UPSERT
  const { error } = await supabaseAdmin
    .from('predictive_insights')
    .upsert(rows, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error('[predictive-marketing] persistInsights UPSERT 실패:', error);
    return { inserted: 0 };
  }

  return { inserted: rows.length };
}

/**
 * Compatibility boundary. Forecast output must never enqueue content.
 */
export async function autoQueueFromInsights(_opts?: {
  minPriority?: number;
  maxInsights?: number;
}): Promise<{ queued: 0; insights: []; status: 'automation_disabled'; reason: 'FORECAST_DOWNSTREAM_MUTATION_FORBIDDEN' }> {
  return {
    queued: 0,
    insights: [],
    status: 'automation_disabled',
    reason: 'FORECAST_DOWNSTREAM_MUTATION_FORBIDDEN',
  };
}
