/**
 * A/B 테스트 엔진 — 블로그 헤드라인·CTA·OG 이미지·전체 콘텐츠 실험
 *
 * 사용처:
 *   - API 라우트 (server-side): 페이지 렌더 시 assignVariant → variant_value 반영
 *   - 미들웨어 (middleware.ts): 방문자 식별 + 할당 (visitor_id는 쿠키/uid)
 *   - 어드민 대시보드: 실험 생성(createExperiment) + 분석(analyzeExperiment)
 *   - Cron: autoFinalizeExperiments 로 정기적 승자 판정
 *
 * 통계: chi-squared test (chi-squared 독립성 검정)
 *   귀무가설 H0: variant 간 전환율 차이가 없다
 *   p-value < 1 - confidenceThreshold → H0 기각 → 승자 선언
 */

import { supabaseAdmin } from './supabase';

// ─── Types ───────────────────────────────────────────────────────

export type VariantType = 'headline' | 'cta' | 'og_image' | 'full_content';
export type ExperimentStatus = 'running' | 'paused' | 'completed' | 'archived';

export interface ExperimentConfig {
  creativeId: string;
  variantType: VariantType;
  name: string;
  /** 원본 값 (control) */
  controlValue: string;
  /** B, C, D … variant 값 배열 (A는 control) */
  variants: string[];
  /** 최소 샘플 크기 (기본 100) */
  minSampleSize?: number;
  /** 신뢰 임계값 (기본 0.950 = 95%) */
  confidenceThreshold?: number;
}

export interface VariantResult {
  variantId: string;
  label: string;
  value: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionRate: number;
  isControl: boolean;
  isWinner: boolean;
}

export interface AnalysisResult {
  status: ExperimentStatus;
  variants: VariantResult[];
  winner: VariantResult | null;
  confidence: number;
  isSignificant: boolean;
}

interface AbExperimentRow {
  id: string;
  name: string;
  creative_id: string;
  status: ExperimentStatus;
  variant_type: VariantType;
  control_value: string | null;
  winner_variant_id: string | null;
  started_at: string;
  completed_at: string | null;
  min_sample_size: number;
  confidence_threshold: number;
  created_at: string;
}

interface AbVariantRow {
  id: string;
  experiment_id: string;
  variant_label: string;
  variant_value: string;
  is_control: boolean;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** 단순 문자열 해시 — 동일 visitor_id + experiment_id 늘 같은 variant */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // 32-bit integer
  }
  return Math.abs(hash);
}

/** 전환율 계산 (0~1) */
export function calculateConversionRate(conversions: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return conversions / impressions;
}

/**
 * Chi-squared 독립성 검정
 *
 * @param observed - 2×2 관측치 행렬 [[control_conv, control_nonconv], [test_conv, test_nonconv]]
 * @returns chi-squared 통계량과 p-value
 */
export function chiSquaredTest(
  observed: [[number, number], [number, number]],
): { chi2: number; pValue: number } {
  const total = observed[0][0] + observed[0][1] + observed[1][0] + observed[1][1];
  if (total === 0) return { chi2: 0, pValue: 1 };

  // 행 합계 / 열 합계
  const rowSums = [observed[0][0] + observed[0][1], observed[1][0] + observed[1][1]];
  const colSums = [observed[0][0] + observed[1][0], observed[0][1] + observed[1][1]];

  // 기대도수 = (행합계 × 열합계) / 전체합계
  const expected: [[number, number], [number, number]] = [
    [(rowSums[0] * colSums[0]) / total, (rowSums[0] * colSums[1]) / total],
    [(rowSums[1] * colSums[0]) / total, (rowSums[1] * colSums[1]) / total],
  ];

  // chi2 = Σ ((observed - expected)² / expected)
  let chi2 = 0;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      if (expected[r][c] > 0) {
        chi2 += ((observed[r][c] - expected[r][c]) ** 2) / expected[r][c];
      }
    }
  }

  // 자유도 1의 chi-squared 분포 → p-value 근사
  // p = 1 / (1 + exp(1.885 * chi2 ** 0.685)) — Camp-Paulson 근사 (간소화)
  const pValue = chi2 <= 0 ? 1 : Math.exp(-0.5 * chi2) * (1 + chi2 * 0.5);

  return { chi2, pValue: Math.min(1, pValue) };
}

// ─── Core API ────────────────────────────────────────────────────

/**
 * 새로운 A/B 실험 생성
 *
 * 1. ab_experiments INSERT
 * 2. control variant (A) + test variants (B, C, D…) INSERT
 * 3. 실험 ID 반환
 */
