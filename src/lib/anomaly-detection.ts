/**
 * 여소남 OS — 이상 징후 탐지 서비스 (Phase 2-3)
 *
 * SQL 기반 1차 탐지 + anomaly_alerts 통합 로그.
 * Python Isolation Forest ML 모델 결과도 anomaly_alerts 에 저장.
 *
 * 사용:
 *   import { runAnomalyDetection, acknowledgeAlert } from '@/lib/anomaly-detection'
 *
 *   // 어드민 대시보드: 수동 실행
 *   const alerts = await runAnomalyDetection()
 *
 *   // 어드민: 알림 확인
 *   await acknowledgeAlert({ alertId: '...', userId: '...' })
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'

export type AlertType = 'settlement' | 'commission' | 'booking_volume' | 'ml_anomaly'
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AnomalyAlert {
  id: string
  alertType: AlertType
  severity: Severity
  sourceTable: string | null
  sourceId: string | null
  tenantId: string | null
  message: string | null
  details: Record<string, unknown>
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  createdAt: string
}

/**
 * SQL 뷰 기반 이상 징후를 탐지하고 anomaly_alerts 에 기록한다.
 */
export async function runAnomalyDetection(): Promise<AnomalyAlert[]> {
  if (!isSupabaseConfigured) return []
  const newAlerts: AnomalyAlert[] = []

  try {
    // 1. 정산 이상
    const { data: settlementAlerts } = await supabaseAdmin
      .from('anomaly_settlement_alerts')
      .select('*')
      .limit(50)

    for (const alert of (settlementAlerts ?? []) as Array<{
      settlement_id: string
      tenant_id: string | null
      anomaly_level: string
      amount: number
      z_score: number
    }>) {
      const severity = alert.anomaly_level === 'CRITICAL' ? 'CRITICAL' : 'WARNING'
      const alertRec = await insertAlert({
        alertType: 'settlement',
        severity,
        sourceTable: 'settlements',
        sourceId: alert.settlement_id,
        tenantId: alert.tenant_id,
        message: `정산 이상 탐지: ${alert.amount}원 (z-score: ${alert.z_score})`,
        details: { amount: alert.amount, zScore: alert.z_score },
      })
      if (alertRec) newAlerts.push(alertRec)
    }

    // 2. 예약 급증/급감
    const { data: volumeAlerts } = await supabaseAdmin
      .from('anomaly_booking_volume_alerts')
      .select('*')
      .limit(20)

    for (const alert of (volumeAlerts ?? []) as Array<{
      day: string
      cnt: number
      alert_type: string
      avg_daily: number
    }>) {
      const severity: Severity = alert.alert_type === 'SURGE' ? 'WARNING' : 'INFO'
      const alertRec = await insertAlert({
        alertType: 'booking_volume',
        severity,
        sourceTable: 'bookings',
        sourceId: null,
        tenantId: null,
        message: `예약 ${alert.alert_type === 'SURGE' ? '급증' : '급감'}: ${alert.day} ${alert.cnt}건 (평균: ${Math.round(alert.avg_daily)}건)`,
        details: { day: alert.day, count: alert.cnt, avgDaily: alert.avg_daily, alertType: alert.alert_type },
      })
      if (alertRec) newAlerts.push(alertRec)
    }
  } catch (err) {
    console.warn('[anomaly-detection] 탐지 실패:', err)
  }

  return newAlerts
}

async function insertAlert(params: {
  alertType: AlertType
  severity: Severity
  sourceTable?: string
  sourceId?: string | null
  tenantId?: string | null
  message: string
  details?: Record<string, unknown>
}): Promise<AnomalyAlert | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('anomaly_alerts')
      .insert({
        alert_type: params.alertType,
        severity: params.severity,
        source_table: params.sourceTable ?? null,
        source_id: params.sourceId ?? null,
        tenant_id: params.tenantId ?? null,
        message: params.message,
        details: params.details ?? {},
      })
      .select('id, alert_type, severity, source_table, source_id, tenant_id, message, details, acknowledged_at, acknowledged_by, created_at')
      .single()

    if (error) throw error
    if (!data) return null

    return {
      id: data.id,
      alertType: data.alert_type as AlertType,
      severity: data.severity as Severity,
      sourceTable: data.source_table,
      sourceId: data.source_id,
      tenantId: data.tenant_id,
      message: data.message,
      details: (data.details ?? {}) as Record<string, unknown>,
      acknowledgedAt: data.acknowledged_at,
      acknowledgedBy: data.acknowledged_by,
      createdAt: data.created_at,
    }
  } catch (err) {
    console.warn('[anomaly-detection] alert 저장 실패:', err)
    return null
  }
}

/**
 * 미확인 알림 목록을 조회한다.
 */
export async function getUnacknowledgedAlerts(params: {
  tenantId?: string
  limit?: number
} = {}): Promise<AnomalyAlert[]> {
  if (!isSupabaseConfigured) return []
  try {
    let query = supabaseAdmin
      .from('anomaly_alerts')
      .select('id, alert_type, severity, source_table, source_id, tenant_id, message, details, acknowledged_at, acknowledged_by, created_at')
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 50)

    if (params.tenantId) {
      query = query.eq('tenant_id', params.tenantId)
    }

    const { data } = await query
    return ((data ?? []) as Array<{
      id: string
      alert_type: string
      severity: string
      source_table: string | null
      source_id: string | null
      tenant_id: string | null
      message: string | null
      details: unknown
      acknowledged_at: string | null
      acknowledged_by: string | null
      created_at: string
    }>).map((r) => ({
      id: r.id,
      alertType: r.alert_type as AlertType,
      severity: r.severity as Severity,
      sourceTable: r.source_table,
      sourceId: r.source_id,
      tenantId: r.tenant_id,
      message: r.message,
      details: (r.details ?? {}) as Record<string, unknown>,
      acknowledgedAt: r.acknowledged_at,
      acknowledgedBy: r.acknowledged_by,
      createdAt: r.created_at,
    }))
  } catch (err) {
    console.warn('[anomaly-detection] 조회 실패:', err)
    return []
  }
}

/**
 * 알림을 확인 처리한다.
 */
export async function acknowledgeAlert(params: {
  alertId: string
  userId: string
}): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  try {
    const { error } = await supabaseAdmin
      .from('anomaly_alerts')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: params.userId,
      })
      .eq('id', params.alertId)

    if (error) throw error
    return true
  } catch (err) {
    console.warn('[anomaly-detection] acknowledge 실패:', err)
    return false
  }
}

/**
 * Python Isolation Forest 결과를 anomaly_alerts 에 저장한다.
 */
export async function importMlAnomalyResults(
  results: Array<{
    severity: Severity
    sourceTable: string
    sourceId: string
    tenantId?: string
    message: string
    details: Record<string, unknown>
  }>,
): Promise<number> {
  let count = 0
  for (const r of results) {
    const alert = await insertAlert({
      alertType: 'ml_anomaly',
      severity: r.severity,
      sourceTable: r.sourceTable,
      sourceId: r.sourceId,
      tenantId: r.tenantId,
      message: r.message,
      details: r.details,
    })
    if (alert) count++
  }
  return count
}
