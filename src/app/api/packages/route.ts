import { NextRequest, NextResponse } from 'next/server';
import {
  getPackageById,
  saveTravelPackage,
  updatePackage,
  deletePackage,
  approvePackage,
  isSupabaseConfigured,
  supabase,
  supabaseAdmin,
} from '@/lib/supabase';

// ── 상품 목록 JOIN 필드 (products ERP 데이터 포함) ─────────────────────────
const PACKAGE_LIST_FIELDS = `
  id, title, destination, category, product_type, trip_style,
  departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_list, status, confidence, created_at,
  inclusions, excludes, guide_tip, single_supplement, small_group_surcharge,
  optional_tours, itinerary, special_notes, notices_parsed, land_operator, commission_rate,
  product_tags, product_highlights, product_summary, itinerary_data,
  marketing_copies, internal_code, land_operator_id,
  products(internal_code, departure_region, net_price, selling_price, margin_rate)
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
  const q        = (searchParams.get('q') || searchParams.get('destination') || '').trim();
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit    = Math.min(200, parseInt(searchParams.get('limit') || '100'));
  const from     = (page - 1) * limit;

  try {
    // 단건 조회 — supabaseAdmin으로 RLS 우회 (raw_text 포함)
    if (id) {
      const { data: pkg, error: pkgErr } = await supabaseAdmin
        .from('travel_packages')
        .select('*')
        .eq('id', id)
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

    // 검색: title OR internal_code (departure_region은 JS-side 후필터)
    if (q) {
      query = query.or(`title.ilike.%${q}%,internal_code.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // departure_region 검색은 JS-side (products JOIN 결과 기반)
    const filtered = q
      ? (data ?? []).filter((pkg: Record<string, unknown>) => {
          const prod = pkg.products as { departure_region?: string } | null;
          if (prod?.departure_region?.includes(q)) return true;
          // title/internal_code는 이미 DB 필터됨
          return true;
        })
      : (data ?? []);

    const totalPages = Math.ceil((count ?? 0) / limit);
    return NextResponse.json({ data: filtered, count: count ?? 0, totalPages });
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

    const result = await saveTravelPackage({
      title: body.title,
      destination: body.destination,
      duration: body.duration,
      price: body.price,
      filename: body.filename || 'manual',
      fileType: body.fileType || 'pdf',
      rawText: body.rawText || body.raw_text || '',
      itinerary: body.itinerary,
      inclusions: body.inclusions,
      excludes: body.excludes,
      accommodations: body.accommodations,
      specialNotes: body.specialNotes || body.special_notes,
      confidence: body.confidence || 0,
      category: body.category,
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
      surcharges: body.surcharges,
      excluded_dates: body.excluded_dates,
      optional_tours: body.optional_tours,
      cancellation_policy: body.cancellation_policy,
      category_attrs: body.category_attrs,
    });

    return NextResponse.json({ success: true, package: result }, { status: 201 });
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
      const { error } = await supabase
        .from('travel_packages')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    // 일괄 비활성화
    if (action === 'bulk_inactive') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
      }
      const { error } = await supabase
        .from('travel_packages')
        .update({ status: 'INACTIVE', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    // 일괄 활성화
    if (action === 'bulk_active') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
      }
      const { error } = await supabase
        .from('travel_packages')
        .update({ status: 'DRAFT', updated_at: new Date().toISOString() })
        .in('id', packageIds);
      if (error) throw error;
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    // 일괄 삭제 (연관 document_hashes도 함께 삭제 → 재업로드 가능)
    if (action === 'bulk_delete') {
      const { packageIds } = body;
      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return NextResponse.json({ error: 'packageIds 배열이 필요합니다.' }, { status: 400 });
      }
      // internal_code 조회 → document_hashes 삭제
      const { data: pkgs } = await supabaseAdmin
        .from('travel_packages')
        .select('internal_code')
        .in('id', packageIds);
      const codes = (pkgs || []).map((p: { internal_code?: string }) => p.internal_code).filter(Boolean) as string[];
      if (codes.length > 0) {
        await supabaseAdmin.from('document_hashes').delete().in('product_id', codes);
      }
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .delete()
        .in('id', packageIds);
      if (error) throw error;
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
      const { error } = await supabase
        .from('travel_packages')
        .update(updateData)
        .in('id', packageIds);
      if (error) throw error;
      return NextResponse.json({ success: true, count: packageIds.length });
    }

    if (!packageId) {
      return NextResponse.json({ error: 'packageId가 필요합니다.' }, { status: 400 });
    }

    // 단건 상태 변경
    if (action === 'approve') {
      const result = await approvePackage(packageId);
      return NextResponse.json({ success: true, package: result });
    }

    if (action === 'reject') {
      const { data, error } = await supabase
        .from('travel_packages')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', packageId)
        .select();
      if (error) throw error;
      return NextResponse.json({ success: true, package: data?.[0] });
    }

    // 필드 업데이트 — supabaseAdmin으로 RLS 우회 (anon 클라이언트는 travel_packages RLS에 차단됨)
    const { data: result, error: updateErr } = await supabaseAdmin
      .from('travel_packages')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', packageId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // 품절/기간만료 상태 변경 시 연결된 Meta 광고 자동 일시정지
    const newStatus = updateData.status as string | undefined;
    if (newStatus === '품절' || newStatus === '기간만료') {
      // fire-and-forget: Meta API 실패가 패키지 업데이트를 롤백하지 않도록 Promise.allSettled 사용
      (async () => {
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
