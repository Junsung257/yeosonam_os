import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  saveTravelPackage,
  deletePackage,
  approvePackage,
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
import { isAdminRequest } from '@/lib/admin-guard';
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import {
  evaluateV3CustomerNoticeGate,
  hasSupplierRemarkRawLeakRisk,
  hasUnsafeCustomerNoticeMutation,
  loadLatestV3DraftForPackage,
} from '@/lib/product-registration-v3/customer-payload';
import { evaluateVerifyChecks } from '@/lib/upload-verify';
import { buildSourceBackedPriceDateRepair } from '@/lib/source-price-date-repair';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';

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

function includesCustomerNoticeFields(input: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'notices_parsed')
    || Object.prototype.hasOwnProperty.call(input, 'customer_notes');
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
  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, status, audit_status, audit_report, updated_at, duration, nights, price, display_title, hero_tagline, raw_text, trip_style, itinerary_data, accommodations, inclusions, optional_tours, price_dates, price_list, departure_days, surcharges')
    .eq('id', packageId)
    .single();

  if (error || !pkg) {
    return ApiErrors.conflict('Cannot approve because the package source audit row could not be loaded.', {
      code: 'SOURCE_AUDIT_ROW_MISSING',
      packageId,
      error: error?.message,
    });
  }

  const workingPkg = { ...(pkg as Record<string, unknown>) };
  const repair = buildSourceBackedPriceDateRepair(pkg as Parameters<typeof buildSourceBackedPriceDateRepair>[0]);
  if (repair.status === 'repaired') {
    workingPkg.price_dates = repair.priceDates;
  }

  const result = evaluateVerifyChecks({
    ...workingPkg,
    status: 'approved',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);

  const auditReport = {
    checks: result.checks,
    fixable: result.fixable,
    source: 'package-approval-source-verify',
    version: 3,
    source_price_date_repair: repair,
  };

  await supabaseAdmin
    .from('travel_packages')
    .update({
      ...(repair.status === 'repaired' ? { price_dates: repair.priceDates } : {}),
      audit_status: result.status,
      audit_report: auditReport,
      audit_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', packageId);

  if (result.status === 'blocked' || result.status === 'warnings') {
    return ApiErrors.conflict('Latest source-vs-saved audit is not clean enough for customer publication.', {
      code: result.status === 'blocked' ? 'SOURCE_AUDIT_BLOCKS_PUBLICATION' : 'SOURCE_AUDIT_WARNINGS_REQUIRE_REVIEW',
      packageId,
      source_verify: result,
      source_price_date_repair: repair,
    });
  }

  const mobileProof = evaluateCustomerMobileProof({
    auditReport: (pkg as { audit_report?: unknown }).audit_report ?? null,
    packageUpdatedAt: (pkg as { updated_at?: string | null }).updated_at ?? null,
  });
  if (!mobileProof.ok) {
    await supabaseAdmin
      .from('travel_packages')
      .update({
        audit_status: 'blocked',
        audit_report: {
          ...auditReport,
          mobile_browser_proof: mobileProof.proof,
          mobile_browser_proof_required: {
            status: 'fail',
            reason: mobileProof.reason,
            checked_at: new Date().toISOString(),
          },
        },
        audit_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', packageId);
    return ApiErrors.conflict('Actual /packages mobile browser proof is required before customer publication.', {
      code: 'MOBILE_BROWSER_PROOF_REQUIRED',
      packageId,
      mobile_browser_proof: mobileProof,
      source_verify: result,
    });
  }

  return null;
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
  products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)
`;

const PACKAGE_LIST_FIELDS_LITE = `
  id, title, destination, country, category, product_type, trip_style,
  duration, departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_dates, price_list, excluded_dates, confirmed_dates, status, confidence, created_at,
  land_operator, commission_rate, product_tags, product_highlights, product_summary,
  itinerary,
  internal_code, short_code, land_operator_id, is_airtel, display_title, hero_tagline,
  audit_status, products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)
`;

// GET /api/packages?status=&category=&destination=&q=&page=&limit=&id=
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return listResponse([], { total: 0 });
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
    const isAdmin = await isAdminRequest(request).catch(() => false);

    // 목적지별 집계 — 홈페이지용
    const aggregate = searchParams.get('aggregate');
    if (aggregate === 'destination') {
      // 1. mv_destination_aggregates → RPC 우선 (사전 집계, O(distinct destinations))
      //    마이그레이션: supabase/migrations/20260513000000_destination_aggregate_mv.sql
      //    nightly cron (KST 09:10) 으로 갱신. 즉시성 필요 시 SELECT public.refresh_mv_destination_aggregates();
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('get_destinations_aggregate');
      if (!rpcErr && Array.isArray(rpcData)) {
        return successResponse({ destinations: rpcData });
      }

      // 2. Fallback (RPC 미설치 또는 일시 장애 시) — 인메모리 집계.
      //    travel_packages 가 수만 건으로 늘어나면 메모리 위험. RPC 정상화 우선.
      logWarning('[api/packages] GET aggregate=destination RPC failed, using fallback', rpcErr);
      const { data: allPkgs } = await supabaseAdmin
        .from('travel_packages')
        .select('destination, price, price_tiers, price_dates, country')
        .in('status', ['active', 'approved']);

      const destMap: Record<string, { count: number; minPrice: number; country: string }> = {};
      (allPkgs ?? []).forEach((p: any) => {
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

      return successResponse({ destinations });
    }

    // 단건 조회 — UUID 또는 short_code로 조회
    if (id) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const col = isUUID ? 'id' : 'short_code';
      const { data: pkg, error: pkgErr } = await supabaseAdmin
        .from('travel_packages')
        .select('*, products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)')
        .eq(col, id)
        .single();
      if (pkgErr || !pkg) return ApiErrors.notFound('패키지를 찾을 수 없습니다.');

      let lp_hero_image_url: string | null = null;
      if (supabaseAdmin) {
        try {
          lp_hero_image_url = await resolveLpHeroPhotoUrl(supabaseAdmin, pkg);
        } catch (e) {
          logWarning('[api/packages] GET lp hero resolve failed', e);
        }
      }

      const attraction_ids = collectAttractionIds(pkg.itinerary_data);
      return successResponse(
        {
          package: isAdmin
            ? stripSupplierRemarkFields(pkg as Record<string, unknown>)
            : stripPublicPackageFields(pkg as Record<string, unknown>),
          lp_hero_image_url,
          attraction_ids,
          attraction_preview_names: getAttractionPreviewNamesFromItinerary(pkg.itinerary_data, 8),
        },
        200,
        300,
      );
    }

    // 목록 조회 — products JOIN 포함
    // count: 'planned' — pg_stat 기반 추정 (수만 행 테이블에서 'exact' 보다 100배+ 빠름).
    //   페이지 네비게이션 UI 목적에는 추정치로 충분. 정확도 필요 시 ?countMode=exact 명시.
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
        query = query.in('status', ['approved', 'active']);
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

    const enrichedData = (data ?? []).map((row: any) => {
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
    return listResponse(enrichedData, {
      total: count ?? 0,
      page,
      limit,
      cacheSeconds: 300,
    });
  } catch (error) {
    logError('[api/packages] GET query failed', error);
    return ApiErrors.internalError(error instanceof Error ? error.message : '조회 실패');
  }
}

// POST /api/packages - 새 상품 저장
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return ApiErrors.internalError('Supabase가 설정되지 않았습니다.');
  }

  try {
    const body = await request.json();

    if (!body.title) {
      return ApiErrors.badRequest('상품명(title)이 필요합니다.');
    }

    // ── W-final F4: Zod Hard-Block (default ON, 2026-04-21) ──
    // 이전: STRICT_VALIDATION 플래그 필요. 변경: **기본 ON**. 이제 POST 로 들어오는 모든 데이터가
    //   ACL 정규화 → PackageCoreSchema 검증을 거친다. 실패 시 HTTP 400 (draft 저장 옵션은 유지).
    //
    //   우회는 `STRICT_VALIDATION=false` 환경변수로만 (개발/마이그레이션 용도, 프로덕션 금지).
    //   `ALLOW_DRAFT=true` 시 검증 실패해도 draft 로 저장하고 validation_errors 에 기록.
    //
    //   Rule Zero 강제: raw_text 50자 미만이면 검증 이전에 400 반환.
    const STRICT_OFF = process.env.STRICT_VALIDATION === 'false';
    if (!body.raw_text || typeof body.raw_text !== 'string' || body.raw_text.length < 50) {
      if (!STRICT_OFF) {
        return ApiErrors.badRequest('[RuleZero] raw_text 누락 또는 의심스럽게 짧음. 원문 원본(50자 이상) 필수.', {
          field: 'raw_text',
          length: body.raw_text?.length || 0,
        });
      }
    }
    if (!STRICT_OFF) {
      try {
        const { normalizePackage } = await import('@/lib/package-acl');
        const { validatePackageLoose, formatZodErrors } = await import('@/lib/package-schema');
        const normalized = normalizePackage(body);
        const result = validatePackageLoose(normalized);
        if (!result.success && result.errors) {
          const errMsgs = formatZodErrors(result.errors);
          if (process.env.ALLOW_DRAFT === 'true') {
            // draft 로 저장하고 에러는 validation_errors 필드에 기록 — 어드민이 수동 수정
            body.status = 'draft';
            body.validation_errors = errMsgs;
            logWarning(`[api/packages] POST draft saved with validation errors`, new Error(`${errMsgs.length} violations`));
          } else {
            // Hard block — 어떤 프론트엔드/외부 API 도 불량 데이터 INSERT 불가
            return ApiErrors.badRequest('Zod 검증 실패 (W-final F4 hard-block)', {
              issues: errMsgs,
              hint: '프론트엔드에서 오는 데이터라도 동일 검증 적용. 임시 우회는 STRICT_VALIDATION=false (비권장).',
            });
          }
        }
      } catch (e) {
        // ACL/Zod 모듈 import 자체 실패 — 이건 심각 (스키마 파일 결실)
        logError('[api/packages] POST Zod module load failed', e);
        return ApiErrors.internalError('Zod 검증기 로드 실패 — 서버 설정 오류', {
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ── Phase 3-D: 임베딩 기반 중복 감지 ──
    // ?force=true 쿼리로 우회 가능 (VA가 "새 상품으로 등록" 선택 시)
    const { searchParams: postParams } = new URL(request.url);
    const forceDuplicate = postParams.get('force') === 'true';
    if (!forceDuplicate && supabaseAdmin && getSecret('GOOGLE_AI_API_KEY')) {
      try {
        const embedSource = [
          body.title,
          body.destination ?? '',
          typeof body.duration === 'number' ? `${body.duration}일` : '',
          body.land_operator ?? '',
          safeRawTextExcerpt(body.rawText ?? body.raw_text, 1000) ?? '',
        ].filter(Boolean).join(' ');

        const vec = await embedText(embedSource, getSecret('GOOGLE_AI_API_KEY')!, 'SEMANTIC_SIMILARITY');
        if (vec && vec.length > 0) {
          const { data: similar, error: simErr } = await supabaseAdmin.rpc('match_travel_packages_duplicate', {
            query_embedding: vec,
            match_threshold: 0.95,
            match_count: 3,
            exclude_id: null,
          });
          if (!simErr && Array.isArray(similar) && similar.length > 0) {
            return ApiErrors.conflict(`유사한 상품이 ${similar.length}건 감지됨. 새 상품으로 등록하려면 ?force=true 추가`, {
              warning: 'duplicate_suspected',
              similar_products: similar,
            });
          }
        }
      } catch (e) {
        logWarning('[api/packages] POST duplicate detection failed (ignored)', e);
      }
    }

    // ── short_code 자동생성 (URL용 짧은 코드) ──
    const shortCode = body.short_code || await generateShortCode(
      body.land_operator, body.destination, body.duration
    );

    // ── 상품코드 자동생성 (internal_code가 없을 때) ──
    let internalCode = body.internal_code || null;
    if (!internalCode && supabaseAdmin) {
      internalCode = await generatePackageCode(
        body.departure_airport, body.land_operator, body.destination, body.duration
      );
    }

    // ── land_operator_id 자동매핑 (텍스트 → UUID) ──
    // is_active 필터: 소프트 삭제(is_active=false)된 랜드사로 잘못 매핑되는 것을 방지.
    let landOperatorId = body.land_operator_id || null;
    if (!landOperatorId && body.land_operator && supabaseAdmin) {
      const { data: opData } = await supabaseAdmin
        .from('land_operators')
        .select('id')
        .eq('name', body.land_operator)
        .eq('is_active', true)
        .limit(1);
      if (opData?.length) landOperatorId = opData[0].id;
    }

    // ── C 파서 정제 레이어: 텍스트 정제 + 불포함 가드레일 ──
    const rawText = body.rawText || body.raw_text || '';
    const category = body.category || 'package';
    let sanitizeWarnings: Array<{ rule: string; description: string }> = [];
    let sanitizeCorrections: Array<{ from: string; to: string }> = [];

    if (supabaseAdmin && rawText) {
      try {
        const fullText = buildFullTextForValidation({
          rawText,
          excludes: body.excludes,
          specialNotes: body.specialNotes || body.special_notes,
          noticesParsed: body.notices_parsed,
          inclusions: body.inclusions,
        });
        const sanitizeResult = await runSanitizePipeline(fullText, category, supabaseAdmin);
        sanitizeWarnings = sanitizeResult.exclusionWarnings;
        sanitizeCorrections = sanitizeResult.corrections;

        if (sanitizeCorrections.length > 0) {
          console.log(`[Sanitizer] ${body.title}: ${sanitizeCorrections.length}건 교정`, sanitizeCorrections);
        }
        if (sanitizeWarnings.length > 0) {
          logWarning(`[api/packages] POST text sanitizer warnings`, new Error(`${sanitizeWarnings.length} violations for "${body.title}"`));
        }
      } catch (e) {
        logError('[api/packages] POST text sanitizer pipeline failed', e);
      }
    }

    // ── price_tiers → price_dates 자동 변환 (없으면 생성) ──
    const priceDates = body.price_dates?.length
      ? body.price_dates
      : body.price_tiers?.length
        ? tiersToDatePrices(body.price_tiers)
        : [];

    if (hasSupplierRemarkRawLeakRisk({
      notices_parsed: body.notices_parsed,
      customer_notes: body.customer_notes,
    })) {
      return ApiErrors.conflict('수동 상품 생성 시 랜드사 REMARK 원문성 안내문은 고객 필드에 직접 저장할 수 없습니다.', {
        code: 'SUPPLIER_REMARK_RAW_LEAK_RISK',
      });
    }

    const result = await saveTravelPackage({
      title: body.title,
      destination: body.destination,
      duration: body.duration,
      price: body.price,
      filename: body.filename || 'manual',
      fileType: body.fileType || 'pdf',
      rawText,
      itinerary: body.itinerary,
      inclusions: body.inclusions,
      excludes: body.excludes,
      accommodations: body.accommodations,
      specialNotes: body.specialNotes || body.special_notes,
      confidence: body.confidence || 0,
      category,
      product_type: body.product_type,
      trip_style: body.trip_style,
      departure_days: body.departure_days,
      departure_airport: body.departure_airport,
      airline: body.airline,
      min_participants: body.min_participants,
      ticketing_deadline: body.ticketing_deadline,
      guide_tip: body.guide_tip,
      single_supplement: body.single_supplement,
      small_group_surcharge: body.small_group_surcharge,
      price_tiers: body.price_tiers,
      price_dates: priceDates,
      surcharges: body.surcharges,
      excluded_dates: body.excluded_dates,
      optional_tours: body.optional_tours,
      cancellation_policy: body.cancellation_policy,
      category_attrs: body.category_attrs,
      itinerary_data: body.itinerary_data,
      notices_parsed: body.notices_parsed,
      price_list: body.price_list,
      land_operator: body.land_operator,
      commission_rate: body.commission_rate,
      product_tags: body.product_tags,
      product_highlights: body.product_highlights,
      product_summary: body.product_summary,
    });

    // ── 상품코드 + 랜드사ID + short_code 후처리 업데이트 ──
    if (result?.id && supabaseAdmin) {
      const patch: Record<string, unknown> = {};
      if (shortCode) patch.short_code = shortCode;
      if (internalCode) patch.internal_code = internalCode;
      if (landOperatorId) patch.land_operator_id = landOperatorId;
      if (Object.keys(patch).length > 0) {
        const { error: patchErr } = await supabaseAdmin
          .from('travel_packages')
          .update(patch)
          .eq('id', result.id);
        if (patchErr) logError('[api/packages] POST post-processing update failed', new Error(patchErr.message));
      }
    }

    return successResponse({
      package: { ...result, short_code: shortCode, internal_code: internalCode, land_operator_id: landOperatorId },
      sanitize: {
        corrections: sanitizeCorrections,
        warnings: sanitizeWarnings,
      },
    }, 201);
  } catch (error) {
    logError('[api/packages] POST save failed', error);
    return ApiErrors.internalError(error instanceof Error ? error.message : '저장 실패');
  }
}

// PATCH /api/packages - 상품 수정 또는 상태 변경
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return ApiErrors.internalError('Supabase가 설정되지 않았습니다.');
  }

  try {
    const body = await request.json();
    const { packageId, action, ...updateData } = body;

    // 일괄 승인
    if (action === 'bulk_approve') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return ApiErrors.badRequest('packageIds 배열이 필요합니다.');
      }
      const approvalBlocks = [];
      for (const id of packageIds) {
        const sourceAuditBlock = await assertPackageSourceAuditAllowsPublication(id);
        if (sourceAuditBlock) {
          approvalBlocks.push({
            packageId: id,
            draft_status: null,
            reasons: ['SOURCE_AUDIT_BLOCKS_PUBLICATION'],
            payload_error: null,
          });
          continue;
        }
        const latestDraft = await loadLatestV3DraftForPackage(supabaseAdmin, id);
        if (!latestDraft) continue;
        const gate = evaluateV3CustomerNoticeGate(id, latestDraft);
        if (gate.blocksApproval || gate.payloadError) {
          approvalBlocks.push({
            packageId: id,
            draft_status: gate.draftStatus,
            reasons: gate.blockReasons,
            payload_error: gate.payloadError,
          });
        }
      }
      if (approvalBlocks.length > 0) {
        return ApiErrors.conflict('V3 draft가 검수 대기/차단 상태인 상품이 있어 일괄 승인을 막았습니다.', {
          code: 'V3_DRAFT_BLOCKS_BULK_APPROVAL',
          blocked: approvalBlocks,
        });
      }
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update({
          status: 'approved',
          updated_at: now,
          // Option B: 승인 시 자동으로 visual baseline 재생성 큐 등록
          baseline_requested_at: now,
        })
        .in('id', packageIds);
      if (error) throw error;
      // ERR-KUL-ISR — 변경된 각 상품의 ISR 캐시 즉시 무효화 (최대 1시간 대기 방지)
      // 캐시 무효화 실패가 DB 성공 응답까지 막지 않도록 격리.
      try {
        const { revalidateTag } = await import('next/cache');
        for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
        revalidatePath('/packages');
        revalidateTag('packages'); // Task 4: Tag-based Invalidation 적용
        revalidateLandingPagesForPackageIds(packageIds);
      } catch (e) {
        logWarning('[api/packages] PATCH revalidate paths failed (ignored)', e);
      }
      invalidateQaChatPackageCache();
      return successResponse({ count: packageIds.length });
    }

    // 일괄 아카이브 (소프트 삭제 — 데이터 보존, 고객 노출 안 됨)
    if (action === 'bulk_archive' || action === 'bulk_delete' || action === 'bulk_inactive') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return ApiErrors.badRequest('packageIds 배열이 필요합니다.');
      }
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      try {
        const { skipBlogQueueForPackages } = await import('@/lib/blog-queue-lifecycle');
        await skipBlogQueueForPackages(packageIds, 'bulk_archive_package');
      } catch (e) {
        logWarning('[api/packages] PATCH blog_topic_queue skip on bulk_archive', e);
      }
      const { revalidateTag } = await import('next/cache');
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      revalidateTag('packages');
      revalidateLandingPagesForPackageIds(packageIds);
      return successResponse({ count: packageIds.length });
    }

    // 아카이브 복원 → 검토 대기로
    if (action === 'bulk_restore' || action === 'bulk_active') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return ApiErrors.badRequest('packageIds 배열이 필요합니다.');
      }
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      revalidateLandingPagesForPackageIds(packageIds);
      return successResponse({ count: packageIds.length });
    }

    // 일괄 필드 업데이트 (랜드사, 커미션 등)
    if (action === 'bulk_update') {
      const { packageIds, fields } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return ApiErrors.badRequest('packageIds 배열이 필요합니다.');
      }
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (fields.land_operator !== undefined) updateData.land_operator = fields.land_operator;
      if (fields.commission_rate !== undefined) updateData.commission_rate = Number(fields.commission_rate);
      if (fields.affiliate_commission_rate !== undefined) {
        // 0~30% 범위 강제 (DB CHECK 제약과 동일)
        const r = Number(fields.affiliate_commission_rate);
        if (Number.isFinite(r) && r >= 0 && r <= 0.30) {
          updateData.affiliate_commission_rate = r;
        }
      }
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update(updateData)
        .in('id', packageIds);
      if (error) throw error;
      const { revalidateTag } = await import('next/cache');
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      revalidateTag('packages');
      revalidateLandingPagesForPackageIds(packageIds);
      return successResponse({ count: packageIds.length });
    }

    if (!packageId) {
      return ApiErrors.badRequest('packageId가 필요합니다.');
    }

    // 단건 상태 변경
    if (action === 'approve') {
      const sourceAuditBlock = await assertPackageSourceAuditAllowsPublication(packageId);
      if (sourceAuditBlock) return sourceAuditBlock;
      const v3ApprovalBlock = await assertPackageV3ApprovalAllowed(packageId);
      if (v3ApprovalBlock) return v3ApprovalBlock;
      const result = await approvePackage(packageId);
      let searchAds: { saved: number; keywords: number; scenarios?: number; blog_actions?: number } | null = null;
      try {
        const { runAdOsProductAutopilot } = await import('@/lib/ad-os-product-autopilot');
        const plan = await runAdOsProductAutopilot({
          packageId,
          mode: 'guarded',
          apply: true,
          source: 'package_approve',
        });
        searchAds = {
          saved: plan.search_ads.saved,
          keywords: plan.search_ads.keywords,
          scenarios: plan.scenarios.saved,
          blog_actions: plan.scenarios.queued_blog_actions,
        };
      } catch (e) {
        logWarning('[api/packages] PATCH Ad OS product autopilot failed', e);
      }
      revalidatePath(`/packages/${packageId}`);
      revalidatePath('/packages');
      revalidateLandingPagesForPackage(packageId, result?.short_code ?? null);
      invalidateQaChatPackageCache();
      return successResponse({ package: result, search_ads: searchAds });
    }

    if (action === 'reject') {
      const { data, error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', packageId)
        .select();
      if (error) throw error;
      try {
        const { skipBlogQueueForPackages } = await import('@/lib/blog-queue-lifecycle');
        await skipBlogQueueForPackages([packageId], 'package_rejected');
      } catch (e) {
        logWarning('[api/packages] PATCH blog_topic_queue skip on reject', e);
      }
      revalidatePath(`/packages/${packageId}`);
      revalidatePath('/packages');
      revalidateLandingPagesForPackage(
        packageId,
        (data?.[0] as { short_code?: string | null } | undefined)?.short_code ?? null,
      );
      return successResponse({ package: data?.[0] });
    }

    // 필드 업데이트 — supabaseAdmin으로 RLS 우회
    // 화이트리스트: 허용된 필드만 업데이트 (보안)
    const ALLOWED_FIELDS = new Set([
      'title', 'destination', 'duration', 'price', 'status',
      'category', 'product_type', 'trip_style', 'departure_days',
      'departure_airport', 'airline', 'min_participants', 'ticketing_deadline',
      'guide_tip', 'single_supplement', 'small_group_surcharge',
      'price_tiers', 'price_dates', 'price_list', 'surcharges', 'excluded_dates',
      'optional_tours', 'cancellation_policy', 'category_attrs',
      'inclusions', 'excludes', 'special_notes', 'customer_notes', 'notices_parsed',
      'itinerary', 'itinerary_data', 'raw_text',
      'land_operator', 'land_operator_id', 'commission_rate', 'affiliate_commission_rate',
      'product_tags', 'product_highlights', 'product_summary',
      'marketing_copies', 'internal_code', 'confidence',
      'country', 'nights', 'accommodations',
    ]);
    const sanitized: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(updateData)) {
      if (ALLOWED_FIELDS.has(key)) sanitized[key] = value;
    }
    // price_tiers 수정 시 price_dates 자동 동기화 (직접 price_dates를 보낸 경우 제외)
    if (sanitized.price_tiers && !sanitized.price_dates) {
      sanitized.price_dates = tiersToDatePrices(sanitized.price_tiers as unknown as import('@/lib/parser').PriceTier[]);
    }
    if (typeof sanitized.status === 'string' && isCustomerVisibleStatus(sanitized.status)) {
      const sourceAuditBlock = await assertPackageSourceAuditAllowsPublication(packageId);
      if (sourceAuditBlock) return sourceAuditBlock;
    }

    const v3NoticePatchBlock = await assertPackageV3NoticePatchAllowed(packageId, sanitized);
    if (v3NoticePatchBlock) return v3NoticePatchBlock;

    // ─── Reflexion 자동 추적용: 변경 전 값 보존 ─────────────────────
    //   사장님 인라인 편집 = AI 정정 → extractions_corrections 자동 INSERT 로 영구 학습 자료化
    //   (Shinn et al. NeurIPS 2023 episodic memory 패턴)
    const REFLEXION_TRACKED_FIELDS = [
      'inclusions', 'excludes', 'notices_parsed', 'optional_tours',
      'product_summary', 'product_highlights',
      'itinerary_data', 'accommodations',
      'min_participants', 'ticketing_deadline', 'price',
      'surcharges', 'excluded_dates',
    ] as const;
    const trackedKeysChanged = (Object.keys(sanitized) as string[]).filter(k =>
      (REFLEXION_TRACKED_FIELDS as readonly string[]).includes(k)
    );
    let beforeSnapshot: Record<string, unknown> | null = null;
    let beforePkgMeta: { land_operator_id: string | null; destination: string | null; raw_text: string | null } | null = null;
    if (trackedKeysChanged.length > 0) {
      const { data: beforeRow } = await supabaseAdmin
        .from('travel_packages')
        .select(`id, land_operator_id, destination, raw_text, ${trackedKeysChanged.join(', ')}`)
        .eq('id', packageId)
        .single();
      if (beforeRow) {
        beforeSnapshot = beforeRow as unknown as Record<string, unknown>;
        beforePkgMeta = {
          land_operator_id: (beforeRow as unknown as { land_operator_id?: string | null }).land_operator_id ?? null,
          destination: (beforeRow as unknown as { destination?: string | null }).destination ?? null,
          raw_text: (beforeRow as unknown as { raw_text?: string | null }).raw_text ?? null,
        };
      }
    }

    const { data: result, error: updateErr } = await supabaseAdmin
      .from('travel_packages')
      .update(sanitized)
      .eq('id', packageId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    const resolvedPkgStatus = (result as { status?: string } | null)?.status;
    if (resolvedPkgStatus === 'archived' || resolvedPkgStatus === 'rejected') {
      try {
        const { skipBlogQueueForPackages } = await import('@/lib/blog-queue-lifecycle');
        await skipBlogQueueForPackages([packageId], `package_${resolvedPkgStatus}`);
      } catch (e) {
        logWarning('[api/packages] PATCH blog_topic_queue skip on status change', e);
      }
    }

    // ─── Reflexion 자동 INSERT (best-effort, 실패해도 PATCH 응답 막지 않음) ───
    if (beforeSnapshot && beforePkgMeta && trackedKeysChanged.length > 0) {
      try {
        // severity 자동 분류
        const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
          min_participants: 'critical',
          ticketing_deadline: 'critical',
          price: 'critical',
          inclusions: 'high',
          excludes: 'high',
          surcharges: 'high',
          excluded_dates: 'high',
          notices_parsed: 'high',
          itinerary_data: 'high',
          optional_tours: 'medium',
          accommodations: 'medium',
          product_summary: 'medium',
          product_highlights: 'low',
        };

        const correctionRows: Array<Record<string, unknown>> = [];
        for (const key of trackedKeysChanged) {
          const before = beforeSnapshot[key];
          const after = sanitized[key];
          // 동일 값 (deep) 이면 정정 아님
          if (JSON.stringify(before) === JSON.stringify(after)) continue;
          // 빈 → 빈 변형 무시
          if ((before === null || before === undefined) && (after === null || after === undefined)) continue;

          correctionRows.push({
            package_id: packageId,
            land_operator_id: beforePkgMeta.land_operator_id,
            destination: beforePkgMeta.destination,
            field_path: key,
            before_value: before ?? null,
            after_value: after ?? null,
            reflection: null, // 자동 추적은 reflection 텍스트 없음 — 사장님이 PATCH 로 추가 가능
            raw_text_excerpt: safeRawTextExcerpt(beforePkgMeta.raw_text),
            severity: SEVERITY_MAP[key] || 'medium',
            category: 'manual-correction',
            created_by: 'admin-inline-edit',
          });
        }

        if (correctionRows.length > 0) {
          const { error: corrErr } = await supabaseAdmin
            .from('extractions_corrections')
            .insert(correctionRows);
          if (corrErr) {
            logWarning('[api/packages] PATCH reflexion auto-track insert failed', corrErr);
          } else {
            console.log(`[Reflexion auto-track] ${correctionRows.length}건 정정 자동 적립 (package=${packageId})`);
          }
        }
      } catch (e) {
        logWarning('[api/packages] PATCH reflexion auto-track exception', e);
      }
    }

    // 품절/기간만료 상태 변경 시 연결된 Meta 광고 자동 일시정지
    const newStatus = updateData.status as string | undefined;
    if (newStatus === '품절' || newStatus === '기간만료') {
      // await 처리하여 서버리스 환경에서 프로세스가 조기 종료되지 않도록 안전 장치 적용
      await (async () => {
        try {
          const { getAdCampaigns, upsertCampaign } = await import('@/lib/supabase');
          const { pauseAd, isMetaConfigured } = await import('@/lib/meta-api');

          const activeCampaigns = await getAdCampaigns({ packageId, status: 'ACTIVE' });
          if (activeCampaigns.length === 0) return;

          await Promise.allSettled(
            activeCampaigns.map(async (campaign) => {
              try {
                if (isMetaConfigured() && campaign.meta_ad_id) {
                  await pauseAd(campaign.meta_ad_id);
                }
                await upsertCampaign({
                  id: campaign.id,
                  status: 'PAUSED',
                  auto_pause_reason: `패키지 상태: ${newStatus}`,
                });

                // audit_logs 기록 (RLS 대비: service_role 클라이언트)
                await supabaseAdmin.from('audit_logs').insert({
                  action: 'META_AUTO_PAUSE',
                  target_type: 'campaign',
                  target_id: campaign.id,
                  description: `패키지 ${newStatus} 상태 변경으로 인한 자동 일시정지`,
                  before_value: { status: 'ACTIVE' },
                  after_value: { status: 'PAUSED', reason: `패키지 상태: ${newStatus}` },
                });
              } catch (err) {
                logWarning('[api/packages] PATCH campaign auto-pause failed', err, { campaignId: campaign.id });
              }
            })
          );
        } catch (err) {
          logWarning('[api/packages] PATCH auto-pause campaign side-effect failed', err);
        }
      })();
    }

    revalidatePath(`/packages/${packageId}`);
    revalidatePath('/packages');
    revalidateLandingPagesForPackage(
      packageId,
      (result as { short_code?: string | null })?.short_code ?? null,
    );
    return successResponse({ package: result });
  } catch (error) {
    logError('[api/packages] PATCH update failed', error);
    return ApiErrors.internalError(error instanceof Error ? error.message : '처리 실패');
  }
}

// DELETE /api/packages?id=
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return ApiErrors.internalError('Supabase가 설정되지 않았습니다.');
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return ApiErrors.badRequest('id가 필요합니다.');

  try {
    await deletePackage(id);
    revalidateLandingPagesForPackage(id, null);
    return successResponse({ message: '삭제되었습니다.' });
  } catch (error) {
    logError('[api/packages] DELETE failed', error);
    return ApiErrors.internalError(error instanceof Error ? error.message : '삭제 실패');
  }
}
