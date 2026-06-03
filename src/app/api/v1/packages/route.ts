/**
 * 여소남 OS — 외부 REST API V1 패키지 검색 엔드포인트 (Phase 3-2)
 *
 * GET /api/v1/packages?destination=제주&date_from=2026-06-01&limit=10
 *
 * 헤더:
 *   Authorization: Bearer <api_key>  (필수. 스코프: packages:read)
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "data": [...],
 *     "pagination": { "total": 42, "limit": 10, "offset": 0 }
 *   }
 *
 * POST /api/v1/packages
 *   { "destination": "제주", "date_from": "2026-06-01", "pax": 2 }
 *   → 추천 패키지 반환
 */

import { NextRequest } from 'next/server'
import { withApiKey } from '@/lib/api-key-middleware'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { apiResponse, ApiErrors } from '@/lib/api-response'

export const maxDuration = 30

/** GET: 패키지 검색 */
export async function GET(request: NextRequest) {
  const auth = await withApiKey(request, { requiredScopes: ['packages:read', 'qa:*'] })
  if (!auth.valid) return auth.response
  if (!isSupabaseConfigured) return ApiErrors.internalError('DB 미설정')

  const { searchParams } = request.nextUrl
  const destination = searchParams.get('destination')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 100)
  const offset = Number(searchParams.get('offset') ?? 0)
  const keyword = searchParams.get('keyword')

  try {
    let query = supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, price, days, summary, images, is_active', { count: 'exact' })
      .eq('is_active', true)

    if (destination) query = query.ilike('destination', `%${destination}%`)
    if (keyword) query = query.or(`title.ilike.%${keyword}%,summary.ilike.%${keyword}%`)
    if (dateFrom) query = query.gte('start_date', dateFrom)
    if (dateTo) query = query.lte('end_date', dateTo)

    const { data, error, count } = await query
      .order('price', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return apiResponse({
      ok: true,
      data: data ?? [],
      pagination: { total: count ?? 0, limit, offset },
    })
  } catch (err) {
    console.warn('[api/v1/packages] 검색 실패:', err)
    return ApiErrors.internalError('패키지 검색 중 오류가 발생했습니다')
  }
}

/** POST: 패키지 추천 */
export async function POST(request: NextRequest) {
  const auth = await withApiKey(request, { requiredScopes: ['packages:read', 'qa:*'] })
  if (!auth.valid) return auth.response
  if (!isSupabaseConfigured) return ApiErrors.internalError('DB 미설정')

  let body: { destination?: string; date_from?: string; pax?: number }
  try {
    body = await request.json()
  } catch {
    return ApiErrors.badRequest('JSON 형식이 올바르지 않습니다')
  }

  try {
    let query = supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, price, days, summary, images, is_active, highlights, included', { count: 'exact' })
      .eq('is_active', true)

    if (body.destination) query = query.ilike('destination', `%${body.destination}%`)
    if (body.date_from) query = query.gte('start_date', body.date_from)

    // pax 수용 가능 패키지 필터 (기본 2인)
    const pax = body.pax ?? 2
    query = query.gte('max_pax', pax)

    const { data, error, count } = await query
      .order('price', { ascending: true })
      .limit(10)

    if (error) throw error

    return apiResponse({
      ok: true,
      data: data ?? [],
      pagination: { total: count ?? 0, limit: 10, offset: 0 },
    })
  } catch (err) {
    console.warn('[api/v1/packages] 추천 실패:', err)
    return ApiErrors.internalError('패키지 추천 중 오류가 발생했습니다')
  }
}
