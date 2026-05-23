/**
 * @file attribution-engine.ts
 *
 * 멀티터치 어트리뷰션 (MTA) 엔진.
 *
 * 터치 이벤트 수집 → 예약 전환 시 체인 close → 5가지 모델로 기여도 산출 → summary 집계.
 *
 * ## 사용 흐름
 * 1. 사용자 액션마다 `recordTouchEvent()` 호출
 * 2. 예약 전환 시 `closeAttributionChain()` 호출 (visitor_id → booking_id 연결)
 * 3. `refreshAttributionSummary()`로 주기적(일/시간) 집계 리프레시
 * 4. 대시보드에서 `attribution_summary` 조회
 *
 * ## 모델
 * - first_touch: 첫 터치 100%
 * - last_touch: 마지막 터치 100%
 * - linear: 모든 터치 동등 분배
 * - time_decay: 최근 터치일수록 높은 가중치 (exp(-0.1 * hours_ago))
 * - position_based: first 40% + middle 20% + last 40%
 */

import { supabaseAdmin } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionModel =
  | 'first_touch'
  | 'last_touch'
  | 'linear'
  | 'time_decay'
  | 'position_based';

export interface TouchEvent {
  id?: string;
  visitorId: string;
  sessionId?: string;
  eventType: string;
  channel: string;
  source?: string;
  medium?: string;
  campaignId?: string;
  creativeId?: string;
  pageUrl?: string;
  referrerUrl?: string;
  deviceType?: string;
  cost?: number;
  touchTimestamp?: string;
}

export interface Touchpoint {
  touch_index: number;
  channel: string;
  source: string | null;
  creative_id: string | null;
  page_url: string | null;
  time_to_conversion_hours: number | null;
  cost: number;
  campaign_id: string | null;
}

export interface AttributionContribution {
  touch_index: number;
  channel: string;
  creative_id: string | null;
  weight: number;
  attributed_revenue: number;
}

export interface AttributionResult {
  chain_id: string;
  booking_id: string;
  model: AttributionModel;
  contributions: AttributionContribution[];
}

export interface CreativeAttribution {
  creative_id: string;
  channel: string;
  campaign_id: string | null;
  first_touch_conversions: number;
  last_touch_conversions: number;
  linear_conversions: number;
  time_decay_conversions: number;
  position_based_conversions: number;
  total_cost: number;
  attributed_revenue: number;
}

// ---------------------------------------------------------------------------
// Record a touch event
// ---------------------------------------------------------------------------

/**
 * 터치 이벤트 1건을 `attribution_touch_events`에 기록한다.
 *
 * @param event - 방문, 블로그 읽기, 광고 클릭, 이메일 오픈 등
 */
