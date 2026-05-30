/**
 * 여소남 OS — 추천 전환 피드백 루프 SDK
 *
 * Phase 2-1: LLM 추천 → 클릭 → 예약 전환율 측정 및 역추적.
 *
 * 사용:
 *   import { recordRecommendation, recordClick, recordBookingConversion } from '@/lib/recommendation-events'
 *
 *   // LLM이 추천할 때
 *   const ev = await recordRecommendation({
 *     sessionId: '...', customerId: '...', tenantId: '...',
 *     recommendedIds: ['pkg_1', 'pkg_2', 'pkg_3'],
 *     source: 'concierge',
 *   })
 *
 *   // 사용자가 추천 상품을 클릭했을 때
 *   await recordClick({ sessionId: '...', clickedId: 'pkg_1' })
 *
 *   // 예약이 실제로 생성되었을 때
 *   await recordBookingConversion({ sessionId: '...', bookedId: 'booking_abc' })
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'

export interface RecordRecommendationParams {
  sessionId?: string | null
  customerId?: string | null
  tenantId?: string | null
  recommendedIds: string[]
  source?: string
  metadata?: Record<string, unknown>
}

/**
 * LLM이 패키지를 추천할 때 호출한다.
 * recommendation_events 행을 생성하고 ID를 반환한다.
 */
export async function recordRecommendation(
  params: RecordRecommendationParams,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabaseAdmin
      .from('recommendation_events')
      .insert({
        session_id: params.sessionId ?? null,
        customer_id: params.customerId ?? null,
        tenant_id: params.tenantId ?? null,
        recommended_ids: params.recommendedIds,
        funnel: ['recommended'],
        source: params.source ?? 'concierge',
        metadata: params.metadata ?? {},
      })
      .select('id')
      .single()

    if (error) throw error
    return data?.id ?? null
  } catch (err) {
    console.warn('[recommendation-events] 기록 실패:', err)
    return null
  }
}

export interface RecordClickParams {
  sessionId?: string | null
  clickedId: string
}

/**
 * 사용자가 추천 상품을 클릭했을 때 호출한다.
 * 같은 session_id 의 가장 최신 recommendation_events 행을 찾아 clicked_id + funnel 업데이트.
 */
export async function recordClick(params: RecordClickParams): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    const { data: recent } = await supabaseAdmin
      .from('recommendation_events')
      .select('id, funnel')
      .eq('session_id', params.sessionId ?? '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!recent) {
      console.warn('[recommendation-events] click 기록 실패: session_id 없음')
      return
    }

    const funnel = Array.from(new Set([...(recent.funnel as string[] ?? []), 'clicked']))
    await supabaseAdmin
      .from('recommendation_events')
      .update({
        clicked_id: params.clickedId,
        funnel,
      })
      .eq('id', recent.id)
  } catch (err) {
    console.warn('[recommendation-events] click 업데이트 실패:', err)
  }
}

export interface RecordBookingConversionParams {
  sessionId?: string | null
  bookedId: string
}

/**
 * 예약이 생성되었을 때 호출한다.
 * 같은 session_id 의 가장 최신 recommendation_events 행을 찾아 booked_id + funnel 업데이트.
 */
export async function recordBookingConversion(params: RecordBookingConversionParams): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    const { data: recent } = await supabaseAdmin
      .from('recommendation_events')
      .select('id, funnel')
      .eq('session_id', params.sessionId ?? '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!recent) {
      console.warn('[recommendation-events] booking 기록 실패: session_id 없음')
      return
    }

    const funnel = Array.from(new Set([...(recent.funnel as string[] ?? []), 'booked']))
    await supabaseAdmin
      .from('recommendation_events')
      .update({
        booked_id: params.bookedId,
        funnel,
      })
      .eq('id', recent.id)
  } catch (err) {
    console.warn('[recommendation-events] booking 업데이트 실패:', err)
  }
}

/**
 * 특정 기간의 전환 통계를 조회한다.
 */
export async function getConversionStats(params: {
  tenantId?: string
  days?: number
}): Promise<Array<{
  source: string
  total: number
  clicks: number
  bookings: number
  clickRate: number
  bookingRate: number
  overallConversion: number
}>> {
  if (!isSupabaseConfigured) return []
  try {
    let query = supabaseAdmin
      .from('recommendation_conversion_stats')
      .select('*')

    if (params.tenantId) {
      query = query.eq('tenant_id', params.tenantId)
    }

    const { data } = await query
    return ((data ?? []) as Array<{
      source: string
      total_recommendations: number
      total_clicks: number
      total_bookings: number
      click_rate_pct: number
      booking_rate_from_click_pct: number
      overall_conversion_pct: number
    }>).map((r) => ({
      source: r.source,
      total: r.total_recommendations,
      clicks: r.total_clicks,
      bookings: r.total_bookings,
      clickRate: r.click_rate_pct,
      bookingRate: r.booking_rate_from_click_pct,
      overallConversion: r.overall_conversion_pct,
    }))
  } catch (err) {
    console.warn('[recommendation-events] 통계 조회 실패:', err)
    return []
  }
}
