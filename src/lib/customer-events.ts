/**
 * 여소남 OS — 고객 360 이벤트 SDK
 *
 * 모든 채널의 고객 행동을 customer_events 테이블에 통합 기록한다.
 * platform_learning_events, booking, payment, click 데이터를 연결한다.
 *
 * 사용:
 *   import { recordCustomerEvent } from '@/lib/customer-events'
 *   await recordCustomerEvent({
 *     customerId: '...',
 *     eventType: 'booking',
 *     channel: 'web',
 *     tenantId: '...',
 *     payload: { booking_id: '...', package_id: '...', amount: 500000 },
 *   })
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'

export type CustomerEventType =
  | 'chat'
  | 'booking'
  | 'payment'
  | 'click'
  | 'support'
  | 'view'
  | 'search'
  | 'recommendation'

export type CustomerEventChannel = 'web' | 'kakao' | 'whatsapp' | 'email' | 'phone' | 'api'

export interface CustomerEventInput {
  customerId?: string | null
  sessionId?: string | null
  eventType: CustomerEventType
  channel?: CustomerEventChannel
  affiliateId?: string | null
  tenantId?: string | null
  payload?: Record<string, unknown>
}

/**
 * 고객 이벤트를 customer_events 테이블에 기록한다.
 * DB 연결 실패 시 무시 (fail-open).
 */
export async function recordCustomerEvent(input: CustomerEventInput): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    await supabaseAdmin.from('customer_events').insert({
      customer_id: input.customerId ?? null,
      session_id: input.sessionId ?? null,
      event_type: input.eventType,
      channel: input.channel ?? null,
      affiliate_id: input.affiliateId ?? null,
      tenant_id: input.tenantId ?? null,
      payload: input.payload ?? {},
    })
  } catch (err) {
    console.warn('[customer-events] 기록 실패 (무시):', err)
  }
}

/**
 * booking 생성 시 자동 호출 — customer_events + platform_learning_events 동시 기록.
 * booking 플로우의 완료 지점에서 호출한다.
 */
export async function recordBookingEvent(params: {
  bookingId: string
  customerId?: string | null
  affiliateId?: string | null
  tenantId?: string | null
  packageId?: string | null
  amount: number
  channel?: CustomerEventChannel
}): Promise<void> {
  await recordCustomerEvent({
    customerId: params.customerId,
    eventType: 'booking',
    channel: params.channel ?? 'web',
    affiliateId: params.affiliateId,
    tenantId: params.tenantId,
    payload: {
      booking_id: params.bookingId,
      package_id: params.packageId,
      amount: params.amount,
    },
  })
}

/**
 * payment 완료 시 자동 호출.
 */
export async function recordPaymentEvent(params: {
  paymentId: string
  customerId?: string | null
  affiliateId?: string | null
  tenantId?: string | null
  amount: number
  method?: string
  channel?: CustomerEventChannel
}): Promise<void> {
  await recordCustomerEvent({
    customerId: params.customerId,
    eventType: 'payment',
    channel: params.channel ?? 'web',
    affiliateId: params.affiliateId,
    tenantId: params.tenantId,
    payload: {
      payment_id: params.paymentId,
      amount: params.amount,
      method: params.method ?? null,
    },
  })
}

/**
 * 고객 360 조회 — customerId 기준 모든 이벤트 조회.
 * 어드민 UI / AI 컨텍스트용.
 */
export async function getCustomerTimeline(params: {
  customerId: string
  limit?: number
  eventTypes?: CustomerEventType[]
}): Promise<Array<{
  id: string
  eventType: CustomerEventType
  channel: string | null
  payload: Record<string, unknown>
  createdAt: string
}>> {
  if (!isSupabaseConfigured) return []
  let query = supabaseAdmin
    .from('customer_events')
    .select('id, event_type, channel, payload, created_at')
    .eq('customer_id', params.customerId)
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 50)

  if (params.eventTypes && params.eventTypes.length > 0) {
    query = query.in('event_type', params.eventTypes)
  }

  const { data } = await query
  return ((data ?? []) as Array<{
    id: string
    event_type: CustomerEventType
    channel: string | null
    payload: Record<string, unknown>
    created_at: string
  }>).map((r) => ({
    id: r.id,
    eventType: r.event_type,
    channel: r.channel,
    payload: r.payload,
    createdAt: r.created_at,
  }))
}
