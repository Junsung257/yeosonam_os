import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  getPackageById,
  saveTravelPackage,
  updatePackage,
  deletePackage,
  approvePackage,
  isSupabaseConfigured,
  supabaseAdmin,
} from '@/lib/supabase';
import {
  runSanitizePipeline,
  buildFullTextForValidation,
} from '@/lib/text-sanitizer';
import { tiersToDatePrices } from '@/lib/price-dates';
import { embedText } from '@/lib/embeddings';

// ── 상품코드 자동생성 매핑 ──────────────────────────────────────
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
// country, nights, accommodations도 함께 포함 (렌더링에 필요)
const PACKAGE_LIST_FIELDS = `
  id, title, destination, country, category, product_type, trip_style,
  departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_dates, price_list, excluded_dates, confirmed_dates, status, confidence, created_at,
  inclusions, excludes, guide_tip, single_supplement, small_group_surcharge, surcharges,
  optional_tours, itinerary, special_notes, notices_parsed, land_operator, commission_rate,
  product_tags, product_highlights, product_summary, itinerary_data,
  marketing_copies, internal_code, short_code, land_operator_id, is_airtel, display_title,
  seats_held, seats_confirmed, nights, accommodations,
  products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)
`;

// GET /api/packages?status=&category=&destination=&q=&page=&limit=&id=
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ packages: [], data: [], count: 0, totalPages: 0 });
  }

  const { searchParams } = new URL(request.url);
  const id       = searchParams.get('id');
  const status   = searchParams.get('status') || undefined;
  const category = searchParams.get('category') || undefined;
  const q        = (searchParams.get('q') || '').trim();
  const destFilter = searchParams.get('destination') || '';
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit    = Math.min(500, parseInt(searchParams.get('limit') || '100'));
  const from     = (page - 1) * limit;

  try {
    // 목적지별 집계 — 홈페이지용
    const aggregate = searchParams.get('aggregate');
    if (aggregate === 'destination') {
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
          const pdPrices = (p.price_dates as any[]).map((d: any) => d.price).filter(Boolean);
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

      return NextResponse.json({ destinations });
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
      if (pkgErr || !pkg) return NextResponse.json({ error: '패키지를 찾을 수 없습니다.' }, { status: 404 });
      return NextResponse.json({ package: pkg });
    }

    // 목록 조회 — products JOIN 포함
    let query = supabaseAdmin
      .from('travel_packages')
      .select(PACKAGE_LIST_FIELDS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (status && status !== 'all') query = query.eq('status', status);
    if (category)                   query = query.eq('category', category);
    if (destFilter)                 query = query.eq('destination', destFilter);

    // 검색: title OR internal_code (departure_region은 JS-side 후필터)
    if (q) {
      query = query.or(`title.ilike.%${q}%,internal_code.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const totalPages = Math.ceil((count ?? 0) / limit);
    return NextResponse.json({ data: data ?? [], count: count ?? 0, totalPages }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('패키지 조회 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '조회 실패' }, { status: 500 });
  }
}

// POST /api/packages - 새 상품 저장
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json({ error: '상품명(title)이 필요합니다.' }, { status: 400 });
    }

    // ── ACL 정규화 → Zod 검증 (STRICT_VALIDATION=true일 때만 강제) ──
    // 평상시: warning으로 유지 (기존 호환). STRICT 모드: 실패 시 draft 또는 400 반환.
    if (process.env.STRICT_VALIDATION === 'true') {
      try {
        // 동적 import로 bundle 영향 최소화
        const { normalizePackage } = await import('@/lib/package-acl');
        const { validatePackageLoose, formatZodErrors } = await import('@/lib/package-schema');
        const normalized = normalizePackage(body);
        const result = validatePackageLoose(normalized);
        if (!result.success && result.errors) {
          const errMsgs = formatZodErrors(result.errors);
          if (process.env.ALLOW_DRAFT === 'true') {
            // draft로 저장하고 에러는 validation_errors 필드에 기록
            body.status = 'draft';
            body.validation_errors = errMsgs;
          } else {
            return NextResponse.json({
              error: 'Zod 검증 실패',
              issues: errMsgs,
            }, { status: 400 });
          }
        }
      } catch (e) {
        console.warn('[POST /api/packages] Zod validation 스킵:', e instanceof Error ? e.message : e);
      }
    }

    // ── Phase 3-D: 임베딩 기반 중복 감지 ──
    // ?force=true 쿼리로 우회 가능 (VA가 "새 상품으로 등록" 선택 시)
    const { searchParams: postParams } = new URL(request.url);
    const forceDuplicate = postParams.get('force') === 'true';
    if (!forceDuplicate && supabaseAdmin && process.env.GOOGLE_AI_API_KEY) {
      try {
        const embedSource = [
          body.title,
          body.destination ?? '',
          typeof body.duration === 'number' ? `${body.duration}일` : '',
          body.land_operator ?? '',
          (body.rawText ?? body.raw_text ?? '').slice(0, 1000),
        ].filter(Boolean).join(' ');

        const vec = await embedText(embedSource, process.env.GOOGLE_AI_API_KEY, 'SEMANTIC_SIMILARITY');
        if (vec && vec.length > 0) {
          const { data: similar, error: simErr } = await supabaseAdmin.rpc('match_travel_packages_duplicate', {
            query_embedding: vec,
            match_threshold: 0.95,
            match_count: 3,
            exclude_id: null,
          });
          if (!simErr && Array.isArray(similar) && similar.length > 0) {
            return NextResponse.json({
              warning: 'duplicate_suspected',
              message: `유사한 상품이 ${similar.length}건 감지됨. 새 상품으로 등록하려면 ?force=true 추가`,
              similar_products: similar,
            }, { status: 409 });
          }
        }
      } catch (e) {
        console.warn('[packages] 중복 감지 실패 (무시하고 진행):', e);
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
    let landOperatorId = body.land_operator_id || null;
    if (!landOperatorId && body.land_operator && supabaseAdmin) {
      const { data: opData } = await supabaseAdmin
        .from('land_operators')
        .select('id')
        .eq('name', body.land_operator)
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
          console.warn(`[Sanitizer] ${body.title}: ${sanitizeWarnings.length}건 경고`, sanitizeWarnings.map(w => w.rule));
        }
      } catch (e) {
        console.error('[Sanitizer] 정제 실패 (무시하고 진행):', e);
      }
    }

    // ── price_tiers → price_dates 자동 변환 (없으면 생성) ──
    const priceDates = body.price_dates?.length
      ? body.price_dates
      : body.price_tiers?.length
        ? tiersToDatePrices(body.price_tiers)
        : [];

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
        await supabaseAdmin.from('travel_packages').update(patch).eq('id', result.id);
      }
    }

    return NextResponse.json({
      success: true,
      package: { ...result, short_code: shortCode, internal_code: internalCode, land_operator_id: landOperatorId },
      sanitize: {
        corrections: sanitizeCorrections,
        warnings: sanitizeWarnings,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('패키지 저장 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '저장 실패' }, { status: 500 });
  }
}

// PATCH /api/packages - 상품 수정 또는 상태 변경
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { packageId, action, ...updateData } = body;

    // 일괄 승인
    if (action === 'bulk_approve') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
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
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    // 일괄 아카이브 (소프트 삭제 — 데이터 보존, 고객 노출 안 됨)
    if (action === 'bulk_archive' || action === 'bulk_delete' || action === 'bulk_inactive') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
      }
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    // 아카이브 복원 → 검토 대기로
    if (action === 'bulk_restore' || action === 'bulk_active') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
      }
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    // 일괄 필드 업데이트 (랜드사, 커미션 등)
    if (action === 'bulk_update') {
      const { packageIds, fields } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
      }
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (fields.land_operator !== undefined) updateData.land_operator = fields.land_operator;
      if (fields.commission_rate !== undefined) updateData.commission_rate = Number(fields.commission_rate);
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update(updateData)
        .in('id', packageIds);
      if (error) throw error;
      for (const pid of packageIds) revalidatePath(`/packages/${pid}`);
      revalidatePath('/packages');
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    if (!packageId) {
      return NextResponse.json({ error: 'packageId가 필요합니다.' }, { status: 400 });
    }

    // 단건 상태 변경
    if (action === 'approve') {
      const result = await approvePackage(packageId);
      // Option B: 승인 시 visual baseline 재생성 큐 등록
      await supabaseAdmin
        .from('travel_packages')
        .update({ baseline_requested_at: new Date().toISOString() })
        .eq('id', packageId);
      revalidatePath(`/packages/${packageId}`);
      revalidatePath('/packages');
      return NextResponse.json({ success: true, package: result });
    }

    if (action === 'reject') {
      const { data, error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', packageId)
        .select();
      if (error) throw error;
      revalidatePath(`/packages/${packageId}`);
      revalidatePath('/packages');
      return NextResponse.json({ success: true, package: data?.[0] });
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
      'inclusions', 'excludes', 'special_notes', 'notices_parsed',
      'itinerary', 'itinerary_data', 'raw_text',
      'land_operator', 'land_operator_id', 'commission_rate',
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
      sanitized.price_dates = tiersToDatePrices(sanitized.price_tiers as any[]);
    }

    const { data: result, error: updateErr } = await supabaseAdmin
      .from('travel_packages')
      .update(sanitized)
      .eq('id', packageId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // 품절/기간만료 상태 변경 시 연결된 Meta 광고 자동 일시정지
    const newStatus = updateData.status as string | undefined;
    if (newStatus === '품절' || newStatus === '기간만료') {
      // await 처리하여 서버리스 환경에서 프로세스가 조기 종료되지 않도록 안전 장치 적용
      await (async () => {
        try {
          const { getAdCampaigns, upsertCampaign } = await import('@/lib/supabase');
          const { pauseAd, isMetaConfigured } = await import('@/lib/meta-api');
          const { createClient } = await import('@supabase/supabase-js');

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

                // audit_logs 기록
                const sb = createClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
                );
                await sb.from('audit_logs').insert({
                  action: 'META_AUTO_PAUSE',
                  target_type: 'campaign',
                  target_id: campaign.id,
                  description: `패키지 ${newStatus} 상태 변경으로 인한 자동 일시정지`,
                  before_value: { status: 'ACTIVE' },
                  after_value: { status: 'PAUSED', reason: `패키지 상태: ${newStatus}` },
                });
              } catch (err) {
                console.warn(`캠페인 ${campaign.id} 자동 일시정지 실패:`, err);
              }
            })
          );
        } catch (err) {
          console.warn('품절/기간만료 자동 일시정지 사이드이펙트 실패:', err);
        }
      })();
    }

    revalidatePath(`/packages/${packageId}`);
    revalidatePath('/packages');
    return NextResponse.json({ success: true, package: result });
  } catch (error) {
    console.error('패키지 수정 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '처리 실패' }, { status: 500 });
  }
}

// DELETE /api/packages?id=
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  try {
    await deletePackage(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('패키지 삭제 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '삭제 실패' }, { status: 500 });
  }
}