export async function createExperiment(
  config: ExperimentConfig,
): Promise<{ experimentId: string }> {
  const minSampleSize = config.minSampleSize ?? 100;
  const confidenceThreshold = config.confidenceThreshold ?? 0.950;

  // 1) 실험 레코드 생성
  const { data: experiment, error: expError } = await supabaseAdmin
    .from('ab_experiments')
    .insert({
      name: config.name,
      creative_id: config.creativeId,
      variant_type: config.variantType,
      control_value: config.controlValue,
      status: 'running',
      min_sample_size: minSampleSize,
      confidence_threshold: confidenceThreshold,
    })
    .select()
    .single();

  if (expError || !experiment) {
    throw new Error(
      `A/B 실험 생성 실패: ${expError?.message ?? '알 수 없는 오류'}`,
    );
  }

  const experimentId = (experiment as AbExperimentRow).id;

  // 2) control variant (A)
  const variantsToInsert: Array<{
    experiment_id: string;
    variant_label: string;
    variant_value: string;
    is_control: boolean;
  }> = [
    {
      experiment_id: experimentId,
      variant_label: 'A',
      variant_value: config.controlValue,
      is_control: true,
    },
  ];

  // test variants (B, C, D …)
  const labels = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < config.variants.length; i++) {
    variantsToInsert.push({
      experiment_id: experimentId,
      variant_label: labels[i] ?? `V${i + 1}`,
      variant_value: config.variants[i],
      is_control: false,
    });
  }

  const { error: varError } = await supabaseAdmin
    .from('ab_variants')
    .insert(variantsToInsert);

  if (varError) {
    // 롤백: 실험 삭제
    await supabaseAdmin.from('ab_experiments').delete().eq('id', experimentId);
    throw new Error(`Variant 생성 실패: ${varError.message}`);
  }

  return { experimentId };
}

/**
 * 방문자에게 variant 할당 (결정론적: visitor_id 기반 hash)
 *
 * 1. 기존 할당 확인 → 있으면 반환
 * 2. 없으면 hash(visitor_id + experiment_id) % n 으로 variant 선택
 * 3. ab_assignments 기록 + variant.impressions 증가
 * 4. 선택된 variant 정보 반환
 */
export async function assignVariant(
  experimentId: string,
  visitorId: string,
): Promise<{ variantId: string; variantLabel: string; variantValue: string } | null> {
  // 1) 기존 할당 확인
  const { data: existing } = await supabaseAdmin
    .from('ab_assignments')
    .select('variant_id')
    .eq('experiment_id', experimentId)
    .eq('visitor_id', visitorId)
    .maybeSingle();

  if (existing) {
    const variantId = (existing as { variant_id: string }).variant_id;
    const { data: variant } = await supabaseAdmin
      .from('ab_variants')
      .select('id, variant_label, variant_value')
      .eq('id', variantId)
      .single();

    if (variant) {
      const v = variant as { id: string; variant_label: string; variant_value: string };
      return { variantId: v.id, variantLabel: v.variant_label, variantValue: v.variant_value };
    }
  }

  // 2) 변형 목록 조회
  const { data: variants, error: fetchError } = await supabaseAdmin
    .from('ab_variants')
    .select('id, variant_label, variant_value')
    .eq('experiment_id', experimentId)
    .order('variant_label', { ascending: true });

  if (fetchError || !variants || variants.length === 0) {
    console.error('[A/B] variant 목록 조회 실패:', fetchError?.message);
    return null;
  }

  const typedVariants = variants as Array<{
    id: string;
    variant_label: string;
    variant_value: string;
  }>;

  // 3) 결정론적 할당: hashCode(visitorId + experimentId) % n
  const idx = hashCode(visitorId + experimentId) % typedVariants.length;
  const chosen = typedVariants[idx];

  // 4) 할당 기록
  const { error: assignError } = await supabaseAdmin
    .from('ab_assignments')
    .insert({
      experiment_id: experimentId,
      variant_id: chosen.id,
      visitor_id: visitorId,
    });

  if (assignError) {
    console.error('[A/B] 할당 기록 실패:', assignError.message);
    // 비파괴: 할당 기록 실패는 무시하고 variant 반환
  }

  // 5) impressions 증가 (원자적 업데이트)
  const { error: incError } = await supabaseAdmin.rpc('increment_ab_metric', {
    p_variant_id: chosen.id,
    p_field: 'impressions',
  });

  if (incError) {
    // RPC 없으면 직접 읽어서 +1
    const { data: current } = await supabaseAdmin
      .from('ab_variants')
      .select('impressions')
      .eq('id', chosen.id)
      .single();

    if (current) {
      await supabaseAdmin
        .from('ab_variants')
        .update({ impressions: ((current as { impressions: number }).impressions ?? 0) + 1 })
        .eq('id', chosen.id);
    }
  }

  return {
    variantId: chosen.id,
    variantLabel: chosen.variant_label,
    variantValue: chosen.variant_value,
  };
}

