import { supabaseAdmin } from '@/lib/supabase'
import { applySettlementApproval, type SettlementDraft } from '@/lib/affiliate/settlement-calc'

// ── 실행 결과 타입 ──────────────────────────────────────────────────
export interface ExecutionResult {
  success: boolean
  data?: any
  error?: string
}

// ── 액션 실행 핸들러 맵 ─────────────────────────────────────────────
// 기존 /api/jarvis/approve/route.ts의 executeApprovedAction()에서 추출
// agent_actions, jarvis_pending_actions 양쪽에서 공통 사용
const handlers: Record<string, (args: any) => Promise<any>> = {
  // 프롬프트 개선 제안 승인: 로그만 남기고 실제 프롬프트는 개발자가 코드 반영
  // (자동 프롬프트 수정은 위험하므로 "아카이브"만 하고 실제 변경은 수동)
  prompt_improvement_suggestion: async (args) => {
    // 향후 확장: prompt_versions 테이블에 기록 등
    return {
      acknowledged: true,
      note: '승인됨. 차기 프롬프트 버전 업데이트 시 반영하세요.',
      suggestion_summary: args?.analysis?.summary || null,
    }
  },

  create_package: async (args) => {
    const { data, error } = await supabaseAdmin
      .from('travel_packages')
      .insert(args)
      .select()
    if (error) throw error
    return data?.[0]
  },

  create_booking: async (args) => {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .insert(args)
      .select()
    if (error) throw error
    return data?.[0]
  },

  update_booking_status: async (args) => {
    const { booking_id, status, reason } = args
    const updateData: any = { status }
    if (reason) updateData.status_reason = reason
    const { error } = await supabaseAdmin
      .from('bookings')
      .update(updateData)
      .eq('id', booking_id)
    if (error) throw error
    return { updated: true, booking_id, status }
  },

  create_customer: async (args) => {
    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert(args)
      .select()
    if (error) throw error
    return data?.[0]
  },

  update_customer: async (args) => {
    const { customer_id, ...updateFields } = args
    const { error } = await supabaseAdmin
      .from('customers')
      .update(updateFields)
      .eq('id', customer_id)
    if (error) throw error
    return { updated: true, customer_id }
  },

  match_payment: async (args) => {
    const { error } = await supabaseAdmin
      .from('bank_transactions')
      .update({ booking_id: args.booking_id, match_status: 'manual' })
      .eq('id', args.transaction_id)
    if (error) throw error
    return { matched: true }
  },

  send_booking_guide: async (args) => {
    await supabaseAdmin.from('message_logs').insert({
      booking_id: args.booking_id,
      event_type: args.guide_type || 'BOOKING_GUIDE',
      channel: 'jarvis',
      status: 'sent',
      content: '자비스를 통해 안내문 발송',
    })
    return { sent: true }
  },

  update_package_status: async (args) => {
    const { error } = await supabaseAdmin
      .from('travel_packages')
      .update({ status: args.status })
      .eq('id', args.package_id)
    if (error) throw error
    return { updated: true }
  },

  create_settlement: async (args) => {
    const { data, error } = await supabaseAdmin
      .from('settlements')
      .insert(args)
      .select()
    if (error) throw error
    return data?.[0]
  },

  update_rfq_status: async (args) => {
    const { rfq_id, status, reason } = args
    const updateData: any = { status }
    if (reason) updateData.status_reason = reason
    const { error } = await supabaseAdmin
      .from('rfqs')
      .update(updateData)
      .eq('id', rfq_id)
    if (error) throw error
    return { updated: true }
  },

  update_policy: async (args) => {
    const { id, ...updateFields } = args
    const { error } = await supabaseAdmin
      .from('os_policies')
      .update(updateFields)
      .eq('id', id)
    if (error) throw error
    return { updated: true }
  },

  approve_monthly_settlement: async (args) => {
    const draft = args as SettlementDraft
    if (!draft?.affiliate_id || !draft?.period) {
      throw new Error('approve_monthly_settlement: affiliate_id/period 필수')
    }
    await applySettlementApproval(draft)
    return {
      settled: true,
      affiliate_id: draft.affiliate_id,
      period: draft.period,
      status: draft.qualified ? 'READY' : 'PENDING(이월)',
      final_payout: draft.final_payout,
    }
  },

  notify_affiliate_anomaly: async (args) => {
    const { affiliate_id, affiliate_name, kind, detail } = args || {}
    await supabaseAdmin.from('audit_logs').insert({
      action: 'AFFILIATE_ANOMALY_ACK',
      target_type: 'affiliate',
      target_id: affiliate_id,
      description: `${affiliate_name} ${kind} 이상탐지 확인`,
      after_value: { kind, detail },
    }).then(() => {}).catch(() => {})
    return { acknowledged: true, kind, affiliate_id, affiliate_name }
  },

  // ── 고객 병합 (Phase 1 dedup) ─────────────────────────────────────
  // primary_id를 생존시키고, duplicate_id의 모든 참조를 primary_id로 이관 후 soft-delete
  // 단계별 에러 컨텍스트 포함: "merge_customers[step=load]: column 'xxx' does not exist"
  merge_customers: async (args) => {
    const wrap = (step: string) => (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`merge_customers[step=${step}]: ${msg}`)
    }

    const { primary_id, duplicate_id } = args || {}
    if (!primary_id || !duplicate_id) {
      throw new Error('merge_customers: primary_id와 duplicate_id 필수')
    }
    if (primary_id === duplicate_id) {
      throw new Error('merge_customers: 동일 고객 병합 불가')
    }

    // 1) 두 고객 로드
    const { data: pair, error: loadErr } = await supabaseAdmin
      .from('customers')
      .select('id, name, phone, email, mileage, memo, total_spent, deleted_at')
      .in('id', [primary_id, duplicate_id])
    if (loadErr) wrap('load')(loadErr)

    const primary = (pair ?? []).find((c: any) => c.id === primary_id) as any
    const duplicate = (pair ?? []).find((c: any) => c.id === duplicate_id) as any
    if (!primary) throw new Error(`merge_customers[step=load]: primary 고객 미존재 (${primary_id})`)
    if (!duplicate) throw new Error(`merge_customers[step=load]: duplicate 고객 미존재 (${duplicate_id})`)
    if (duplicate.deleted_at) throw new Error('merge_customers[step=load]: duplicate 고객은 이미 삭제됨')

    // 2) 필드 병합 (primary 우선, 비어있을 때만 duplicate에서 보충)
    const mergedFields: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (!primary.phone && duplicate.phone) mergedFields.phone = duplicate.phone
    if (!primary.email && duplicate.email) mergedFields.email = duplicate.email
    mergedFields.mileage = (primary.mileage || 0) + (duplicate.mileage || 0)
    mergedFields.total_spent = (primary.total_spent || 0) + (duplicate.total_spent || 0)
    if (duplicate.memo) {
      mergedFields.memo = [primary.memo, `[병합:${duplicate.name}] ${duplicate.memo}`].filter(Boolean).join('\n')
    }

    const { error: mergeErr } = await supabaseAdmin.from('customers').update(mergedFields).eq('id', primary_id)
    if (mergeErr) wrap('merge_fields')(mergeErr)

    // 3) 참조 테이블 일괄 이관 (lead_customer_id, customer_id 등)
    //   - select(id) 로 반환 → data.length 로 이관 건수 산출 (count head 문법 이슈 회피)
    //   - 테이블/컬럼 부재만 조용히 스킵. 나머지 DB 에러는 원문 throw
    const reassignResults: Record<string, number> = {}
    const NOT_FOUND_PATTERNS = ['Could not find', 'does not exist', 'schema cache', 'relation ']

    const reassign = async (table: string, column: string) => {
      const { data, error } = await supabaseAdmin
        .from(table)
        .update({ [column]: primary_id })
        .eq(column, duplicate_id)
        .select('id')
      if (error) {
        const isNotFound = NOT_FOUND_PATTERNS.some(p => error.message.includes(p))
        if (isNotFound) {
          reassignResults[table] = 0
          return
        }
        wrap(`reassign.${table}`)(error)
      }
      reassignResults[table] = (data ?? []).length
    }

    await reassign('bookings', 'lead_customer_id')
    await reassign('customer_facts', 'customer_id')
    await reassign('conversations', 'customer_id')
    await reassign('leads', 'customer_id')
    await reassign('message_logs', 'customer_id')

    // 4) duplicate 고객 soft-delete
    const { error: delErr } = await supabaseAdmin
      .from('customers')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', duplicate_id)
    if (delErr) wrap('soft_delete')(delErr)

    // 5) 감사 로그 (실패해도 병합 자체는 성공 처리 — 원문은 console에만)
    const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
      action: 'CUSTOMER_MERGE',
      target_type: 'customer',
      target_id: primary_id,
      description: `${duplicate.name}(${duplicate_id}) → ${primary.name}(${primary_id}) 병합`,
      after_value: { merged_fields: mergedFields, reassigned: reassignResults },
    } as never)
    if (auditErr) console.warn('[merge_customers] audit_logs insert 실패:', auditErr.message)

    return {
      merged: true,
      primary_id,
      duplicate_id,
      reassigned: reassignResults,
      merged_fields: Object.keys(mergedFields).filter(k => k !== 'updated_at'),
    }
  },
}

// ── 공통 실행 함수 ──────────────────────────────────────────────────
export async function executeAction(
  actionType: string,
  payload: any,
): Promise<ExecutionResult> {
  const handler = handlers[actionType]
  if (!handler) {
    return { success: false, error: `핸들러 미구현: ${actionType}` }
  }

  try {
    const data = await handler(payload)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
