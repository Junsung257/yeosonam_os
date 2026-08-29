import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  isSupabaseConfigured,
  supabaseAdmin,
} from '@/lib/supabase';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { logError, logWarning } from '@/lib/sentry-logger';
import {
  runSanitizePipeline,
  buildFullTextForValidation,
} from '@/lib/text-sanitizer';
import { tiersToDatePrices } from '@/lib/price-dates';
import { embedText } from '@/lib/embeddings';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import {
  revalidateLandingPagesForPackage,
  revalidateLandingPagesForPackageIds,
} from '@/lib/revalidate-lp-package';
import { invalidateQaChatPackageCache } from '@/lib/qa-chat-packages';
import { getAttractionPreviewNamesFromItinerary } from '@/lib/itinerary-attraction-summary';
import { getSecret } from '@/lib/secret-registry';
import { escapePostgrestIlikeValue } from '@/lib/supabase-filter-safe';
import { successResponse, listResponse, ApiErrors } from '@/lib/api-response';
import { isAdminRequest, requireAdminRequest } from '@/lib/admin-guard';
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { CUSTOMER_VISIBLE_STATUSES, isCustomerVisibleStatus } from '@/lib/visibility-status';
import { hasUpcomingPublicDepartureDate, isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { fetchLatestPublicPackageSnapshot, getCurrentPublicPackage } from '@/lib/package-publication/repository';
import {
  fetchAndMergeCurrentPublicPackageCardSnapshots,
  listCurrentPublicPackageCardSnapshots,
} from '@/lib/package-publication/snapshot-projection';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';
import {
  evaluateV3CustomerNoticeGate,
  hasSupplierRemarkRawLeakRisk,
  hasUnsafeCustomerNoticeMutation,
  loadLatestV3DraftForPackage,
} from '@/lib/product-registration-v3/customer-payload';

import { evaluateVerifyChecks } from '@/lib/upload-verify';
import { buildSourceBackedPriceDateRepair } from '@/lib/source-price-date-repair';
import { evaluateCustomerMobileProof, extractCustomerMobileProof } from '@/lib/customer-mobile-proof';
import {
  customerOpenContractAuditPayload,
  loadCustomerOpenContractForPackage,
} from '@/lib/product-registration/customer-open-contract';
import { summarizeEvidencePackForApi } from '@/lib/product-registration/registration-evidence-pack';
import {
  productRegistrationLegacyWriterBlocker,
} from '@/lib/product-registration-v6/runtime-config';

const ADMIN_PACKAGE_CACHE_CONTROL = 'private, no-store';
const PUBLIC_PACKAGE_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=150';

function applyPackageCache(response: NextResponse, isAdmin: boolean): NextResponse {
  if (isAdmin) {
    response.headers.set('Cache-Control', ADMIN_PACKAGE_CACHE_CONTROL);
  } else if (response.ok && !response.headers.has('Cache-Control')) {
    response.headers.set('Cache-Control', PUBLIC_PACKAGE_CACHE_CONTROL);
  }
  return response;
}

function collectAttractionIds(itineraryData: unknown): string[] {
  const ids = new Set<string>();
  const root = itineraryData as { days?: { schedule?: { attraction_ids?: (string | null)[] }[] }[] } | null;
  for (const day of root?.days ?? []) {
    for (const item of day.schedule ?? []) {
      for (const id of item.attraction_ids ?? []) {
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }
  }
  return [...ids];
}

function stripSupplierRemarkFields<T extends Record<string, unknown>>(row: T): Omit<T, 'special_notes'> {
  const { special_notes: _supplierRemark, ...safe } = row;
  return safe;
}

function stripPublicPackageFields(row: Record<string, unknown>): Record<string, unknown> {
  return sanitizeCustomerPackageForClient(stripSupplierRemarkFields(row)) ?? {};
}

function isCustomerPublicSnapshotCandidate(row: Record<string, unknown>): boolean {
  return isPublicPublicationState(typeof row.publication_state === 'string' ? row.publication_state : null)
    && isCustomerPubliclyOpenable(row);
}

function includesCustomerNoticeFields(input: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'notices_parsed')
    || Object.prototype.hasOwnProperty.call(input, 'customer_notes');
}

const CUSTOMER_PUBLIC_REAUDIT_FIELDS = new Set([
  'title',
  'display_title',
  'hero_tagline',
  'destination',
  'country',
  'duration',
  'nights',
  'price',
  'price_tiers',
  'price_dates',
  'price_list',
  'surcharges',
  'excluded_dates',
  'category',
  'product_type',
  'trip_style',
  'departure_days',
  'departure_airport',
  'airline',
  'min_participants',
  'ticketing_deadline',
  'guide_tip',
  'single_supplement',
  'small_group_surcharge',
  'optional_tours',
  'cancellation_policy',
  'category_attrs',
  'inclusions',
  'excludes',
  'customer_notes',
  'notices_parsed',
  'itinerary',
  'itinerary_data',
  'product_tags',
  'product_highlights',
  'product_summary',
  'marketing_copies',
  'raw_text',
  'accommodations',
  'status',
]);

function customerPublicReauditKeys(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter(key => CUSTOMER_PUBLIC_REAUDIT_FIELDS.has(key));
}

async function assertPackageV3NoticePatchAllowed(packageId: string, input: Record<string, unknown>) {
  if (!includesCustomerNoticeFields(input)) return null;
  const latestDraft = await loadLatestV3DraftForPackage(supabaseAdmin, packageId);
  if (!latestDraft) {
    if (hasSupplierRemarkRawLeakRisk(input)) {
      return ApiErrors.conflict('랜드사 REMARK 원문성 안내문은 고객 필드에 직접 저장할 수 없습니다.', {
        code: 'SUPPLIER_REMARK_RAW_LEAK_RISK',
      });
    }
    return null;
  }
  if (hasUnsafeCustomerNoticeMutation(input)) {
    return ApiErrors.conflict('V3 상품의 고객 안내문은 여소남 표준 notice payload만 저장할 수 있습니다.', {
      code: 'UNSAFE_CUSTOMER_NOTICE_MUTATION',
    });
  }
  const gate = evaluateV3CustomerNoticeGate(packageId, latestDraft);
  if (gate.blocksApproval) {
    return ApiErrors.conflict('최신 V3 draft가 검수 대기/차단 상태라 고객 안내문 직접 저장을 막았습니다.', {
      code: 'V3_DRAFT_BLOCKS_CUSTOMER_NOTICE_PATCH',
      draft_status: gate.draftStatus,
      reasons: gate.blockReasons,
    });
  }
  return null;
}

async function assertPackageV3ApprovalAllowed(packageId: string) {
  const latestDraft = await loadLatestV3DraftForPackage(supabaseAdmin, packageId);
  if (!latestDraft) return null;
  const gate = evaluateV3CustomerNoticeGate(packageId, latestDraft);
  if (gate.blocksApproval || gate.payloadError) {
    return ApiErrors.conflict('최신 V3 draft가 고객 공개 조건을 통과하지 못해 승인을 막았습니다.', {
      code: gate.payloadError ? 'V3_NOTICE_PAYLOAD_INVALID' : 'V3_DRAFT_BLOCKS_APPROVAL',
      draft_status: gate.draftStatus,
      reasons: gate.blockReasons,
      payload_error: gate.payloadError,
    });
  }
  return null;
}

// ── 상품코드 자동생성 매핑 ──────────────────────────────────────
async function assertPackageSourceAuditAllowsPublication(packageId: string) {
  return ApiErrors.conflict('구형 mutable 상품 감사·수정 경로는 종료되었습니다.', {
    code: 'LEGACY_PACKAGE_MUTATION_RETIRED',
    packageId,
    next: '/api/admin/product-registration/products/{catalogProductId}/corrections',
  });
}

const DEPARTURE_CODES: Record<string, string> = {
  '김해공항': 'PUS', '김해': 'PUS', '부산': 'PUS', '부산국제여객터미널': 'PUS',
  '인천공항': 'ICN', '인천': 'ICN',
};
const SUPPLIER_CODES: Record<string, string> = {
  '투어폰': 'TP', '투어비': 'TB', '더투어': 'TT', '랜드부산': 'LB',
  '현지투어': 'LT', '나라투어': 'NR', '하나투어 현지': 'HN', '모두투어 현지': 'MD',
  '선셋투어': 'SS', '아시아투어': 'AS', '골든투어': 'GD', '퍼시픽투어': 'PC',
  '드래곤투어': 'DR', '로열투어': 'RY', '직접 진행': 'YS', '여소남': 'YS',
};
const DEST_CODES: Record<string, string> = {
  '장가계': 'ZJJ', '나트랑': 'NHA', '달랏': 'DLT', '나트랑/달랏': 'NHA',
  '나트랑/판랑': 'NHA', '보홀': 'BHO', '후쿠오카': 'FUK', '토야마': 'TOY',
  '시즈오카': 'SZO', '후지노미야': 'SZO', '다낭': 'DAD', '호이안': 'DAD',
  '시모노세키': 'SMN', '시모노세키/후쿠오카/벳부': 'SMN', '마카오': 'MAC',
  '코타키나발루': 'BKI', '푸꾸옥': 'PQC', '연길': 'YNJ', '청도': 'TAO',
  '서안': 'SIA', '상해': 'SHA', '북경': 'PEK',
  '라오스': 'LAO', '비엔티엔': 'LAO', '비엔티안': 'LAO', '비엔티엔/루앙프라방/방비엥': 'LAO',
  '비엔티안/루앙프라방/방비엥': 'LAO', '비엔티엔/방비엥': 'LAO', '비엔티안/방비엥': 'LAO',
};

// ── short_code 자동생성 (TP-NHA-05-01 형식) ──────────────────
async function generateShortCode(
  supplier: string | undefined, destination: string | undefined, duration: number | undefined,
): Promise<string> {
  const supCode = SUPPLIER_CODES[supplier || ''] || 'ETC';
  const destCode = DEST_CODES[destination || ''] || 'ETC';
  const days = String(duration || 4).padStart(2, '0');
  const prefix = `${supCode}-${destCode}-${days}-`;

  if (!supabaseAdmin) return `${prefix}01`;

  const { data: existing } = await supabaseAdmin
    .from('travel_packages')
    .select('short_code')
    .ilike('short_code', `${prefix}%`)
    .order('short_code', { ascending: false })
    .limit(1);

  const lastSeq = existing?.[0]?.short_code
    ? parseInt(existing[0].short_code.split('-').pop() || '0', 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(2, '0')}`;
}

async function generatePackageCode(
  departure: string | undefined, supplier: string | undefined,
  destination: string | undefined, duration: number | undefined,
): Promise<string | null> {
  const depCode = DEPARTURE_CODES[departure || ''] || 'PUS';
  const supCode = SUPPLIER_CODES[supplier || ''] || 'ETC';
  const destCode = DEST_CODES[destination || ''] || 'ETC';
  const days = duration || 4;

  if (!supabaseAdmin) return null;
  try {
    const { data } = await supabaseAdmin.rpc('generate_internal_code', {
      p_departure_code: depCode, p_supplier_code: supCode,
      p_destination_code: destCode, p_duration_days: days,
    });
    return data as string | null;
  } catch {
    // RPC 실패 시 fallback: 수동 생성
    const prefix = `${depCode}-${supCode}-${destCode}-${String(days).padStart(2, '0')}-`;
    const { data: existing } = await supabaseAdmin
      .from('travel_packages')
      .select('internal_code')
      .ilike('internal_code', `${prefix}%`)
      .order('internal_code', { ascending: false })
      .limit(1);
    const lastSeq = existing?.[0]?.internal_code
      ? parseInt(existing[0].internal_code.split('-').pop() || '0', 10)
      : 0;
    return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
  }
}

// ── 상품 목록 JOIN 필드 (products ERP 데이터 포함) ─────────────────────────
// ERR-20260418-10 — PACKAGE_LIST_FIELDS에 surcharges 누락 → A4 포스터 써차지 기간 증발
// W-final F5 (2026-04-21) — drift 감사로 duration / cancellation_policy / normalized_surcharges 3건 추가 감지
const PACKAGE_LIST_FIELDS = `
  id, title, destination, country, category, product_type, trip_style,
  duration, departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_dates, price_list, excluded_dates, confirmed_dates, status, confidence, created_at, updated_at,
  inclusions, excludes, guide_tip, single_supplement, small_group_surcharge, surcharges, normalized_surcharges,
  optional_tours, itinerary, special_notes, customer_notes, internal_notes, notices_parsed, land_operator, commission_rate, affiliate_commission_rate, commission_fixed_amount, commission_currency,
  product_tags, product_highlights, product_summary, itinerary_data,
  marketing_copies, internal_code, short_code, land_operator_id, is_airtel, display_title, hero_tagline,
  data_completeness, field_confidences, is_stub, stub_source,
  catalog_id, price_markup_rate, hard_block_quota,
  dp_reason, dp_triggered_at, view_count_snap_at, view_count_weekly_snap,
  review_reject_category, review_reject_subnote,
  seats_held, seats_confirmed, nights, accommodations, cancellation_policy,
  avg_rating, review_count, view_count, inquiry_count,
  audit_status, audit_report, audit_checked_at,
  publication_state, package_revision,
  products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)
`;

const PACKAGE_LIST_FIELDS_LITE = `
  id, title, destination, country, category, product_type, trip_style,
  duration, departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_dates, price_list, excluded_dates, confirmed_dates, status, confidence, created_at,
  land_operator, commission_rate, product_tags, product_highlights, product_summary,
  itinerary,
  internal_code, short_code, land_operator_id, is_airtel, display_title, hero_tagline,
  audit_status, audit_report, updated_at, optional_tours, itinerary_data,
  publication_state, package_revision,
  products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)
