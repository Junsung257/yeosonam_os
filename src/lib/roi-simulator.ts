import { supabaseAdmin } from "@/lib/supabase";

export interface RoiSimulationInput {
  channel: string;
  additionalBudget: number;
  currentMonthlySpend: number;
  currentMonthlyRevenue: number;
  attributionWindowDays: number;
}

export interface RoiSimulationResult {
  channel: string;
  additionalBudget: number;
  estimatedAdditionalRevenue: number;
  estimatedROAS: number;
  confidenceInterval: [number, number]; // [lower, upper]
  breakEvenDays: number;
  recommendation: string;
}

/**
 * 채널별 기본 효율 계수 (DB에 데이터가 없을 때 사용)
 *
 * diminishing returns 공식:
 *   revenue = baseRevenue + (budget * efficiency) / (1 + budget / saturationPoint)
 */
const DEFAULT_CHANNEL_PARAMS: Record<
  string,
  { efficiency: number; saturationPoint: number }
> = {
  meta: { efficiency: 3.5, saturationPoint: 20_000_000 },
  google: { efficiency: 4.0, saturationPoint: 15_000_000 },
  naver: { efficiency: 3.0, saturationPoint: 10_000_000 },
  kakao: { efficiency: 2.5, saturationPoint: 8_000_000 },
  influencer: { efficiency: 5.0, saturationPoint: 5_000_000 },
};

/**
 * attribution_summary 테이블에서 특정 채널의 효율 데이터를 조회한다.
 *
 * @param channel 채널명 (예: "meta", "google", "naver")
 * @returns 효율 정보 (효율 계수, 신뢰도, 데이터 포인트 수)
 */
export async function getChannelEfficiency(
  channel: string
): Promise<{
  efficiency: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
}> {
  try {
    // 최근 90일간의 채널별 집계 조회
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data, error } = await supabaseAdmin
      .from("attribution_summary")
      .select("total_cost, attributed_revenue")
      .eq("channel", channel)
      .gte("computed_at", ninetyDaysAgo.toISOString().split("T")[0]);

    if (error) {
      console.warn(
        `[roi-simulator] attribution_summary 조회 실패 (${channel}):`,
        error.message
      );
      return {
        efficiency: DEFAULT_CHANNEL_PARAMS[channel]?.efficiency ?? 2.0,
        confidence: "low",
        dataPoints: 0,
      };
    }

    const rows = (data ?? []) as { total_cost: number; attributed_revenue: number }[];
    const dataPoints = rows.length;

    if (dataPoints === 0) {
      return {
        efficiency: DEFAULT_CHANNEL_PARAMS[channel]?.efficiency ?? 2.0,
        confidence: "low",
        dataPoints: 0,
      };
    }

    // 총 비용 대비 총 수익으로 평균 효율 계산
    const totalCost = rows.reduce((sum, r) => sum + Number(r.total_cost), 0);
    const totalRevenue = rows.reduce(
      (sum, r) => sum + Number(r.attributed_revenue),
      0
    );

    const efficiency =
      totalCost > 0 ? totalRevenue / totalCost : DEFAULT_CHANNEL_PARAMS[channel]?.efficiency ?? 2.0;

    // 데이터 포인트 수에 따른 신뢰도 결정
    const confidence =
      dataPoints >= 60 ? "high" : dataPoints >= 20 ? "medium" : "low";

    return { efficiency, confidence, dataPoints };
  } catch (err) {
    console.error(
      `[roi-simulator] getChannelEfficiency 예외 (${channel}):`,
      err instanceof Error ? err.message : String(err)
    );
    return {
      efficiency: DEFAULT_CHANNEL_PARAMS[channel]?.efficiency ?? 2.0,
      confidence: "low",
      dataPoints: 0,
    };
  }
}

/**
 * 단일 채널의 ROI 시뮬레이션을 실행한다.
 *
 * 로직:
 * 1. attribution_summary에서 채널 효율 조회 (없으면 기본값 사용)
 * 2. 체감 수익 공식: 추가수익 = (추가예산 * 효율) / (1 + 추가예산 / 포화점)
 * 3. 신뢰구간: 데이터가 많을수록 좁아짐
 * 4. 손익분기점: 추가수익이 추가지출을 덮는 데 걸리는 일수 (30일 기준)
 */
export function simulateRoi(input: RoiSimulationInput): RoiSimulationResult {
  const {
    channel,
    additionalBudget,
    currentMonthlySpend,
    currentMonthlyRevenue,
    attributionWindowDays,
  } = input;

  const defaultParams = DEFAULT_CHANNEL_PARAMS[channel] ?? {
    efficiency: 2.0,
    saturationPoint: 10_000_000,
  };

  // 현재 효율 (DB 조회가 선행되어야 하지만, 순수 함수로도 동작 가능)
  const baseEfficiency =
    currentMonthlySpend > 0
      ? currentMonthlyRevenue / currentMonthlySpend
      : defaultParams.efficiency;

  // 체감 수익 계산
  const estimatedAdditionalRevenue =
    (additionalBudget * baseEfficiency) /
    (1 + additionalBudget / defaultParams.saturationPoint);

  // 예상 ROAS (투자 대비 수익률)
  const estimatedROAS =
    additionalBudget > 0
      ? Math.round((estimatedAdditionalRevenue / additionalBudget) * 100) / 100
      : 0;

  // 신뢰 구간 (데이터가 많을수록 좁아짐)
  // 기본: 중간 신뢰도 기준 ±30%
  const baseWidth = estimatedAdditionalRevenue * 0.3;
  const confidenceInterval: [number, number] = [
    Math.round((estimatedAdditionalRevenue - baseWidth) * 100) / 100,
    Math.round((estimatedAdditionalRevenue + baseWidth) * 100) / 100,
  ];

  // 손익분기점: 추가수익이 추가지출을 넘는 시점
  // 일평균 추가수익으로 계산, attributionWindowDays 이내여야 의미 있음
  const dailyAdditionalRevenue = estimatedAdditionalRevenue / attributionWindowDays;
  const breakEvenDays =
    dailyAdditionalRevenue > 0
      ? Math.ceil(additionalBudget / dailyAdditionalRevenue)
      : Infinity;

  // 추천 문구 생성
  const recommendation = generateRecommendation(
    channel,
    estimatedROAS,
    breakEvenDays,
    attributionWindowDays
  );

  return {
    channel,
    additionalBudget,
    estimatedAdditionalRevenue: Math.round(estimatedAdditionalRevenue * 100) / 100,
    estimatedROAS,
    confidenceInterval,
    breakEvenDays,
    recommendation,
  };
}