/**
 * 전환 기록 (방문자가 목표 행동 완료)
 *
 * 1. ab_assignments.converted = true, converted_at 기록
 * 2. variant.clicks + 1, variant.conversions + 1, variant.revenue += revenue
 */
export async function recordConversion(
  experimentId: string,
  visitorId: string,
  revenue?: number,
): Promise<void> {
  // 1) 할당 찾기
  const { data: assignment, error: findError } = await supabaseAdmin
    .from('ab_assignments')
    .select('id, variant_id, converted')
    .eq('experiment_id', experimentId)
    .eq('visitor_id', visitorId)
    .maybeSingle();

  if (findError || !assignment) {
    console.warn('[A/B] recordConversion: 할당 없음', findError?.message);
    return;
  }

  const a = assignment as { id: string; variant_id: string; converted: boolean };

  // 이미 전환됨 → 중복 기록 방지
  if (a.converted) return;

  // 2) assignment 업데이트
  const { error: updateError } = await supabaseAdmin
    .from('ab_assignments')
    .update({
      converted: true,
      converted_at: new Date().toISOString(),
    })
    .eq('id', a.id);

  if (updateError) {
    console.error('[A/B] assignment 업데이트 실패:', updateError.message);
    return;
  }

  // 3) variant 통계 업데이트 (conversions는 원자적 RPC 사용)
  const variantId = a.variant_id;
  const rev = revenue ?? 0;

  // conversions 원자적 증가
  const { error: incConvError } = await supabaseAdmin.rpc('increment_ab_metric', {
    p_variant_id: Number(variantId),
    p_field: 'conversions',
  });

  if (incConvError) {
    // RPC 실패 시 fallback: 기존 방식으로 읽어서 +1
    const { data: variant } = await supabaseAdmin
      .from('ab_variants')
      .select('clicks, conversions, revenue')
      .eq('id', variantId)
      .single();

    if (variant) {
      const v = variant as { clicks: number; conversions: number; revenue: number };
      await supabaseAdmin
        .from('ab_variants')
        .update({
          clicks: (v.clicks ?? 0) + 1,
          conversions: (v.conversions ?? 0) + 1,
          revenue: (v.revenue ?? 0) + rev,
        })
        .eq('id', variantId);
    }
  } else {
    // RPC 성공 시 clicks와 revenue만 별도 업데이트
    const { data: variant } = await supabaseAdmin
      .from('ab_variants')
      .select('clicks, revenue')
      .eq('id', variantId)
      .single();

    if (variant) {
      const v = variant as { clicks: number; revenue: number };
      await supabaseAdmin
        .from('ab_variants')
        .update({
          clicks: (v.clicks ?? 0) + 1,
          revenue: (v.revenue ?? 0) + rev,
        })
        .eq('id', variantId);
    }
  }
}

/**
 * 실험 결과 분석 (chi-squared test)
 *
 * 각 variant를 control(A)과 쌍으로 비교:
 *   - 전환율 계산
 *   - chi-squared 검정
 *   - 최소 샘플 충족 + 통계 유의성 → 승자 선언
 */
