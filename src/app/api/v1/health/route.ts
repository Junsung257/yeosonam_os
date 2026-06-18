/**
 * 여소남 OS — 외부 REST API V1 헬스 체크 (Phase 3-2)
 *
 * GET /api/v1/health
 *
 * 헤더:
 *   Authorization: Bearer <api_key>  (선택. 없어도 OK)
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "data": {
 *       "status": "healthy",
 *       "version": "1.0.0",
 *       "uptime": 12345,
 *       "timestamp": "2026-05-29T12:00:00Z"
 *     }
 *   }
 */

import { NextRequest } from 'next/server'
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase'
import { apiResponse } from '@/lib/api-response'
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver'

const START_TIME = Date.now()

async function checkDatabase(timeoutMs = 2500): Promise<'connected' | 'timeout' | 'not_configured' | 'resource_saver'> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return 'not_configured'
  if (shouldSkipPublicDbReadsForResourceSaver()) return 'resource_saver'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const { error } = await supabaseAdmin
      .from('active_destinations')
      .select('destination')
      .limit(1)
      .abortSignal(controller.signal)

    return error ? 'timeout' : 'connected'
  } catch {
    return 'timeout'
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(_request: NextRequest) {
  const db = await checkDatabase()
  const dbOk = db === 'connected'

  const status = dbOk ? 'healthy' : 'degraded'

  return apiResponse({
    ok: true,
    data: {
      status,
      version: '1.0.0',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      db,
      timestamp: new Date().toISOString(),
    },
  })
}