export async function recordTouchEvent(event: TouchEvent): Promise<void> {
  const { error } = await supabaseAdmin.from('attribution_touch_events').insert({
    visitor_id: event.visitorId,
    session_id: event.sessionId ?? null,
    event_type: event.eventType,
    channel: event.channel,
    source: event.source ?? null,
    medium: event.medium ?? null,
    campaign_id: event.campaignId ?? null,
    creative_id: event.creativeId ?? null,
    page_url: event.pageUrl ?? null,
    referrer_url: event.referrerUrl ?? null,
    device_type: event.deviceType ?? null,
    cost: event.cost ?? 0,
    touch_timestamp: event.touchTimestamp ?? new Date().toISOString(),
  });

  if (error) {
    throw new Error(`터치 이벤트 기록 실패: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Close an attribution chain (on conversion)
// ---------------------------------------------------------------------------

/**
 * 특정 visitor의 모든 터치 이벤트를 모아 하나의 attribution chain으로 close한다.
 *
 * 1. 해당 visitor_id의 지난 N일(기본 30일) 미전환 터치 이벤트 조회
 * 2. touchpoints JSONB 어레이 빌드
 * 3. first/last touch creative_id 식별
 * 4. attribution_chains INSERT
 * 5. 해당 touch_events에 booking_id + converted = true 마킹
 *
 * @param opts.visitorId    - 전환한 방문자 ID
 * @param opts.bookingId    - 연결할 예약 ID
 * @param opts.conversionAt - 전환 시각 (기본 now())
 * @param opts.windowDays   - attribution window 일수 (기본 30)
 */
export async function closeAttributionChain(opts: {
  visitorId: string;
  bookingId: string;
  conversionAt?: string;
  windowDays?: number;
}): Promise<{ chainId: string; touchCount: number }> {
  const windowDays = opts.windowDays ?? 30;
  const conversionAt = opts.conversionAt ?? new Date().toISOString();
  const cutoff = new Date(
    new Date(conversionAt).getTime() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 1. 터치 이벤트 조회 (지정 window 내, 미전환)
  const { data: events, error: queryError } = await supabaseAdmin
    .from('attribution_touch_events')
    .select('*')
    .eq('visitor_id', opts.visitorId)
    .eq('converted', false)
    .gte('touch_timestamp', cutoff)
    .lte('touch_timestamp', conversionAt)
    .order('touch_timestamp', { ascending: true });

  if (queryError) {
    throw new Error(`터치 이벤트 조회 실패: ${queryError.message}`);
  }

  if (!events || events.length === 0) {
    // 터치 이벤트 없이 전환된 경우 → 빈 체인이라도 기록 (direct 방문 등)
    const { data: chain, error: insertError } = await supabaseAdmin
      .from('attribution_chains')
      .insert({
        booking_id: opts.bookingId,
        visitor_id: opts.visitorId,
        first_visit_at: conversionAt,
        conversion_at: conversionAt,
        touchpoints: [],
        first_touch_creative_id: null,
        last_touch_creative_id: null,
        touch_count: 0,
        attribution_window_days: windowDays,
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Attribution chain 생성 실패: ${insertError.message}`);
    }

    return { chainId: chain!.id, touchCount: 0 };
  }

  const firstTouchTime = new Date(events[0].touch_timestamp).getTime();
  const conversionTime = new Date(conversionAt).getTime();

  // 2. touchpoints JSONB 빌드
  const touchpoints: Touchpoint[] = events.map((evt, idx) => ({
    touch_index: idx,
    channel: evt.channel,
    source: evt.source,
    creative_id: evt.creative_id,
    page_url: evt.page_url,
    time_to_conversion_hours:
      (conversionTime - new Date(evt.touch_timestamp).getTime()) /
      (1000 * 60 * 60),
    cost: Number(evt.cost) || 0,
    campaign_id: evt.campaign_id,
  }));

  // 3. first / last touch
  const firstCreativeId = events[0].creative_id ?? null;
  const lastCreativeId = events[events.length - 1].creative_id ?? null;

  // 4. attribution_chains INSERT
  const { data: chain, error: insertError } = await supabaseAdmin
    .from('attribution_chains')
    .insert({
      booking_id: opts.bookingId,
      visitor_id: opts.visitorId,
      first_visit_at: events[0].touch_timestamp,
      conversion_at: conversionAt,
      touchpoints,
      first_touch_creative_id: firstCreativeId,
      last_touch_creative_id: lastCreativeId,
      touch_count: events.length,
      attribution_window_days: windowDays,
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(`Attribution chain 생성 실패: ${insertError.message}`);
  }

  // 5. touch_events converted 마킹
  const eventIds = events.map((e) => e.id);
  const { error: updateError } = await supabaseAdmin
    .from('attribution_touch_events')
    .update({ converted: true, booking_id: opts.bookingId })
    .in('id', eventIds);

  if (updateError) {
    throw new Error(`터치 이벤트 전환 마킹 실패: ${updateError.message}`);
  }

  return { chainId: chain!.id, touchCount: events.length };
}

// ---------------------------------------------------------------------------
// Compute attribution weights
// ---------------------------------------------------------------------------

/**
 * 5가지 어트리뷰션 모델 중 하나로 각 터치포인트의 기여도를 계산한다.
 *
 * @param touchpoints  - 체인 내 전체 터치포인트
 * @param model        - 적용할 모델
 * @param totalRevenue - 예약 매출 (기여도 금액 산출용)
 */