`;

// GET /api/packages?status=&category=&destination=&q=&page=&limit=&id=
export async function GET(request: NextRequest) {
  const isAdmin = await isAdminRequest(request).catch(() => false);
  // Writer authority can remain in legacy/shadow mode during migration, but
  // customer reads must never fall back to mutable travel_packages rows.
  const pointerOnly = !isAdmin;

  if (!isSupabaseConfigured) {
    return applyPackageCache(listResponse([], { total: 0 }), isAdmin);
  }

  const { searchParams } = new URL(request.url);
  const id       = searchParams.get('id');
  const status   = searchParams.get('status') || undefined;
  const category = searchParams.get('category') || undefined;
  const q        = (searchParams.get('q') || '').trim();
  const destFilter = searchParams.get('destination') || '';
  const landOperatorFilter = searchParams.get('land_operator') || '';
  const lite = searchParams.get('lite') === '1';
  const sort = searchParams.get('sort') || 'created_desc';
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit    = Math.min(500, parseInt(searchParams.get('limit') || '100'));
  const from     = (page - 1) * limit;

  try {
    // 목적지별 집계 — 홈페이지용
    const aggregate = searchParams.get('aggregate');
    if (aggregate === 'destination') {
      // 1. mv_destination_aggregates → RPC 우선 (사전 집계, O(distinct destinations))
      //    마이그레이션: supabase/migrations/20260513000000_destination_aggregate_mv.sql
      //    nightly cron (KST 09:10) 으로 갱신. 즉시성 필요 시 SELECT public.refresh_mv_destination_aggregates();
      const { data: rpcData, error: rpcErr } = isAdmin
        ? await supabaseAdmin.rpc('get_destinations_aggregate')
        : { data: null, error: null };
      if (isAdmin && !rpcErr && Array.isArray(rpcData)) {
        return applyPackageCache(successResponse({ destinations: rpcData }), isAdmin);
      }

      // 2. Fallback (RPC 미설치 또는 일시 장애 시) — 인메모리 집계.
      //    travel_packages 가 수만 건으로 늘어나면 메모리 위험. RPC 정상화 우선.
      logWarning('[api/packages] GET aggregate=destination RPC failed, using fallback', rpcErr);
      const allPkgs = pointerOnly
        ? await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: 5_000 })
        : (await supabaseAdmin
          .from('travel_packages')
          .select('id, destination, price, price_tiers, price_dates, country, status, audit_status, audit_report, updated_at, optional_tours, itinerary_data, publication_state, package_revision')
          .in('status', [...CUSTOMER_VISIBLE_STATUSES])).data ?? [];

      const destMap: Record<string, { count: number; minPrice: number; country: string }> = {};
      const aggregateRows = isAdmin
        ? allPkgs
        : pointerOnly
          ? allPkgs.filter((p) => hasUpcomingPublicDepartureDate(p))
          : await fetchAndMergeCurrentPublicPackageCardSnapshots(
            supabaseAdmin,
            allPkgs.filter((p: any) => isCustomerPublicSnapshotCandidate(p) && hasUpcomingPublicDepartureDate(p)),
          );
      aggregateRows.forEach((p: any) => {
        const dest = p.destination;
        if (!dest) return;
        if (!destMap[dest]) destMap[dest] = { count: 0, minPrice: Infinity, country: p.country || '' };
        destMap[dest].count++;
        // price_dates 우선, 없으면 price_tiers 폴백
        let min = Infinity;
        if (p.price_dates?.length) {
          const pdPrices = ((p.price_dates ?? []) as { price?: number }[]).map((d) => d.price).filter((v): v is number => v !== undefined);
          if (pdPrices.length > 0) min = Math.min(...pdPrices);
        }
        if (min === Infinity) {
          const tierPrices = (p.price_tiers || []).map((t: any) => t.adult_price).filter(Boolean);
          const allPrices = [p.price, ...tierPrices].filter(Boolean);
          if (allPrices.length > 0) min = Math.min(...allPrices);
        }
        if (min < destMap[dest].minPrice) destMap[dest].minPrice = min;
      });

      const destinations = Object.entries(destMap)
        .map(([dest, info]) => ({ destination: dest, ...info, minPrice: info.minPrice === Infinity ? 0 : info.minPrice }))
        .sort((a, b) => b.count - a.count);

      return applyPackageCache(successResponse({ destinations }), isAdmin);
    }

    // 단건 조회 — UUID 또는 short_code로 조회
    if (id) {
      if (pointerOnly) {
        const current = await getCurrentPublicPackage(supabaseAdmin, {
          tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
          packageRef: id,
          channel: 'customer',
          locale: 'ko-KR',
        });
        if (!current) return applyPackageCache(ApiErrors.notFound('패키지를 찾을 수 없습니다.'), isAdmin);
        const responsePkg: Record<string, unknown> = { ...current.package, id: current.row.package_id };
        let lp_hero_image_url: string | null = null;
        try {
          lp_hero_image_url = await resolveLpHeroPhotoUrl(supabaseAdmin, responsePkg);
        } catch (error) {
          logWarning('[api/packages] pointer-only LP hero resolve failed', error);
        }
        const itineraryData = responsePkg.itinerary_data;
        return applyPackageCache(successResponse({
          package: stripPublicPackageFields(responsePkg),
          lp_hero_image_url,
          attraction_ids: collectAttractionIds(itineraryData),
          attraction_preview_names: getAttractionPreviewNamesFromItinerary(itineraryData, 8),
        }, 200, 300), isAdmin);
      }
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const col = isUUID ? 'id' : 'short_code';
      const { data: pkg, error: pkgErr } = await supabaseAdmin
        .from('travel_packages')
        .select('*, products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)')
        .eq(col, id)
        .single();
      if (pkgErr || !pkg) return applyPackageCache(ApiErrors.notFound('패키지를 찾을 수 없습니다.'), isAdmin);
      const publicSnapshot = !isAdmin
        ? await fetchLatestPublicPackageSnapshot(supabaseAdmin, String(pkg.id), {
          tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
          expectedPackageRevision: Number(pkg.package_revision ?? 1),
        })
        : null;
      if (!isAdmin && (!isCustomerPublicSnapshotCandidate(pkg as Record<string, unknown>) || !publicSnapshot)) {
        return applyPackageCache(ApiErrors.notFound('패키지를 찾을 수 없습니다.'), isAdmin);
      }

      const publicSnapshotPackage = publicSnapshot?.package ?? null;
      if (!isAdmin && !publicSnapshotPackage) {
        return ApiErrors.notFound('패키지를 찾을 수 없습니다.');
      }
      const responsePkg: Record<string, unknown> = isAdmin
        ? pkg as Record<string, unknown>
        : { ...publicSnapshotPackage, id: pkg.id };

      let lp_hero_image_url: string | null = null;
      if (supabaseAdmin) {
        try {
          lp_hero_image_url = await resolveLpHeroPhotoUrl(supabaseAdmin, responsePkg);
        } catch (e) {
          logWarning('[api/packages] GET lp hero resolve failed', e);
        }
      }

      const itineraryData = responsePkg.itinerary_data;
      const attraction_ids = collectAttractionIds(itineraryData);
      return applyPackageCache(successResponse(
        {
          package: isAdmin
            ? stripSupplierRemarkFields(responsePkg)
            : stripPublicPackageFields(responsePkg),
          lp_hero_image_url,
          attraction_ids,
          attraction_preview_names: getAttractionPreviewNamesFromItinerary(itineraryData, 8),
        },
        200,
        300,
      ), isAdmin);
    }

    // 목록 조회 — products JOIN 포함
    // count: 'planned' — pg_stat 기반 추정 (수만 행 테이블에서 'exact' 보다 100배+ 빠름).
    //   페이지 네비게이션 UI 목적에는 추정치로 충분. 정확도 필요 시 ?countMode=exact 명시.
    if (pointerOnly) {
      let publicRows = (await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: 5_000 }))
        .filter((row) => hasUpcomingPublicDepartureDate(row));
      if (status && !['all', 'selling', 'approved', 'active', 'published'].includes(status)) publicRows = [];
      if (category) publicRows = publicRows.filter(row => row.category === category);
      if (destFilter) publicRows = publicRows.filter(row => row.destination === destFilter);
      if (landOperatorFilter) publicRows = publicRows.filter(row => row.land_operator === landOperatorFilter);
      if (q) {
        const needle = q.toLocaleLowerCase('ko-KR');
        publicRows = publicRows.filter(row => [
          row.title,
          row.display_title,
          row.short_code,
          row.destination,
          row.land_operator,
        ].some(value => String(value ?? '').toLocaleLowerCase('ko-KR').includes(needle)));
      }
      const textCompare = (a: Record<string, unknown>, b: Record<string, unknown>, key: string) =>
        String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'ko-KR');
      publicRows.sort((a, b) => {
        switch (sort) {
          case 'created_asc': return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
          case 'title_asc': return textCompare(a, b, 'title');
          case 'title_desc': return textCompare(b, a, 'title');
          case 'land_operator_asc': return textCompare(a, b, 'land_operator');
          case 'land_operator_desc': return textCompare(b, a, 'land_operator');
          case 'destination_asc': return textCompare(a, b, 'destination');
          case 'destination_desc': return textCompare(b, a, 'destination');
          default: return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
        }
      });
      const total = publicRows.length;
      const enrichedData = publicRows.slice(from, from + limit).map(row => ({
        ...stripPublicPackageFields(row),
        has_itinerary_data: Boolean(
          (row.itinerary_data as { days?: unknown[] } | null)?.days?.length
          || (Array.isArray(row.itinerary) && row.itinerary.length > 0)
        ),
        attraction_preview_names: getAttractionPreviewNamesFromItinerary(row.itinerary_data, 4),
      }));
      return applyPackageCache(listResponse(enrichedData, {
        total,
        page,
        limit,
        cacheSeconds: 300,
      }), isAdmin);
    }

    const countMode = searchParams.get('countMode') || 'planned';
    const queryBase = supabaseAdmin.from('travel_packages');
    const selected = lite
      ? queryBase.select(PACKAGE_LIST_FIELDS_LITE, { count: countMode as 'exact' | 'planned' | 'estimated' })
      : queryBase.select(PACKAGE_LIST_FIELDS, { count: countMode as 'exact' | 'planned' | 'estimated' });
    let query = selected.range(from, from + limit - 1);

    // 서버 정렬 (가격은 구조상 로컬 보조 정렬 유지 가능)
    switch (sort) {
      case 'created_asc': query = query.order('created_at', { ascending: true }); break;
      case 'title_asc': query = query.order('title', { ascending: true }); break;
      case 'title_desc': query = query.order('title', { ascending: false }); break;
      case 'land_operator_asc': query = query.order('land_operator', { ascending: true }); break;
      case 'land_operator_desc': query = query.order('land_operator', { ascending: false }); break;
      case 'commission_rate_asc': query = query.order('commission_rate', { ascending: true }); break;
      case 'commission_rate_desc': query = query.order('commission_rate', { ascending: false }); break;
      case 'destination_asc': query = query.order('destination', { ascending: true }); break;
      case 'destination_desc': query = query.order('destination', { ascending: false }); break;
      case 'deadline_asc': query = query.order('ticketing_deadline', { ascending: true }); break;
      case 'deadline_desc': query = query.order('ticketing_deadline', { ascending: false }); break;
      case 'status_asc': query = query.order('status', { ascending: true }); break;
      case 'status_desc': query = query.order('status', { ascending: false }); break;
      case 'created_desc':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }

    if (status && status !== 'all') {
      // 관리자 탭 상태(semantic) 호환
      if (status === 'selling') {
        query = query.in('status', [...CUSTOMER_VISIBLE_STATUSES]);
      } else if (status === 'pending') {
        query = query.in('status', ['pending', 'pending_review', 'draft']);
      } else if (status === 'archived') {
        query = query.in('status', ['archived', 'INACTIVE']);
      } else {
        query = query.eq('status', status);
      }
    }
    if (category)                   query = query.eq('category', category);
    if (destFilter)                 query = query.eq('destination', destFilter);
    if (landOperatorFilter)         query = query.eq('land_operator', landOperatorFilter);

    // 검색: title/internal_code/short_code/destination/land_operator
    if (q) {
      const safeQ = escapePostgrestIlikeValue(q);
      if (safeQ) {
        query = query.or(
          `title.ilike.%${safeQ}%,internal_code.ilike.%${safeQ}%,short_code.ilike.%${safeQ}%,destination.ilike.%${safeQ}%,land_operator.ilike.%${safeQ}%`,
        );
      }
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const visibleRows = isAdmin
      ? (data ?? [])
      : await fetchAndMergeCurrentPublicPackageCardSnapshots(
        supabaseAdmin,
        (data ?? []).filter((row: any) => isCustomerPublicSnapshotCandidate(row)),
      );
    const enrichedData = visibleRows.map((row: any) => {
      const safeRow = isAdmin
        ? stripSupplierRemarkFields(row)
        : stripPublicPackageFields(row);
      return {
        ...safeRow,
        has_itinerary_data:
          !!row.itinerary_data?.days?.length ||
          (Array.isArray(row.itinerary) && row.itinerary.length > 0),
        attraction_preview_names: getAttractionPreviewNamesFromItinerary(row.itinerary_data, 4),
      };
    });
    const totalPages = Math.ceil((count ?? 0) / limit);
    // Edge CDN cache 5분 + SWR 10분 (이전: 1분/2분).
    //   상품 목록은 매분 바뀌지 않으므로 적극 캐시. 등록/승인 시 revalidatePath('/packages') 로 무효화.
    return applyPackageCache(listResponse(enrichedData, {
      total: isAdmin ? (count ?? 0) : enrichedData.length,
      page,
      limit,
      cacheSeconds: 300,
    }), isAdmin);
  } catch (error) {
    logError('[api/packages] GET query failed', error);
    return applyPackageCache(
      ApiErrors.internalError(error instanceof Error ? error.message : '조회 실패'),
      isAdmin,
    );
  }
}

// POST /api/packages - 새 상품 저장
export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '새 상품은 원문 업로드와 Registration Kernel로만 등록할 수 있습니다.',
    code: 'LEGACY_PACKAGE_CREATE_RETIRED',
    next: '/admin/upload',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
}

// PATCH /api/packages - 상품 수정 또는 상태 변경
export async function PATCH(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '상품 사실 수정은 새 correction revision으로만 처리할 수 있습니다.',
    code: 'LEGACY_PACKAGE_UPDATE_RETIRED',
    next: '/api/admin/product-registration/products/{catalogProductId}/corrections',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
}

// DELETE /api/packages?id=
export async function DELETE(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '상품 삭제·판매중단은 availability overlay로만 처리할 수 있습니다.',
    code: 'LEGACY_PACKAGE_DELETE_RETIRED',
    next: '/api/admin/product-registration/products/{catalogProductId}/availability',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
}
