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
import { listCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection'
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload'

export const maxDuration = 30

type PublicPackageRow = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasDepartureInRange(row: PublicPackageRow, dateFrom?: string | null, dateTo?: string | null): boolean {
  if (!dateFrom && !dateTo) return true
  const dates = Array.isArray(row.price_dates) ? row.price_dates : []
  return dates.some((item) => {
    const record = asRecord(item)
    const date = typeof record?.date === 'string' ? record.date : ''
    return Boolean(date) && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo)
  })
}

function toPublicV1Package(row: PublicPackageRow): Record<string, unknown> {
  const cardProjection = asRecord(row._card_projection)
  const lpProjection = asRecord(row._lp_projection)
  const publicPackage = sanitizeCustomerPackageForClient({
    id: row.id,
    title: row.title,
    display_title: row.display_title,
    destination: row.destination,
    duration: row.duration ?? row.days,
    days: row.duration ?? row.days,
    nights: row.nights,
    price: row.price,
    price_display: row.price_display,
    summary: lpProjection?.summary ?? cardProjection?.summary ?? null,
    badges: cardProjection?.badges ?? row.badges ?? [],
    publication_state: row.publication_state,
    package_revision: row.package_revision,
  })
  return publicPackage ?? {}
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
    const published = await listCurrentPublicPackageCardSnapshots(supabaseAdmin, {
      channel: 'b2b',
      locale: 'ko-KR',
      limit: 5_000,
    })
    const visibleData = published
      .filter(row => !destination || String(row.destination ?? '').toLowerCase().includes(destination.toLowerCase()))
      .filter(row => !keyword || `${String(row.title ?? '')} ${String(row.summary ?? row.product_summary ?? '')}`.toLowerCase().includes(keyword.toLowerCase()))
      .filter(row => hasDepartureInRange(row, dateFrom, dateTo))
      .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
      .slice(offset, offset + limit)
      .map(toPublicV1Package)

    return apiResponse({
      ok: true,
      data: visibleData,
      pagination: { total: visibleData.length, limit, offset },
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
    const published = await listCurrentPublicPackageCardSnapshots(supabaseAdmin, {
      channel: 'b2b',
      locale: 'ko-KR',
      limit: 5_000,
    })

    // pax 수용 가능 패키지 필터 (기본 2인)
    const pax = body.pax ?? 2
    const visibleData = published
      .filter(row => !body.destination || String(row.destination ?? '').toLowerCase().includes(body.destination.toLowerCase()))
      .filter(row => hasDepartureInRange(row, body.date_from, null))
      .filter(row => Number(row.max_pax ?? pax) >= pax)
      .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 10)
      .map(toPublicV1Package)

    return apiResponse({
      ok: true,
      data: visibleData,
      pagination: { total: visibleData.length, limit: 10, offset: 0 },
    })
  } catch (err) {
    console.warn('[api/v1/packages] 추천 실패:', err)
    return ApiErrors.internalError('패키지 추천 중 오류가 발생했습니다')
  }
}
