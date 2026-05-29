import { supabaseAdmin } from '@/lib/supabase'
import { SYSTEM_PROMPT_AGENT } from '../prompts'
import type { AgentRunParams } from '../types'
import { runDeepSeekAgentLoop } from '../deepseek-agent-loop'
import { getScopedClient, type JarvisContext } from '@/lib/jarvis'

// ============================================================
// System Agent — 38개 Tool (Phase 2: 어드민 전 영역 명령 지원)
// ============================================================

const SYSTEM_TOOLS_RAW = [
  // ── 정책 ──
  {
    name: 'list_policies',
    description: '비즈니스 정책 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: '카테고리 (booking/payment/commission/marketing)' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'update_policy',
    description: '비즈니스 정책을 수정합니다. (승인 필요, 위험도 높음)',
    input_schema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string' },
        value: { type: 'string', description: '새로운 정책 값' },
        reason: { type: 'string', description: '변경 사유' },
      },
    },
  },
  // ── 에스컬레이션 ──
  {
    name: 'list_escalations',
    description: '에스컬레이션 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'open/resolved/dismissed' },
        priority: { type: 'string', description: 'low/medium/high/critical' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'resolve_escalation',
    description: '에스컬레이션을 해결/종료 처리합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string', description: '에스컬레이션 ID' },
        resolution: { type: 'string', description: '해결 방법/메모' },
      },
    },
  },
  // ── 감사 로그 ──
  {
    name: 'get_audit_logs',
    description: '감사 로그를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_type: { type: 'string', description: '대상 타입 (jarvis/booking/customer/policy 등)' },
        action: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  // ── OS 헬스/관제 (신규) ──
  {
    name: 'get_os_health',
    description: 'OS 관제탑 — 시스템 헬스 상태 조회 (크론 작업 현황, 에러율, 속도)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_cron_jobs',
    description: '크론 작업 목록과 상태 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'active/paused/failed' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'trigger_cron_job',
    description: '크론 작업을 수동으로 트리거합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['job_name'],
      properties: {
        job_name: { type: 'string', description: '크론 작업 이름 (예: scoring-recompute, blog-auto-publish)' },
      },
    },
  },
  // ── 등록 모니터 (신규) ──
  {
    name: 'get_registration_status',
    description: '상품 등록 파이프라인 상태 조회 (진행 중/대기/실패)',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'pending/processing/completed/failed' },
        limit: { type: 'number' },
      },
    },
  },
  // ── 사기 격리 (신규) ──
  {
    name: 'list_fraud_quarantine',
    description: '자동 격리된 예약/고객 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'quarantined/reviewed/resolved' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'resolve_fraud_case',
    description: '격리 건을 해제 또는 확정 처리합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['id', 'action'],
      properties: {
        id: { type: 'string', description: '격리 건 ID' },
        action: { type: 'string', description: 'release(해제) / confirm(사기 확정)' },
        memo: { type: 'string' },
      },
    },
  },
  // ── 개인정보 (신규) ──
  {
    name: 'list_gdpr_requests',
    description: '개인정보 삭제 요청 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'pending/processing/completed' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'process_gdpr_request',
    description: '개인정보 삭제 요청을 처리합니다. (HITL 필요, 위험도 높음)',
    input_schema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'GDPR 요청 ID' },
      },
    },
  },
  // ── 외부 연동 설정 (신규) ──
  {
    name: 'list_integrations',
    description: '외부 플랫폼 연동 상태 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'meta/naver/google/kakao 등' },
      },
    },
  },
  {
    name: 'toggle_integration',
    description: '외부 플랫폼 연동을 활성화/비활성화합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['id', 'is_active'],
      properties: {
        id: { type: 'string', description: '연동 설정 ID' },
        is_active: { type: 'boolean' },
      },
    },
  },
  // ── API 토큰 (신규) ──
  {
    name: 'list_api_tokens',
    description: '테넌트 API 토큰 목록 조회 (provider별)',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'meta/naver/google/mcp 등' },
      },
    },
  },
  // ── 알림 (신규) ──
  {
    name: 'list_admin_alerts_full',
    description: '운영 알림 전체 목록 조회 (카테고리/심각도 필터링)',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'policy_winner/general/register-backfill 등' },
        severity: { type: 'string', description: 'info/warning/critical' },
        is_read: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'dismiss_alert',
    description: '운영 알림을 읽음 처리합니다.',
    input_schema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    },
  },
  // ── 시스템 설정 (신규) ──
  {
    name: 'list_system_config',
    description: '시스템 설정/환경변수 목록 조회 (키-값)',
    input_schema: {
      type: 'object' as const,
      properties: {
        group: { type: 'string', description: '설정 그룹 (general/ai/notification 등)' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'update_system_config',
    description: '시스템 설정을 변경합니다. (HITL 필요, 위험도 높음)',
    input_schema: {
      type: 'object' as const,
      required: ['key', 'value'],
      properties: {
        key: { type: 'string', description: '설정 키' },
        value: { type: 'string', description: '새 값' },
        reason: { type: 'string', description: '변경 사유' },
      },
    },
  },
  // ── 프롬프트 레지스트리 (신규) ──
  {
    name: 'list_prompt_templates',
    description: '프롬프트 템플릿 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'jarvis/router/qa 등' },
        limit: { type: 'number' },
      },
    },
  },
  // ── 블로그 시스템 (신규) ──
  {
    name: 'get_blog_system_status',
    description: '블로그 시스템 상태 조회 (발행 큐, 예약 발행, API 상태)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

const SYSTEM_TOOLS = SYSTEM_TOOLS_RAW as unknown[]

// ============================================================
// 실행 구현
// ============================================================

async function executeTool(toolName: string, args: any, ctx?: JarvisContext): Promise<any> {
  const sb = ctx ? getScopedClient(ctx) : supabaseAdmin

  switch (toolName) {
    // ── 정책 ──
    case 'list_policies': {
      let query = sb.from('os_policies').select('*').order('category', { ascending: true }).limit(args.limit || 20)
      if (args.category) query = query.eq('category', args.category)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'update_policy': {
      const { data: before } = await sb.from('os_policies').select('*').eq('id', args.id).single()
      const { data, error } = await sb.from('os_policies').update({ value: args.value }).eq('id', args.id).select().single()
      if (error) throw error
      await sb.from('audit_logs').insert({
        action: 'policy_updated',
        target_type: 'policy',
        target_id: args.id,
        metadata: { before: before?.value, after: args.value, reason: args.reason },
      }).maybeSingle()
      return data
    }

    // ── 에스컬레이션 ──
    case 'list_escalations': {
      let query = sb.from('escalations').select('*').order('created_at', { ascending: false }).limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.priority) query = query.eq('priority', args.priority)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'resolve_escalation': {
      const { data, error } = await sb.from('escalations').update({
        status: 'resolved',
        resolution: args.resolution,
        resolved_at: new Date().toISOString(),
      }).eq('id', args.id).eq('status', 'open').select().single()
      if (error) throw error
      return data
    }

    // ── 감사 로그 ──
    case 'get_audit_logs': {
      let query = sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.target_type) query = query.eq('target_type', args.target_type)
      if (args.action) query = query.eq('action', args.action)
      if (args.date_from) query = query.gte('created_at', args.date_from)
      if (args.date_to) query = query.lte('created_at', args.date_to)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── OS 헬스 ──
    case 'get_os_health': {
      const [cronResult, alertResult] = await Promise.all([
        sb.from('cron_jobs').select('job_name, status, last_run_at, last_error').limit(50),
        sb.from('admin_alerts').select('severity', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()).limit(10),
      ])
      const activeCrons = (cronResult.data ?? []).filter((c: any) => c.status === 'active').length
      return {
        cron_jobs: { total: cronResult.data?.length ?? 0, active: activeCrons, errors: cronResult.error },
        recent_alerts: alertResult.data ?? [],
        status: activeCrons > 0 ? 'healthy' : 'degraded',
      }
    }
    case 'list_cron_jobs': {
      let query = sb.from('cron_jobs').select('*').order('job_name').limit(args.limit || 50)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'trigger_cron_job': {
      const { data, error } = await sb.from('cron_job_triggers').insert({
        job_name: args.job_name,
        triggered_by: ctx?.userId ?? 'jarvis',
        status: 'pending',
      }).select().single()
      if (error) throw error
      return data
    }

    // ── 등록 모니터 ──
    case 'get_registration_status': {
      let query = sb.from('registration_queue').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 사기 격리 ──
    case 'list_fraud_quarantine': {
      let query = sb.from('fraud_quarantine').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'resolve_fraud_case': {
      const { data, error } = await sb.from('fraud_quarantine').update({
        status: args.action === 'release' ? 'resolved' : 'confirmed',
        resolution_memo: args.memo,
        resolved_at: new Date().toISOString(),
      }).eq('id', args.id).select().single()
      if (error) throw error
      return data
    }

    // ── GDPR ──
    case 'list_gdpr_requests': {
      let query = sb.from('gdpr_requests').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'process_gdpr_request': {
      const { data, error } = await sb.from('gdpr_requests').update({
        status: 'processing',
        processed_at: new Date().toISOString(),
      }).eq('id', args.id).select().single()
      if (error) throw error
      return data
    }

    // ── 외부 연동 ──
    case 'list_integrations': {
      let query = sb.from('platform_integrations').select('*').order('provider').limit(50)
      if (args.provider) query = query.eq('provider', args.provider)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'toggle_integration': {
      const { data, error } = await sb.from('platform_integrations').update({
        is_active: args.is_active,
      }).eq('id', args.id).select().single()
      if (error) throw error
      return data
    }

    // ── API 토큰 ──
    case 'list_api_tokens': {
      let query = sb.from('tenant_tokens').select('id, provider, label, is_active, last_used_at, created_at').order('created_at', { ascending: false }).limit(50)
      if (args.provider) query = query.eq('provider', args.provider)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 알림 ──
    case 'list_admin_alerts_full': {
      let query = sb.from('admin_alerts').select('*').order('created_at', { ascending: false }).limit(args.limit || 30)
      if (args.category) query = query.eq('category', args.category)
      if (args.severity) query = query.eq('severity', args.severity)
      if (args.is_read !== undefined) query = query.eq('is_read', args.is_read)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'dismiss_alert': {
      const { data, error } = await sb.from('admin_alerts').update({ is_read: true }).eq('id', args.id).select().single()
      if (error) throw error
      return data
    }

    // ── 시스템 설정 ──
    case 'list_system_config': {
      let query = sb.from('system_config').select('*').order('key').limit(args.limit || 50)
      if (args.group) query = query.eq('group', args.group)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'update_system_config': {
      const { data, error } = await sb.from('system_config').upsert({
        key: args.key,
        value: args.value,
        updated_by: ctx?.userId ?? 'jarvis',
      }).select().single()
      if (error) throw error
      await sb.from('audit_logs').insert({
        action: 'config_updated',
        target_type: 'system_config',
        target_id: args.key,
        metadata: { value: args.value, reason: args.reason },
      }).maybeSingle()
      return data
    }

    // ── 프롬프트 ──
    case 'list_prompt_templates': {
      let query = sb.from('prompt_templates').select('key, label, category, updated_at, is_active').order('key').limit(args.limit || 50)
      if (args.category) query = query.eq('category', args.category)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 블로그 시스템 ──
    case 'get_blog_system_status': {
      const [queueResult, apiResult] = await Promise.all([
        sb.from('blog_queue').select('status', { count: 'exact', head: true }).limit(10),
        sb.from('platform_integrations').select('provider, is_active').eq('is_active', true).in('provider', ['naver', 'meta']).limit(10),
      ])
      return {
        queue: { pending: queueResult.count ?? 0 },
        apis_connected: apiResult.data ?? [],
        status: 'operational',
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

export { SYSTEM_TOOLS, SYSTEM_TOOLS_RAW }
export { executeTool as executeSystemTool }

export async function runSystemAgent(params: AgentRunParams): Promise<any> {
  return runDeepSeekAgentLoop({
    agentType: 'system',
    systemPrompt: SYSTEM_PROMPT_AGENT,
    tools: SYSTEM_TOOLS,
    executeTool: (name, args) => executeTool(name, args),
  }, params)
}
