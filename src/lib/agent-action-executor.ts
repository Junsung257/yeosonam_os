import { supabaseAdmin } from '@/lib/supabase'
import { applySettlementApproval, type SettlementDraft } from '@/lib/affiliate/settlement-calc'
import { executeGenerateVariantsJob } from '@/lib/card-news-html/variant-job'
import { getSecret } from '@/lib/secret-registry'
import { executeOperationsTool } from '@/lib/jarvis/agents/operations'
import { executeProductsTool } from '@/lib/jarvis/agents/products'
import { executeFinanceTool } from '@/lib/jarvis/agents/finance'
import { executeMarketingTool } from '@/lib/jarvis/agents/marketing'
import { executeSalesTool } from '@/lib/jarvis/agents/sales'
import { executeSystemTool } from '@/lib/jarvis/agents/system'

function resolveAppOriginForInternalFetch(): string {
  const explicit = getSecret('NEXT_PUBLIC_APP_URL') || getSecret('NEXT_PUBLIC_BASE_URL')
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`
}

function resolvePublicSiteOrigin(): string {
  const explicit = getSecret('NEXT_PUBLIC_SITE_URL')
    || getSecret('NEXT_PUBLIC_BASE_URL')
    || getSecret('NEXT_PUBLIC_APP_URL')
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://yeosonam.co.kr'
}

function readRequiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

function readRequiredNumber(args: Record<string, unknown>, key: string): number {
  const value = Number(args[key])
  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a number`)
  }
  return value
}

