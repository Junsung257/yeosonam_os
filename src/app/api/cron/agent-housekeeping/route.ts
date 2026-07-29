import { NextRequest } from 'next/server'
import { apiResponse } from '@/lib/api-response'
import { runAgentHousekeeping } from '@/lib/agent/housekeeping'
import { requireCronBearer } from '@/lib/cron-auth'
import { isSupabaseAdminConfigured } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authError = requireCronBearer(request)
  if (authError) return authError

  if (!isSupabaseAdminConfigured) {
    return apiResponse(
      {
        ok: false,
        error: {
          code: 'SUPABASE_ADMIN_UNAVAILABLE',
          message: 'Agent housekeeping is unavailable',
        },
      },
      { status: 503 },
    )
  }

  const startedAt = Date.now()

  try {
    const housekeeping = await runAgentHousekeeping()
    const elapsedMs = Date.now() - startedAt

    console.log('[agent-housekeeping] completed', {
      elapsed_ms: elapsedMs,
      scanned: housekeeping.scanned,
      expired: housekeeping.expired,
    })

    return apiResponse({
      ok: true,
      elapsed_ms: elapsedMs,
      scanned: housekeeping.scanned,
      expired: housekeeping.expired,
    })
  } catch (error) {
    console.error('[agent-housekeeping] failed', error)

    return apiResponse(
      {
        ok: false,
        error: {
          code: 'AGENT_HOUSEKEEPING_FAILED',
          message: 'Agent housekeeping failed',
        },
      },
      { status: 500 },
    )
  }
}