export function computeAttribution(
  touchpoints: Touchpoint[],
  model: AttributionModel,
  totalRevenue: number,
): AttributionResult {
  if (touchpoints.length === 0) {
    return {
      chain_id: '',
      booking_id: '',
      model,
      contributions: [],
    };
  }

  const n = touchpoints.length;
  const weights = computeWeights(touchpoints, model, n);

  return {
    chain_id: '',
    booking_id: '',
    model,
    contributions: touchpoints.map((tp, idx) => ({
      touch_index: tp.touch_index,
      channel: tp.channel,
      creative_id: tp.creative_id,
      weight: weights[idx],
      attributed_revenue: +(weights[idx] * totalRevenue).toFixed(2),
    })),
  };
}

/**
 * 모델별 가중치 배열을 계산한다.
 * 결과는 항상 합계 1.0으로 정규화된다.
 */
function computeWeights(
  touchpoints: Touchpoint[],
  model: AttributionModel,
  n: number,
): number[] {
  switch (model) {
    case 'first_touch': {
      const w = new Array(n).fill(0);
      w[0] = 1;
      return w;
    }
    case 'last_touch': {
      const w = new Array(n).fill(0);
      w[n - 1] = 1;
      return w;
    }
    case 'linear': {
      return new Array(n).fill(1 / n);
    }
    case 'time_decay': {
      const raw = touchpoints.map((tp) =>
        tp.time_to_conversion_hours != null
          ? Math.exp(-0.1 * tp.time_to_conversion_hours)
          : 1,
      );
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map((v) => (sum > 0 ? v / sum : 0));
    }
    case 'position_based': {
      if (n === 1) return [1];
      if (n === 2) return [0.5, 0.5];
      const w = new Array(n).fill(0);
      w[0] = 0.4;
      w[n - 1] = 0.4;
      const middleWeight = 0.2 / (n - 2);
      for (let i = 1; i < n - 1; i++) {
        w[i] = middleWeight;
      }
      return w;
    }
    default:
      throw new Error(`알 수 없는 어트리뷰션 모델: ${model}`);
  }
}

// ---------------------------------------------------------------------------
// Refresh attribution summary
// ---------------------------------------------------------------------------

/**
 * 모든 attribution_chains를 집계하여 `attribution_summary`를 UPSERT한다.
 *
 * 채널(channel) × creative_id × campaign_id 단위로 5개 모델의 기여도를 계산한다.
 * 주기적 실행 (cron: 매시간 또는 매일)을 전제로 한다.
 */
