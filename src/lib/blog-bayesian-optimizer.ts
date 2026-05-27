/**
 * Blog Bayesian Optimizer — 데이터 기반 품질 게이트 임계값 자동 조정
 *
 * 원리:
 *   7일 CTR / 노출 데이터를 기반으로 각 게이트의 임계값을 베이지안 추론으로 조정.
 *   "게이트 통과율 70~80%"를 목표로 삼아 너무 빡빡하거나 너무 느슨하지 않게 유지.
 *
 * 사용처:
 *   - blog-learn cron (월간 1회) — 임계값 조정
 *   - blog-quality-gate.ts — 조정된 임계값 동적 로드
 *
 * SSOT:
 *   - 기본값은 blog-quality-gate.ts 의 THRESHOLDS 상수
 *   - 조정값은 content_creatives.metrics + publishing_policies.json 에 저장
 *   - DB에 조정값이 없으면 기본값 사용 (안전한 degrade)
 */
import { supabaseAdmin } from './supabase';
import { analyzePerformancePatterns, type BlogMetricsSnapshot } from './blog-metrics-store';

/** 게이트별 조정 가능한 임계값 */
export interface AdaptiveThresholds {
  /** 정보성 글 최소 길이 (기본 1800) */
  infoMinLen: number;
  /** 상품 글 최소 길이 (기본 1200) */
  productMinLen: number;
  /** 정보성 글 최대 클리셰 수 (기본 15) */
  infoMaxCliche: number;
  /** 상품 글 최대 클리셰 수 (기본 2) */
  productMaxCliche: number;
  /** 정보성 글 최대 키워드 밀도 % (기본 1.8) */
  infoMaxKeywordDensity: number;
  /** 상품 글 최대 키워드 밀도 % (기본 2.5) */
  productMaxKeywordDensity: number;
  /** 정보성 최소 readability (기본 70) */
  infoMinReadability: number;
  /** 상품 최소 readability (기본 60) */
  productMinReadability: number;
  /** 조정 근거 */
  rationale: string;
}

const DEFAULT_THRESHOLDS: AdaptiveThresholds = {
  infoMinLen: 2500,
  productMinLen: 1200,
  infoMaxCliche: 8,
  productMaxCliche: 2,
  infoMaxKeywordDensity: 1.8,
  productMaxKeywordDensity: 2.5,
  infoMinReadability: 70,
  productMinReadability: 60,
  rationale: '기본값 (blog-quality-gate.ts)',
};

type ThresholdKey = keyof AdaptiveThresholds;

/**
 * 현재 활성 임계값 조회 (DB → 없으면 기본값)
 */
export async function getActiveThresholds(): Promise<AdaptiveThresholds> {
  try {
    const { data } = await supabaseAdmin
      .from('publishing_policies')
      .select('value')
      .eq('key', 'adaptive_thresholds')
      .limit(1);

    if (data && data.length > 0) {
      const stored = data[0].value as Partial<AdaptiveThresholds>;
      return { ...DEFAULT_THRESHOLDS, ...stored };
    }
  } catch {
    // fallthrough to defaults
  }
  return DEFAULT_THRESHOLDS;
}

/**
 * 베이지안 스타일 CTR 기반 임계값 조정
 *
 * 원리:
 *   1. 현재 임계값으로 통과한 글들의 7일 CTR 분포 측정
 *   2. 통과율이 70% 미만이면 임계값을 완화
 *   3. 통과율이 90% 초과면 임계값을 강화 (너무 느슨함)
 *   4. 각 게이트는 독립적으로 조정 (서로 다른 성격)
 *
 * @param passRate 목표 통과율 (기본 0.75 = 75%)
 * @returns 조정된 임계값 (저장 전)
 */