/**
 * 시뮬레이션 결과에 따른 한국어 추천 문구를 생성한다.
 */
function generateRecommendation(
  channel: string,
  roas: number,
  breakEvenDays: number,
  attributionWindow: number
): string {
  const channelLabel = getChannelLabel(channel);

  if (roas <= 0) {
    return `${channelLabel} 추가 예산 투입이 추천되지 않습니다. 현재 채널 효율이 매우 낮습니다.`;
  }

  if (breakEvenDays > attributionWindow) {
    return `${channelLabel} ${roas.toFixed(1)}배 ROAS로, 손익분기점(${breakEvenDays}일)이 기여 기간(${attributionWindow}일)을 초과합니다. 신중한 검토가 필요합니다.`;
  }

  if (breakEvenDays <= 7) {
    return `✅ ${channelLabel}에 ${roas.toFixed(1)}배 ROAS가 예상되며, 약 ${breakEvenDays}일 내 손익분기 도달 가능. 추가 예산 투입을 적극 추천합니다.`;
  }

  if (roas >= 3.0) {
    return `👍 ${channelLabel}에 ${roas.toFixed(1)}배 ROAS로 효율적입니다. 손익분기까지 약 ${breakEvenDays}일 소요 예상.`;
  }

  if (roas >= 1.5) {
    return `${channelLabel} ${roas.toFixed(1)}배 ROAS, 손익분기 ${breakEvenDays}일. 현재 예산을 유지하며 성과를 모니터링하는 것을 추천합니다.`;
  }

  return `⚠️ ${channelLabel} ROAS ${roas.toFixed(1)}배로 기준(1.5배) 미만입니다. 추가 예산 투입 전 채널 최적화가 우선되어야 합니다.`;
}

/**
 * 채널 코드를 한글 레이블로 변환한다.
 */
function getChannelLabel(channel: string): string {
  const labels: Record<string, string> = {
    meta: "메타(페북/인스타)",
    google: "구글",
    naver: "네이버",
    kakao: "카카오",
    influencer: "인플루언서",
  };
  return labels[channel] ?? channel;
}

/**
 * 여러 채널의 ROI 시뮬레이션을 실행하고 ROAS 내림차순으로 정렬하여 반환한다.
 *
 * 각 채널에 대해 attribution_summary에서 실제 효율 데이터를 조회한 후
 * simulateRoi를 실행한다.
 *
 * @param inputs 시뮬레이션 입력 배열
 * @returns ROAS 내림차순 정렬된 결과 배열
 */
export async function runMultiChannelSimulation(
  inputs: RoiSimulationInput[]
): Promise<RoiSimulationResult[]> {
  // 각 채널의 효율 데이터를 병렬 조회
  const efficiencyResults = await Promise.all(
    inputs.map((input) => getChannelEfficiency(input.channel))
  );

  // 효율 데이터를 반영한 시뮬레이션 실행
  const results = inputs.map((input, idx) => {
    const eff = efficiencyResults[idx];

    // 실제 효율로 currentMonthlyRevenue 보정 (DB 데이터 우선)
    const adjustedInput: RoiSimulationInput = {
      ...input,
      currentMonthlyRevenue:
        eff.dataPoints > 0 && input.currentMonthlySpend > 0
          ? input.currentMonthlySpend * eff.efficiency
          : input.currentMonthlyRevenue,
    };

    const result = simulateRoi(adjustedInput);

    // confidence 기반 신뢰구간 보정
    const adjustedInterval = adjustConfidenceInterval(
      result.confidenceInterval,
      eff.confidence
    );

    return {
      ...result,
      estimatedAdditionalRevenue: Math.round(result.estimatedAdditionalRevenue * 100) / 100,
      confidenceInterval: adjustedInterval,
    };
  });

  // ROAS 내림차순 정렬
  results.sort((a, b) => b.estimatedROAS - a.estimatedROAS);

  return results;
}

/**
 * 신뢰도에 따라 신뢰구간을 보정한다.
 * high: ±15%, medium: ±30%, low: ±50%
 */
function adjustConfidenceInterval(
  baseInterval: [number, number],
  confidence: "high" | "medium" | "low"
): [number, number] {
  const mid = (baseInterval[0] + baseInterval[1]) / 2;
  const factors = { high: 0.15, medium: 0.3, low: 0.5 };
  const factor = factors[confidence];

  return [
    Math.round((mid - mid * factor) * 100) / 100,
    Math.round((mid + mid * factor) * 100) / 100,
  ];
}