export async function refreshAttributionSummary(): Promise<{ updated: number }> {
  // 1. 모든 체인 + 예약 조회
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: chains, error: chainError } = await supabaseAdmin
    .from('attribution_chains')
    .select(
      `
      id,
      booking_id,
      touchpoints,
      touch_count,
      first_touch_creative_id,
      last_touch_creative_id
    `,
    )
    .gte('created_at', thirtyDaysAgo);

  if (chainError) {
    throw new Error(`Attribution chains 조회 실패: ${chainError.message}`);
  }

  if (!chains || chains.length === 0) {
    return { updated: 0 };
  }

  // 2. booking별 매출 조회
  const bookingIds = [...new Set(chains.map((c) => c.booking_id).filter(Boolean))];
  const { data: bookings, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .select('id, total_price, total_profit')
    .in('id', bookingIds);

  if (bookingError) {
    throw new Error(`예약 정보 조회 실패: ${bookingError.message}`);
  }

  const revenueMap = new Map<string, { revenue: number; profit: number }>();
  for (const b of bookings ?? []) {
    revenueMap.set(b.id, {
      revenue: Number(b.total_price) || 0,
      profit: Number(b.total_profit) || 0,
    });
  }

  // 3. 체인별 기여도 산출 → (channel, creative_id, campaign_id) 단위 집계
  const summaries = new Map<
    string,
    {
      channel: string;
      creative_id: string | null;
      campaign_id: string | null;
      firstTouch: number;
      lastTouch: number;
      linear: number;
      timeDecay: number;
      positionBased: number;
      cost: number;
      revenue: number;
      profit: number;
    }
  >();

  function addToSummary(
    channel: string,
    creativeId: string | null,
    campaignId: string | null,
    weight: number,
    model: AttributionModel,
    cost: number,
    revenue: number,
    profit: number,
  ): void {
    const key = `${channel}|${creativeId ?? ''}|${campaignId ?? ''}`;
    let entry = summaries.get(key);
    if (!entry) {
      entry = {
        channel,
        creative_id: creativeId,
        campaign_id: campaignId,
        firstTouch: 0,
        lastTouch: 0,
        linear: 0,
        timeDecay: 0,
        positionBased: 0,
        cost: 0,
        revenue: 0,
        profit: 0,
      };
      summaries.set(key, entry);
    }

    // 각 모델별 conversion 기여도 누적
    if (model === 'first_touch') entry.firstTouch += 1;
    else if (model === 'last_touch') entry.lastTouch += 1;
    else if (model === 'linear') entry.linear += weight;
    else if (model === 'time_decay') entry.timeDecay += weight;
    else if (model === 'position_based') entry.positionBased += weight;

    entry.cost += cost;
    entry.revenue += weight * revenue;
    entry.profit += weight * profit;
  }

  for (const chain of chains) {
    const bookingInfo = revenueMap.get(chain.booking_id);
    const revenue = bookingInfo?.revenue ?? 0;
    const profit = bookingInfo?.profit ?? 0;

    let touchpoints: Touchpoint[];
    try {
      touchpoints =
        typeof chain.touchpoints === 'string'
          ? JSON.parse(chain.touchpoints)
          : (chain.touchpoints as Touchpoint[]);
    } catch {
      continue;
    }

    if (touchpoints.length === 0) continue;

    // 5개 모델 각각에 대해 기여도 계산
    const models: AttributionModel[] = [
      'first_touch',
      'last_touch',
      'linear',
      'time_decay',
      'position_based',
    ];

    for (const model of models) {
      const result = computeAttribution(touchpoints, model, revenue);
      for (const contrib of result.contributions) {
        const tp = touchpoints[contrib.touch_index];
        addToSummary(
          contrib.channel,
          contrib.creative_id,
          tp.campaign_id,
          contrib.weight,
          model,
          tp.cost,
          revenue,
          profit,
        );
      }
    }
  }

  // 4. UPSERT into attribution_summary
  let updated = 0;

  for (const entry of summaries.values()) {
    const { error: upsertError } = await supabaseAdmin
      .from('attribution_summary')
      .upsert(
        {
          channel: entry.channel,
          creative_id: entry.creative_id,
          campaign_id: entry.campaign_id,
          first_touch_conversions: entry.firstTouch,
          last_touch_conversions: entry.lastTouch,
          linear_conversions: +entry.linear.toFixed(4),
          time_decay_conversions: +entry.timeDecay.toFixed(4),
          position_based_conversions: +entry.positionBased.toFixed(4),
          total_cost: +entry.cost.toFixed(2),
          attributed_revenue: +entry.revenue.toFixed(2),
          attributed_profit: +entry.profit.toFixed(2),
          computed_at: new Date().toISOString(),
        },
        {
          onConflict: 'channel, creative_id, campaign_id',
          ignoreDuplicates: false,
        },
      );

    if (upsertError) {
      console.error(
        `[attribution-engine] summary UPSERT 실패 (channel=${entry.channel}): ${upsertError.message}`,
      );
    } else {
      updated++;
    }
  }

  return { updated };
}

// ---------------------------------------------------------------------------
// Get creative attribution
// ---------------------------------------------------------------------------

/**
 * 특정 소재(creative)의 어트리뷰션 정보를 조회한다.
 *
 * @param creativeId - content_creatives.id
 */
export async function getCreativeAttribution(
  creativeId: string,
): Promise<CreativeAttribution | null> {
  const { data, error } = await supabaseAdmin
    .from('attribution_summary')
    .select('*')
    .eq('creative_id', creativeId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`소재 어트리뷰션 조회 실패: ${error.message}`);
  }

  if (!data) return null;

  return {
    creative_id: data.creative_id,
    channel: data.channel,
    campaign_id: data.campaign_id,
    first_touch_conversions: data.first_touch_conversions,
    last_touch_conversions: data.last_touch_conversions,
    linear_conversions: data.linear_conversions,
    time_decay_conversions: data.time_decay_conversions,
    position_based_conversions: data.position_based_conversions,
    total_cost: Number(data.total_cost),
    attributed_revenue: Number(data.attributed_revenue),
  };
}
