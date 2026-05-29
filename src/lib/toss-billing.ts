/**
 * 여소남 OS — Toss Payments Billing 연동 SDK (Phase 3-3)
 *
 * 기능:
 *   - 테넌트별 billing_settings 관리
 *   - 월간 인보이스 생성 (API 키 사용량 기반)
 *   - Toss Payments 결제 요청/검증
 *   - 결제/청구 이력 기록
 *
 * 사용:
 *   import { createInvoice, confirmPayment } from '@/lib/toss-billing'
 *
 *   // 월간 청구서 생성
 *   const invoice = await createInvoice({
 *     tenantId: '...',
 *     year: 2026, month: 5,
 *     apiCallCount: 1500,
 *   })
 *
 *   // 결제 확인 (Toss Success 콜백)
 *   const result = await confirmPayment({
 *     paymentKey: '...', orderId: '...', amount: 50000,
 *   })
 */

import crypto from 'node:crypto'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'

const TOSS_API_URL = 'https://api.tosspayments.com/v1'

// ─── Toss Payments API 호출 ────────────────────────────────────────────

async function tossApi(
  method: string,
  path: string,
  secretKey: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const encoded = Buffer.from(`${secretKey}:`).toString('base64')
    const res = await fetch(`${TOSS_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data.message ?? 'Toss API 오류' }
    }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: `Toss API 호출 실패: ${err}` }
  }
}

// ─── Billing Settings ──────────────────────────────────────────────────

export interface BillingSettings {
  id: string
  tenantId: string
  tossSecretApiKey: string
  tossClientApiKey: string | null
  planType: 'free' | 'pay_as_you_go' | 'monthly' | 'annual'
  baseFee: number
  overageUnitPrice: number
  billingDay: number
  isActive: boolean
}

/**
 * 테넌트의 billing 설정을 조회한다.
 */
export async function getBillingSettings(tenantId: string): Promise<BillingSettings | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      id: data.id,
      tenantId: data.tenant_id,
      tossSecretApiKey: data.toss_secret_api_key,
      tossClientApiKey: data.toss_client_api_key,
      planType: data.plan_type,
      baseFee: data.base_fee,
      overageUnitPrice: data.overage_unit_price,
      billingDay: data.billing_day,
      isActive: data.is_active,
    }
  } catch (err) {
    console.warn('[toss-billing] 설정 조회 실패:', err)
    return null
  }
}

/**
 * billing 설정을 생성/갱신한다.
 */
export async function upsertBillingSettings(params: {
  tenantId: string
  tossSecretApiKey: string
  tossClientApiKey?: string
  planType?: string
  baseFee?: number
  overageUnitPrice?: number
  billingDay?: number
}): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  try {
    const { error } = await supabaseAdmin
      .from('billing_settings')
      .upsert({
        tenant_id: params.tenantId,
        toss_secret_api_key: params.tossSecretApiKey,
        toss_client_api_key: params.tossClientApiKey ?? null,
        plan_type: params.planType ?? 'pay_as_you_go',
        base_fee: params.baseFee ?? 0,
        overage_unit_price: params.overageUnitPrice ?? 0,
        billing_day: params.billingDay ?? 1,
      }, { onConflict: 'tenant_id' })

    if (error) throw error
    return true
  } catch (err) {
    console.warn('[toss-billing] 설정 저장 실패:', err)
    return false
  }
}

// ─── Invoice 생성 ──────────────────────────────────────────────────────

export interface CreateInvoiceParams {
  tenantId: string
  year: number
  month: number
  /** 이번 달 API 호출 수 */
  apiCallCount: number
}

export interface Invoice {
  id: string
  tenantId: string
  totalAmount: number
  baseFee: number
  overageCount: number
  overageAmount: number
  status: string
}

/**
 * 월간 청구서를 생성한다.
 * free_plan: 무료
 * pay_as_you_go: base_fee + apiCallCount × overage_unit_price
 * monthly/annual: base_fee 고정
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice | null> {
  if (!isSupabaseConfigured) return null

  const settings = await getBillingSettings(params.tenantId)
  if (!settings || !settings.isActive) {
    console.warn('[toss-billing] billing 설정 없음 또는 비활성')
    return null
  }

  const overageThreshold = 1000 // 무료 포함 기준 호출 수

  let baseFee = settings.baseFee
  let overageCount = 0
  let overageAmount = 0

  if (settings.planType === 'pay_as_you_go') {
    if (params.apiCallCount > overageThreshold) {
      overageCount = params.apiCallCount - overageThreshold
      overageAmount = overageCount * settings.overageUnitPrice
    }
  } else if (settings.planType === 'free') {
    baseFee = 0
  }

  const totalAmount = baseFee + overageAmount

  const orderId = `invoice-${params.tenantId}-${params.year}-${params.month}-${Date.now().toString(36)}`

  try {
    const { data, error } = await supabaseAdmin
      .from('billing_invoices')
      .upsert({
        tenant_id: params.tenantId,
        period_year: params.year,
        period_month: params.month,
        base_fee: baseFee,
        overage_count: overageCount,
        overage_amount: overageAmount,
        total_amount: totalAmount,
        status: 'pending',
        toss_order_id: orderId,
      }, { onConflict: 'tenant_id,period_year,period_month' })
      .select('id, tenant_id, total_amount, base_fee, overage_count, overage_amount, status')
      .single()

    if (error) throw error
    if (!data) return null

    // billing_history 기록
    await supabaseAdmin.from('billing_history').insert({
      tenant_id: params.tenantId,
      event_type: 'invoice_created',
      invoice_id: data.id,
      amount: totalAmount,
      description: `${params.year}년 ${params.month}월 청구서 생성 (API 호출 ${params.apiCallCount}건)`,
      metadata: { api_call_count: params.apiCallCount },
    })

    return {
      id: data.id,
      tenantId: data.tenant_id,
      totalAmount: data.total_amount,
      baseFee: data.base_fee,
      overageCount: data.overage_count,
      overageAmount: data.overage_amount,
      status: data.status,
    }
  } catch (err) {
    console.warn('[toss-billing] 인보이스 생성 실패:', err)
    return null
  }
}

// ─── 결제 ──────────────────────────────────────────────────────────────

export interface PaymentResult {
  success: boolean
  paymentKey?: string
  orderId?: string
  amount?: number
  error?: string
}

/**
 * Toss Payments 결제 승인 요청 (서버사이드).
 * 클라이언트가 Toss SDK 로 결제 → success 콜백에서 paymentKey 받음 → 서버에서 승인.
 */
export async function confirmPayment(params: {
  tenantId: string
  paymentKey: string
  orderId: string
  amount: number
}): Promise<PaymentResult> {
  const settings = await getBillingSettings(params.tenantId)
  if (!settings) return { success: false, error: 'billing 설정 없음' }

  const result = await tossApi('POST', '/payments/confirm', settings.tossSecretApiKey, {
    paymentKey: params.paymentKey,
    orderId: params.orderId,
    amount: params.amount,
  })

  if (!result.ok) {
    // billing_history 실패 기록
    await recordBillingEvent({
      tenantId: params.tenantId,
      eventType: 'payment_failed',
      amount: params.amount,
      description: `결제 실패: ${result.error}`,
      metadata: { payment_key: params.paymentKey, order_id: params.orderId },
    })
    return { success: false, error: result.error }
  }

  // 인보이스 업데이트
  await supabaseAdmin
    .from('billing_invoices')
    .update({
      status: 'paid',
      toss_payment_key: params.paymentKey,
      paid_at: new Date().toISOString(),
    })
    .eq('toss_order_id', params.orderId)

  // billing_history 성공 기록
  await recordBillingEvent({
    tenantId: params.tenantId,
    eventType: 'payment_succeeded',
    invoiceId: null, // orderId로 찾을 수 있음
    amount: params.amount,
    description: `결제 성공: ${params.amount}원`,
    metadata: { payment_key: params.paymentKey, order_id: params.orderId },
  })

  return {
    success: true,
    paymentKey: params.paymentKey,
    orderId: params.orderId,
    amount: params.amount,
  }
}

/**
 * 정기 결제용 — Toss Payments 자동 결제 (billing key 기반).
 */
export async function requestAutoPayment(params: {
  tenantId: string
  invoiceId: string
  amount: number
}): Promise<PaymentResult> {
  const settings = await getBillingSettings(params.tenantId)
  if (!settings) return { success: false, error: 'billing 설정 없음' }

  // Toss Billing API: POST /billing/{billingKey}
  // billingKey 는 사전에 Toss SDK로 발급받아 billing_settings.metadata 에 저장
  const billingKey = (await supabaseAdmin
    .from('billing_settings')
    .select('metadata')
    .eq('tenant_id', params.tenantId)
    .single()
  ).data?.metadata?.billingKey

  if (!billingKey) {
    return { success: false, error: 'billing key 없음. 자동 결제 미등록' }
  }

  const orderId = `auto-${params.invoiceId}-${Date.now()}`
  const result = await tossApi('POST', `/billing/${billingKey}`, settings.tossSecretApiKey, {
    customerKey: params.tenantId,
    amount: params.amount,
    orderId,
    orderName: `여소남 ${settings.planType} 요금제`,
  })

  if (!result.ok) {
    await recordBillingEvent({
      tenantId: params.tenantId,
      eventType: 'payment_failed',
      amount: params.amount,
      description: `자동 결제 실패: ${result.error}`,
      metadata: { invoice_id: params.invoiceId },
    })
    return { success: false, error: result.error }
  }

  await supabaseAdmin
    .from('billing_invoices')
    .update({ status: 'paid', toss_payment_key: (result.data as Record<string, unknown>)?.paymentKey as string, paid_at: new Date().toISOString() })
    .eq('id', params.invoiceId)

  await recordBillingEvent({
    tenantId: params.tenantId,
    eventType: 'payment_succeeded',
    invoiceId: params.invoiceId,
    amount: params.amount,
    description: `자동 결제 성공: ${params.amount}원`,
    metadata: { order_id: orderId },
  })

  return { success: true, orderId, amount: params.amount }
}

// ─── Billing History ───────────────────────────────────────────────────

async function recordBillingEvent(params: {
  tenantId: string
  eventType: string
  invoiceId?: string | null
  amount: number
  description?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await supabaseAdmin.from('billing_history').insert({
      tenant_id: params.tenantId,
      event_type: params.eventType,
      invoice_id: params.invoiceId ?? null,
      amount: params.amount,
      description: params.description ?? null,
      metadata: params.metadata ?? {},
    })
  } catch (err) {
    console.warn('[toss-billing] 이벤트 기록 실패:', err)
  }
}

// ─── Tenant 온보딩 (Phase 3-2/3-3 통합) ───────────────────────────────

export interface OnboardTenantParams {
  tenantId: string
  tossSecretApiKey: string
  tossClientApiKey?: string
  planType?: string
  baseFee?: number
  overageUnitPrice?: number
}

/**
 * 새 테넌트 온보딩: billing_settings 생성 + 초기 invoice 생성.
 */
export async function onboardTenant(params: OnboardTenantParams): Promise<boolean> {
  // 1. billing 설정 저장
  const settingsOk = await upsertBillingSettings({
    tenantId: params.tenantId,
    tossSecretApiKey: params.tossSecretApiKey,
    tossClientApiKey: params.tossClientApiKey,
    planType: params.planType,
    baseFee: params.baseFee,
    overageUnitPrice: params.overageUnitPrice,
  })

  if (!settingsOk) return false

  // 2. welcome 이벤트 기록
  await recordBillingEvent({
    tenantId: params.tenantId,
    eventType: 'plan_changed',
    amount: 0,
    description: `테넌트 온보딩 완료 (${params.planType ?? 'pay_as_you_go'})`,
    metadata: { plan_type: params.planType },
  })

  return true
}