function extractPackageIdFromLandingUrl(rawUrl: string): string | null {
  const match = rawUrl.match(/\/packages\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function buildAffiliateTrackingUrl(rawLandingUrl: string, referralCode: string, subId?: unknown): string {
  const origin = resolvePublicSiteOrigin()
  const url = new URL(rawLandingUrl, origin)
  url.searchParams.set('ref', referralCode)
  if (typeof subId === 'string' && subId.trim()) {
    url.searchParams.set('sub', subId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40))
  }
  return url.toString()
}

async function triggerCardNewsRenderFromVariants(result: any): Promise<{
  attempted: number
  success: number
  failed: number
}> {
  const variants = Array.isArray(result?.variants) ? result.variants : []
  const variantIds = variants
    .map((v: any) => v?.card_news_id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)

  if (variantIds.length === 0) return { attempted: 0, success: 0, failed: 0 }

  const origin = resolveAppOriginForInternalFetch()
  const settled = await Promise.allSettled(
    variantIds.map(async (cardNewsId: string) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch(`${origin}/api/card-news/${cardNewsId}/render-html-to-png`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          signal: controller.signal,
        })
        return res.ok
      } finally {
        clearTimeout(timeout)
      }
    }),
  )

  let success = 0
  let failed = 0
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) success += 1
    else failed += 1
  }
  return { attempted: variantIds.length, success, failed }
}

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
  generate_card_news_variants: async (args) => {
    const result = await executeGenerateVariantsJob(args)
    const render = await triggerCardNewsRenderFromVariants(result).catch((e) => ({
      attempted: 0,
      success: 0,
      failed: 0,
      error: e instanceof Error ? e.message : String(e),
    }))
    return {
      ...result,
      auto_render: render,
    }
  },
  // 프롬프트 개선 제안 승인 → prompt_versions 에 새 버전 등록 + 활성화
  // analysis.suggested_prompt_changes 를 기존 style_guide 내용에 appendix 로 붙여서 새 버전 생성.
  // blog-publisher 가 매 발행 시 is_active=true 버전을 읽기 때문에 자동 반영됨.
  prompt_improvement_suggestion: async (args) => {
    const analysis = args?.analysis
    const domain = args?.domain || 'blog_style_guide'
    const actionId = args?.action_id || null

    if (!analysis || !analysis.suggested_prompt_changes) {
      return { acknowledged: true, note: 'analysis 비어있음 — 버전 생성 스킵', patched: false }
    }

    // 현재 활성 버전 조회
    const { data: current } = await supabaseAdmin
      .from('prompt_versions')
      .select('version, content')
      .eq('domain', domain)
      .eq('is_active', true)
      .limit(1)
    const currentVersion = current?.[0]?.version || 'v1.0'
    const currentContent = current?.[0]?.content || ''

    // 다음 버전 번호 — v1.0 → v1.1 / v1.9 → v1.10
    const match = currentVersion.match(/v(\d+)\.(\d+)/)
    const next = match
      ? `v${match[1]}.${parseInt(match[2]) + 1}`
      : `${currentVersion}-next`

    // 개선 사항을 appendix 섹션으로 덧붙임
    const changesAppendix = [
      `\n\n## 자동 학습 개선 사항 (${next} — ${new Date().toISOString().split('T')[0]})`,
      `\n> 아래는 성과 데이터 분석으로 발견된 패턴이다. 반드시 반영해라.`,
      ...(analysis.top_patterns || []).map((p: string) => `- (상위 패턴) ${p}`),
      ...(analysis.suggested_prompt_changes || []).map((c: any) =>
        `- [${c.area}] ${c.change} — 근거: ${c.reason}`),
    ].join('\n')

    const newContent = currentContent + changesAppendix

    // 기존 active 비활성화
    await supabaseAdmin
      .from('prompt_versions')
      .update({ is_active: false })
      .eq('domain', domain)
      .eq('is_active', true)

    // 새 버전 insert (활성)
    const { data: inserted, error } = await supabaseAdmin
      .from('prompt_versions')
      .insert({
        domain,
        version: next,
        content: newContent,
        change_notes: analysis.summary || '자동 학습 개선',
        source: 'auto_learning',
        source_action_id: actionId,
        is_active: true,
        activated_at: new Date().toISOString(),
        performance_baseline: analysis.baseline || null,
      })
      .select('id, version')

    if (error) throw error

    return {
      acknowledged: true,
      patched: true,
      new_version: inserted?.[0]?.version,
      from_version: currentVersion,
      domain,
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
    const { rfq_id, status } = args
    const updateData: any = { status, updated_at: new Date().toISOString() }
    const { error } = await supabaseAdmin
      .from('group_rfqs')
      .update(updateData)
      .eq('id', rfq_id)
    if (error) throw error
    return { updated: true }
  },

  create_affiliate_link: async (args) => {
    const affiliateId = readRequiredString(args, 'affiliate_id')
    const landingUrl = readRequiredString(args, 'landing_url')
    const { data: affiliate, error: affiliateError } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code')
      .eq('id', affiliateId)
      .maybeSingle()
    if (affiliateError) throw affiliateError
    if (!affiliate?.referral_code) throw new Error(`affiliate not found: ${affiliateId}`)

    const referralCode = String(affiliate.referral_code)
    const trackingUrl = buildAffiliateTrackingUrl(landingUrl, referralCode, args.sub_id)
    const packageId = typeof args.package_id === 'string' && args.package_id
      ? args.package_id
      : extractPackageIdFromLandingUrl(landingUrl)

    if (!packageId) {
      return {
        created: false,
        persisted: false,
        affiliate_id: affiliateId,
        referral_code: referralCode,
        tracking_url: trackingUrl,
        note: 'No package_id detected; tracking URL generated without influencer_links row.',
      }
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('influencer_links')
      .select('id, short_url')
      .eq('affiliate_id', affiliateId)
      .eq('package_id', packageId)
      .eq('short_url', trackingUrl)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing?.id) {
      return {
        created: false,
        persisted: true,
        link_id: existing.id,
        affiliate_id: affiliateId,
        referral_code: referralCode,
        tracking_url: existing.short_url,
      }
    }

    const { data: inserted, error } = await supabaseAdmin
      .from('influencer_links')
      .insert({
        affiliate_id: affiliateId,
        referral_code: referralCode,
        package_id: packageId,
        package_title: typeof args.package_title === 'string' ? args.package_title : null,
        short_url: trackingUrl,
      })
      .select('id, short_url')
      .single()
    if (error) throw error
    return {
      created: true,
      persisted: true,
      link_id: inserted?.id,
      affiliate_id: affiliateId,
      referral_code: referralCode,
      tracking_url: inserted?.short_url ?? trackingUrl,
    }
  },

  submit_rfq_proposal: async (args) => {
    const rfqId = readRequiredString(args, 'rfq_id')
    const bidId = readRequiredString(args, 'bid_id')
    const tenantId = readRequiredString(args, 'tenant_id')
    const totalCost = readRequiredNumber(args, 'total_cost')
    const totalSellingPrice = readRequiredNumber(args, 'total_selling_price')
    const checklist = args.checklist && typeof args.checklist === 'object' ? args.checklist : null
    if (!checklist) throw new Error('checklist is required')

    const { data: proposal, error } = await supabaseAdmin
      .from('rfq_proposals')
      .insert({
        rfq_id: rfqId,
        bid_id: bidId,
        tenant_id: tenantId,
        proposal_title: typeof args.proposal_title === 'string' ? args.proposal_title : null,
        itinerary_summary: typeof args.proposal_text === 'string'
          ? args.proposal_text
          : (typeof args.itinerary_summary === 'string' ? args.itinerary_summary : null),
        total_cost: totalCost,
        total_selling_price: totalSellingPrice,
        hidden_cost_estimate: 0,
        checklist,
        checklist_completed: true,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .select('id, status')
      .single()
    if (error) throw error

    await supabaseAdmin
      .from('rfq_bids')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', bidId)

    return { submitted: true, rfq_id: rfqId, bid_id: bidId, proposal_id: proposal?.id }
  },

  ad_optimization: async (args) => {
    const platform = typeof args.platform === 'string' && ['naver', 'google', 'meta', 'kakao'].includes(args.platform)
      ? args.platform
      : null
    const { data: run, error } = await supabaseAdmin
      .from('ad_os_automation_runs')
      .insert({
        tenant_id: typeof args.tenant_id === 'string' ? args.tenant_id : null,
        run_type: 'bid_optimization',
        mode: args.dry_run ? 'dry_run' : 'guarded',
        platform,
        status: 'completed',
        finished_at: new Date().toISOString(),
        summary: {
          source: 'jarvis_agent_action',
          platform: platform ?? 'all',
          requested_at: args.requested_at ?? new Date().toISOString(),
          external_write: false,
        },
      })
      .select('id')
      .single()
    if (error) throw error
    return {
      queued: true,
      run_id: run?.id,
      platform: platform ?? 'all',
      external_write: false,
    }
  },

  export_report: async (args) => {
    const targetType = readRequiredString(args, 'target_type')
    const periodFrom = typeof args.period_from === 'string' ? args.period_from : null
    const periodTo = typeof args.period_to === 'string' ? args.period_to : null
    let query = supabaseAdmin
      .from('settlements')
      .select('id, affiliate_id, booking_id, amount, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (periodFrom) query = query.gte('created_at', periodFrom)
    if (periodTo) query = query.lte('created_at', periodTo)
    if (typeof args.affiliate_id === 'string' && args.affiliate_id) {
      query = query.eq('affiliate_id', args.affiliate_id)
    }

    const { data, error } = await query
    if (error) throw error
    const rows = data ?? []
    const totalAmount = rows.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
    return {
      exported: true,
      target_type: targetType,
      period_from: periodFrom,
      period_to: periodTo,
      row_count: rows.length,
      total_amount: totalAmount,
      preview_rows: rows.slice(0, 25),
    }
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
    }).then(
      () => {},
      (e: unknown) => console.error('[agent-action-executor] AFFILIATE_ANOMALY_ACK audit_logs insert failed:', (e as Error)?.message ?? e),
    )
    return { acknowledged: true, kind, affiliate_id, affiliate_name }
  },

  // ── 일괄 정산 확정 (2026-04-16) ───────────────────────────────────
  // booking_ids 배열의 모든 예약을 settlement_confirmed_at = NOW() 로 마킹
  bulk_confirm_settlements: async (args) => {
    const { booking_ids, reason } = args || {}
    if (!Array.isArray(booking_ids) || booking_ids.length === 0) {
      throw new Error('bulk_confirm_settlements: booking_ids 배열 필수')
    }

    const now = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({
        settlement_confirmed_at: now,
        settlement_confirmed_by: 'jarvis_bulk',
        updated_at: now,
      })
      .in('id', booking_ids)
      .is('settlement_confirmed_at', null)  // 이미 확정된 건은 skip
      .select('id, booking_no')

    if (error) throw new Error(`bulk_confirm_settlements: ${error.message}`)

    // 감사 로그
    await supabaseAdmin.from('audit_logs').insert({
      action: 'BULK_CONFIRM_SETTLEMENTS',
      target_type: 'booking',
      target_id: `bulk:${booking_ids.length}건`,
      description: `자비스 일괄 정산확정: ${data?.length ?? 0}/${booking_ids.length}건 적용. 사유: ${reason ?? '(미기재)'}`,
      after_value: {
        requested: booking_ids.length,
        confirmed: data?.length ?? 0,
        confirmed_booking_nos: (data ?? []).map((b: any) => b.booking_no),
      },
    } as never).then(
      () => {},
      (e: unknown) => console.error('[agent-action-executor] BULK_CONFIRM_SETTLEMENTS audit_logs insert failed:', (e as Error)?.message ?? e),
    )

    return {
      requested: booking_ids.length,
      confirmed: data?.length ?? 0,
      skipped: booking_ids.length - (data?.length ?? 0),
      booking_nos: (data ?? []).map((b: any) => b.booking_no),
    }
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

    const primary = (pair ?? []).find((c: { id: string }) => c.id === primary_id) as Record<string, unknown>
    const duplicate = (pair ?? []).find((c: { id: string }) => c.id === duplicate_id) as Record<string, unknown>
    if (!primary) throw new Error(`merge_customers[step=load]: primary 고객 미존재 (${primary_id})`)
    if (!duplicate) throw new Error(`merge_customers[step=load]: duplicate 고객 미존재 (${duplicate_id})`)
    if (duplicate.deleted_at) throw new Error('merge_customers[step=load]: duplicate 고객은 이미 삭제됨')

    // 2) 필드 병합 (primary 우선, 비어있을 때만 duplicate에서 보충)
    const mergedFields: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (!primary.phone && duplicate.phone) mergedFields.phone = duplicate.phone
    if (!primary.email && duplicate.email) mergedFields.email = duplicate.email
    mergedFields.mileage = ((primary.mileage as number) || 0) + ((duplicate.mileage as number) || 0)
    mergedFields.total_spent = ((primary.total_spent as number) || 0) + ((duplicate.total_spent as number) || 0)
    if (duplicate.memo) {
      mergedFields.memo = [primary.memo as string, `[병합:${duplicate.name as string}] ${duplicate.memo as string}`].filter(Boolean).join('\n')
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

const jarvisToolHandlers: Record<string, (args: any) => Promise<any>> = {
  create_itinerary: (args) => executeOperationsTool('create_itinerary', args),
  update_guest_names: (args) => executeOperationsTool('update_guest_names', args),
  propose_merge_customers: (args) => executeOperationsTool('propose_merge_customers', args),

  activate_policy: (args) => executeProductsTool('activate_policy', args),
  register_product_draft: (args) => executeProductsTool('register_product_draft', args),
  update_package_field: (args) => executeProductsTool('update_package_field', args),
  delete_package: (args) => executeProductsTool('delete_package', args),
  propose_product_registration: (args) => executeProductsTool('propose_product_registration', args),

  propose_bulk_confirm_settlements: (args) => executeFinanceTool('propose_bulk_confirm_settlements', args),
  export_settlement_report: (args) => executeFinanceTool('export_settlement_report', args),

  propose_blog_draft: (args) => executeMarketingTool('propose_blog_draft', args),
  approve_content: (args) => executeMarketingTool('approve_content', args),
  run_ad_optimization: (args) => executeMarketingTool('run_ad_optimization', args),

  generate_affiliate_link: (args) => executeSalesTool('generate_affiliate_link', args),
  update_influencer_tier: (args) => executeSalesTool('update_influencer_tier', args),
  create_rfq_proposal: (args) => executeSalesTool('create_rfq_proposal', args),

  resolve_escalation: (args) => executeSystemTool('resolve_escalation', args),
  trigger_cron_job: (args) => executeSystemTool('trigger_cron_job', args),
  resolve_fraud_case: (args) => executeSystemTool('resolve_fraud_case', args),
  process_gdpr_request: (args) => executeSystemTool('process_gdpr_request', args),
  toggle_integration: (args) => executeSystemTool('toggle_integration', args),
  dismiss_alert: (args) => executeSystemTool('dismiss_alert', args),
  update_system_config: (args) => executeSystemTool('update_system_config', args),
}

// ── 공통 실행 함수 ──────────────────────────────────────────────────
export async function executeAction(
  actionType: string,
  payload: any,
): Promise<ExecutionResult> {
  const handler = handlers[actionType]
    ?? jarvisToolHandlers[actionType]
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