export async function analyzeExperiment(
  experimentId: string,
): Promise<AnalysisResult> {
  // 1) 실험 + variant 조회
  const { data: experiment, error: expError } = await supabaseAdmin
    .from('ab_experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (expError || !experiment) {
    throw new Error(`실험 조회 실패: ${expError?.message ?? '없음'}`);
  }

  const exp = experiment as AbExperimentRow;

  const { data: variants, error: varError } = await supabaseAdmin
    .from('ab_variants')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('variant_label', { ascending: true });

  if (varError || !variants) {
    throw new Error(`Variant 조회 실패: ${varError?.message ?? '없음'}`);
  }

  const typedVariants = variants as AbVariantRow[];

  // 2) 각 variant 결과
  const control = typedVariants.find(v => v.is_control);
  const testVariants = typedVariants.filter(v => !v.is_control);

  const results: VariantResult[] = typedVariants.map(v => ({
    variantId: v.id,
    label: v.variant_label,
    value: v.variant_value,
    impressions: v.impressions,
    clicks: v.clicks,
    conversions: v.conversions,
    conversionRate: calculateConversionRate(v.conversions, v.impressions),
    isControl: v.is_control,
    isWinner: false,
  }));

  // 3) 통계 검정 — 각 test variant vs control
  const totalImpressions = typedVariants.reduce((s, v) => s + v.impressions, 0);
  const minSampleMet = totalImpressions >= exp.min_sample_size;

  let bestVariant: (typeof results)[number] | null = null;
  let bestPValue = 1;

  if (control && minSampleMet) {
    for (const test of testVariants) {
      // control vs test 2×2 분할표
      const observed: [[number, number], [number, number]] = [
        [control.conversions, control.impressions - control.conversions],
        [test.conversions, test.impressions - test.conversions],
      ];

      const { pValue } = chiSquaredTest(observed);
      const testResult = results.find(r => r.variantId === test.id);
      const controlResult = results.find(r => r.variantId === control.id);

      if (testResult && controlResult && pValue < bestPValue) {
        bestPValue = pValue;
        // p-value가 작을수록 유의미. 단, 전환율이 control보다 높아야 승자.
        if (testResult.conversionRate > controlResult.conversionRate) {
          bestVariant = testResult;
        } else if (controlResult.conversionRate > testResult.conversionRate) {
          bestVariant = controlResult;
        }
      }
    }
  }

  const confidence = 1 - bestPValue;
  const isSignificant = minSampleMet && confidence >= exp.confidence_threshold && bestVariant !== null;

  // 4) 승자 표시
  if (isSignificant && bestVariant) {
    const winner = results.find(r => r.variantId === bestVariant.variantId);
    if (winner) {
      winner.isWinner = true;
    }

    // 완료되지 않은 실험만 상태 변경
    if (exp.status === 'running') {
      await supabaseAdmin
        .from('ab_experiments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          winner_variant_id: bestVariant.variantId,
        })
        .eq('id', experimentId);
    }
  }

  return {
    status: (isSignificant && bestVariant !== null) ? 'completed' : exp.status,
    variants: results,
    winner: isSignificant && bestVariant
      ? (results.find(r => r.variantId === bestVariant!.variantId) ?? null)
      : null,
    confidence: +confidence.toFixed(4),
    isSignificant,
  };
}

/**
 * 특정 creative의 활성 실험 목록 조회
 */
export async function getActiveExperiments(
  creativeId: string,
): Promise<Array<AbExperimentRow & { variants: AbVariantRow[] }>> {
  const { data: experiments, error } = await supabaseAdmin
    .from('ab_experiments')
    .select('*')
    .eq('creative_id', creativeId)
    .in('status', ['running', 'paused'])
    .order('created_at', { ascending: false });

  if (error || !experiments) {
    console.error('[A/B] 활성 실험 조회 실패:', error?.message);
    return [];
  }

  const typedExps = experiments as AbExperimentRow[];
  const result: Array<AbExperimentRow & { variants: AbVariantRow[] }> = [];

  for (const exp of typedExps) {
    const { data: variants } = await supabaseAdmin
      .from('ab_variants')
      .select('*')
      .eq('experiment_id', exp.id);

    result.push({
      ...exp,
      variants: (variants as AbVariantRow[]) ?? [],
    });
  }

  return result;
}

/**
 * 통계 유의성에 도달한 실험 자동 종료
 * - 모든 'running' 실험을 순회하며 analyzeExperiment 실행
 * - 유의미한 결과 도달 시 completed + winner 기록
 *
 * Cron/스케줄러에서 정기 호출 (예: 1시간 간격)
 */
export async function autoFinalizeExperiments(): Promise<{ finalized: number }> {
  const { data: experiments, error } = await supabaseAdmin
    .from('ab_experiments')
    .select('id')
    .eq('status', 'running');

  if (error || !experiments) {
    console.error('[A/B] autoFinalize: 실험 목록 조회 실패:', error?.message);
    return { finalized: 0 };
  }

  let finalized = 0;

  for (const row of experiments) {
    const exp = row as { id: string };
    try {
      const result = await analyzeExperiment(exp.id);
      if (result.isSignificant && result.winner) {
        finalized++;
      }
    } catch (err) {
      console.error(`[A/B] autoFinalize: 실험 ${exp.id} 분석 실패:`, err);
    }
  }

  return { finalized };
}
