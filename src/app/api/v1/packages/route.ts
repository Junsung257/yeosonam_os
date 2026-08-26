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
import {
  V1PackageListResponseSchema,
  V1PackageRecommendationBodySchema,
  V1PackageSearchQuerySchema,
} from '@/lib/api-contracts/v1'
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver'
import { listCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection'
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload'
import { observeApiRequest } from '@/lib/structured-logger.server'

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
  const safe = publicPackage ?? {}
  const numericPrice = typeof safe.price === 'number'
    ? safe.price
    : Number(safe.price)

  return {
    id: String(safe.id ?? ''),
    title: typeof safe.title === 'string' ? safe.title : null,
    display_title: typeof safe.display_title === 'string' ? safe.display_title : null,
    destination: typeof safe.destination === 'string' ? safe.destination : null,
    duration: typeof safe.duration === 'string' || typeof safe.duration === 'number' ? safe.duration : null,
    days: typeof safe.days === 'string' || typeof safe.days === 'number' ? safe.days : null,
    nights: typeof safe.nights === 'string' || typeof safe.nights === 'number' ? safe.nights : null,
    price: Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : null,
    price_display: typeof safe.price_display === 'string' ? safe.price_display : null,
    summary: typeof safe.summary === 'string' ? safe.summary : null,
    badges: Array.isArray(safe.badges) ? safe.badges : [],
    publication_state: typeof safe.publication_state === 'string' ? safe.publication_state : null,
    package_revision: typeof safe.package_revision === 'string' || typeof safe.package_revision === 'number'
      ? safe.package_revision
      : null,
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
      const published = await listCurrentPublicPackageCardSnapshots(supabaseAdmin, {
        channel: 'b2b',
        locale: 'ko-KR',
        limit: 5_000,
      })
      const matchingData = published
        .filter(row => !destination || String(row.destination ?? '').toLowerCase().includes(destination.toLowerCase()))
        .filter(row => !keyword || `${String(row.title ?? '')} ${String(row.summary ?? row.product_summary ?? '')}`.toLowerCase().includes(keyword.toLowerCase()))
        .filter(row => hasDepartureInRange(row, dateFrom, dateTo))
        .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
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
      const published = await listCurrentPublicPackageCardSnapshots(supabaseAdmin, {
        channel: 'b2b',
        locale: 'ko-KR',
        limit: 5_000,
      })

      const matchingData = published
        .filter(row => !body.destination || String(row.destination ?? '').toLowerCase().includes(body.destination.toLowerCase()))
        .filter(row => hasDepartureInRange(row, body.date_from, null))
        .filter(row => Number(row.max_pax ?? body.pax) >= body.pax)
        .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
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
