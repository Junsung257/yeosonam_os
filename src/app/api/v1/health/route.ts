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
import { isSupabaseConfigured } from '@/lib/supabase'

const START_TIME = Date.now()

export async function GET(_request: NextRequest) {
  const dbOk = isSupabaseConfigured

  const status = dbOk ? 'healthy' : 'degraded'

  return Response.json({
    ok: true,
    data: {
      status,
      version: '1.0.0',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      db: dbOk ? 'connected' : 'not_configured',
      timestamp: new Date().toISOString(),
    },
  })
}