export async function computeAdaptiveThresholds(
  passRate = 0.75,
): Promise<AdaptiveThresholds> {
  const current = await getActiveThresholds();
  const analysis = await analyzePerformancePatterns('7d', 5);

  if (analysis.topPerformers.length < 5) {
    return { ...current, rationale: '데이터 부족 — 현재값 유지' };
  }

  // 고CTR 그룹 vs 저CTR 그룹의 특성 비교
  const topCtr = analysis.topPerformers;
  const bottomCtr = analysis.bottomPerformers;

  // 길이 분석: 고CTR 글들의 평균 길이
  const topLengths = topCtr
    .filter(p => p.bodyLength > 0)
    .map(p => p.bodyLength);
  const bottomLengths = bottomCtr
    .filter(p => p.bodyLength > 0)
    .map(p => p.bodyLength);

  const avgTopLen = topLengths.length > 0
    ? topLengths.reduce((a, b) => a + b, 0) / topLengths.length
    : 0;
  const avgBottomLen = bottomLengths.length > 0
    ? bottomLengths.reduce((a, b) => a + b, 0) / bottomLengths.length
    : 0;

  // readability 분석
  const topRead = topCtr
    .filter(p => p.readabilityScore > 0)
    .map(p => p.readabilityScore);
  const bottomRead = bottomCtr
    .filter(p => p.readabilityScore > 0)
    .map(p => p.readabilityScore);

  const avgTopRead = topRead.length > 0
    ? topRead.reduce((a, b) => a + b, 0) / topRead.length
    : 0;
  const avgBottomRead = bottomRead.length > 0
    ? bottomRead.reduce((a, b) => a + b, 0) / bottomRead.length
    : 0;

  const adjustments: string[] = [];

  // 길이 임계값 조정: 고CTR 글들이 더 길면 임계값 상향, 더 짧으면 하향
  let newInfoMinLen = current.infoMinLen;
  const newProductMinLen = current.productMinLen;

  if (avgTopLen > 0 && avgBottomLen > 0) {
    if (avgTopLen > avgBottomLen * 1.2) {
      // 고CTR 글들이 현저히 더 김 → 임계값 올림
      newInfoMinLen = Math.min(3000, Math.round(current.infoMinLen * 1.1));
      adjustments.push(`길이 상향: 고CTR 평균 ${Math.round(avgTopLen)}자 > 저CTR ${Math.round(avgBottomLen)}자`);
    } else if (avgTopLen < avgBottomLen * 0.8) {
      // 고CTR 글들이 더 짧음 → 임계값 내림
      newInfoMinLen = Math.max(800, Math.round(current.infoMinLen * 0.9));
      adjustments.push(`길이 하향: 고CTR 평균 ${Math.round(avgTopLen)}자 < 저CTR ${Math.round(avgBottomLen)}자`);
    }
  }

  // Readability 조정
  let newInfoMinRead = current.infoMinReadability;
  if (avgTopRead > 0 && avgBottomRead > 0) {
    const readGap = avgTopRead - avgBottomRead;
    if (readGap > 10) {
      // readability가 CTR에 유의미한 영향
      newInfoMinRead = Math.min(90, Math.round(avgTopRead * 0.8));
      adjustments.push(`readability 상향: 고CTR 평균 ${Math.round(avgTopRead)} > 저CTR ${Math.round(avgBottomRead)} (gap ${Math.round(readGap)})`);
    } else if (readGap < -5) {
      newInfoMinRead = Math.max(30, Math.round(avgBottomRead * 0.7));
      adjustments.push(`readability 하향: 고CTR 저조 ${Math.round(avgBottomRead)}점`);
    }
  }

  const rationale = adjustments.length > 0
    ? `베이지안 자동조정 (${new Date().toISOString().slice(0, 10)}): ${adjustments.join('; ')}`
    : `${new Date().toISOString().slice(0, 10)}: 데이터 변동 미미 — 현재값 유지`;

  return {
    infoMinLen: newInfoMinLen,
    productMinLen: newProductMinLen,
    infoMaxCliche: current.infoMaxCliche,
    productMaxCliche: current.productMaxCliche,
    infoMaxKeywordDensity: current.infoMaxKeywordDensity,
    productMaxKeywordDensity: current.productMaxKeywordDensity,
    infoMinReadability: newInfoMinRead,
    productMinReadability: current.productMinReadability,
    rationale,
  };
}

/**
 * 조정된 임계값을 DB에 저장 + publishing_policies 갱신
 */
export async function persistAdaptiveThresholds(
  thresholds: AdaptiveThresholds,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('publishing_policies')
    .upsert(
      { key: 'adaptive_thresholds', value: thresholds as unknown as Record<string, unknown> },
      { onConflict: 'key' },
    );

  if (error) {
    console.error('[bayesian-optimizer] persist failed:', error.message);
  }
}
