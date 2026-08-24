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
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver'
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog'

export const maxDuration = 30

function hasDepartureInRange(row: PublicCatalogItem, dateFrom?: string | null, dateTo?: string | null): boolean {
  if (!dateFrom && !dateTo) return true
  return row.availableDates.some(({ date }) => (
    (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo)
  ))
}

function toPublicV1Package(row: PublicCatalogItem): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    departure_airport: row.departureAirport,
    duration: row.duration,
    nights: row.nights,
    price: row.price,
    price_display: row.priceDisplay,
    price_dates: row.availableDates,
    badges: row.badges,
    booking_mode: row.bookingMode,
    last_verified_at: row.lastVerifiedAt,
  }
}

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

  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return apiResponse({
      ok: true,
      data: [],
      pagination: { total: 0, limit, offset },
      degraded: true,
      reason: 'db_resource_saver_mode',
    })
  }

  try {
    const published = await listPublicCatalog(supabaseAdmin, { limit: 5_000 })
    const matched = published
      .filter(row => !destination || String(row.destination ?? '').toLowerCase().includes(destination.toLowerCase()))
      .filter(row => !keyword || `${row.title} ${row.destination ?? ''}`.toLowerCase().includes(keyword.toLowerCase()))
      .filter(row => hasDepartureInRange(row, dateFrom, dateTo))
      .sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER))
    const visibleData = matched
      .slice(offset, offset + limit)
      .map(toPublicV1Package)

    return apiResponse({
      ok: true,
      data: visibleData,
      pagination: { total: matched.length, limit, offset },
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

  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return apiResponse({
      ok: true,
      data: [],
      pagination: { total: 0, limit: 0, offset: 0 },
      degraded: true,
      reason: 'db_resource_saver_mode',
    })
  }

  let body: { destination?: string; date_from?: string; pax?: number }
  try {
    body = await request.json()
  } catch {
    return ApiErrors.badRequest('JSON 형식이 올바르지 않습니다')
  }

  try {
    const published = await listPublicCatalog(supabaseAdmin, { limit: 5_000 })

    // pax 수용 가능 패키지 필터 (기본 2인)
    const pax = body.pax ?? 2
    const visibleData = published
      .filter(row => !body.destination || String(row.destination ?? '').toLowerCase().includes(body.destination.toLowerCase()))
      .filter(row => hasDepartureInRange(row, body.date_from, null))
      .sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 10)
      .map(toPublicV1Package)

    return apiResponse({
      ok: true,
      data: visibleData,
      pagination: { total: visibleData.length, limit: 10, offset: 0 },
      requested_pax: pax,
    })
  } catch (err) {
    console.warn('[api/v1/packages] 추천 실패:', err)
    return ApiErrors.internalError('패키지 추천 중 오류가 발생했습니다')
  }
}
