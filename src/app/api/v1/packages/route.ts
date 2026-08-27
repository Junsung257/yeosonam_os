/**
 * 여소남 OS — 외부 REST API V1 패키지 검색 엔드포인트 (Phase 3-2)
 *
 * GET /api/v1/packages?destination=제주&date_from=2026-06-01&limit=10
 * POST /api/v1/packages
 */

import { NextRequest } from 'next/server'
import { withApiKey } from '@/lib/api-key-middleware'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { apiResponse, ApiErrors } from '@/lib/api-response'
import {
  V1PackageListResponseSchema,
  V1PackageRecommendationBodySchema,
  V1PackageSearchQuerySchema,
} from '@/lib/api-contracts/v1'
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver'
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog'
import { observeApiRequest } from '@/lib/structured-logger.server'

export const maxDuration = 30

function hasDepartureInRange(
  row: PublicCatalogItem,
  dateFrom?: string | null,
  dateTo?: string | null,
): boolean {
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
  return observeApiRequest(request, async ({ logger }) => {
    const auth = await withApiKey(request, { requiredScopes: ['packages:read', 'qa:*'] })
    if (!auth.valid) return auth.response
    if (!isSupabaseConfigured) return ApiErrors.internalError('DB 미설정')

    const parsedQuery = V1PackageSearchQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return ApiErrors.badRequest('검색 조건이 올바르지 않습니다', parsedQuery.error.flatten())
    }

    const {
      destination,
      date_from: dateFrom,
      date_to: dateTo,
      limit,
      offset,
      keyword,
    } = parsedQuery.data

    if (shouldSkipPublicDbReadsForResourceSaver()) {
      return apiResponse(V1PackageListResponseSchema.parse({
        ok: true,
        data: [],
        pagination: { total: 0, limit, offset },
        degraded: true,
        reason: 'db_resource_saver_mode',
      }))
    }

    try {
      const published = await listPublicCatalog(supabaseAdmin, { limit: 5_000 })
      const matchingData = published
        .filter(row => !destination || String(row.destination ?? '').toLowerCase().includes(destination.toLowerCase()))
        .filter(row => !keyword || `${row.title} ${row.destination ?? ''}`.toLowerCase().includes(keyword.toLowerCase()))
        .filter(row => hasDepartureInRange(row, dateFrom, dateTo))
        .sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER))
      const visibleData = matchingData
        .slice(offset, offset + limit)
        .map(toPublicV1Package)

      return apiResponse(V1PackageListResponseSchema.parse({
        ok: true,
        data: visibleData,
        pagination: { total: matchingData.length, limit, offset },
      }))
    } catch (err) {
      logger.warn({
        event: 'api.v1.packages.search_failed',
        err,
        tenant_id: auth.tenantId,
        api_key_id: auth.apiKeyId,
      })
      return ApiErrors.internalError('패키지 검색 중 오류가 발생했습니다')
    }
  }, { api_version: 'v1' })
}

/** POST: 패키지 추천 */
export async function POST(request: NextRequest) {
  return observeApiRequest(request, async ({ logger }) => {
    const auth = await withApiKey(request, { requiredScopes: ['packages:read', 'qa:*'] })
    if (!auth.valid) return auth.response
    if (!isSupabaseConfigured) return ApiErrors.internalError('DB 미설정')

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return ApiErrors.badRequest('JSON 형식이 올바르지 않습니다')
    }

    const parsedBody = V1PackageRecommendationBodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return ApiErrors.badRequest('추천 조건이 올바르지 않습니다', parsedBody.error.flatten())
    }
    const body = parsedBody.data

    if (shouldSkipPublicDbReadsForResourceSaver()) {
      return apiResponse(V1PackageListResponseSchema.parse({
        ok: true,
        data: [],
        pagination: { total: 0, limit: 10, offset: 0 },
        degraded: true,
        reason: 'db_resource_saver_mode',
      }))
    }

    try {
      const published = await listPublicCatalog(supabaseAdmin, { limit: 5_000 })
      const matchingData = published
        .filter(row => !body.destination || String(row.destination ?? '').toLowerCase().includes(body.destination.toLowerCase()))
        .filter(row => hasDepartureInRange(row, body.date_from, null))
        .sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER))
      const visibleData = matchingData.slice(0, 10).map(toPublicV1Package)

      return apiResponse(V1PackageListResponseSchema.parse({
        ok: true,
        data: visibleData,
        pagination: { total: matchingData.length, limit: 10, offset: 0 },
      }))
    } catch (err) {
      logger.warn({
        event: 'api.v1.packages.recommendation_failed',
        err,
        tenant_id: auth.tenantId,
        api_key_id: auth.apiKeyId,
      })
      return ApiErrors.internalError('패키지 추천 중 오류가 발생했습니다')
    }
  }, { api_version: 'v1' })
}
