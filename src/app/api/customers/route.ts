import { NextRequest, NextResponse } from 'next/server';
import { cacheHeader } from '@/lib/api-response';
import { getCustomers, getCustomerById, upsertCustomer, deleteCustomer, restoreCustomer, findDuplicateCustomers, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/customer-name';
import { escapePostgrestFilterValue } from '@/lib/supabase-filter-safe';
import { isAdminRequest } from '@/lib/admin-guard';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const id    = searchParams.get('id');
  const phone = searchParams.get('phone');

  // 전화번호 중복 확인 (신규 등록 폼 실시간 체크용 — public)
  if (phone) {
    const safePhone = escapePostgrestFilterValue(phone);
    const normalized = phone.replace(/[^0-9]/g, '');
    if (!safePhone && !normalized) {
      return NextResponse.json({ customers: [] });
    }
    const { data } = await supabaseAdmin
      .from('customers')
      .select('id, name, phone, grade, mileage')
      .or(`phone.eq.${safePhone || normalized},phone.eq.${normalized}`)
      .is('deleted_at', null)
      .limit(1);
    return NextResponse.json({ customers: data || [] }, { headers: cacheHeader(60) });
  }

  // 상세 조회 + 목록 조회 — admin only
  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(
      { error: '관리자 권한이 필요합니다' },
      { status: 401 }
    );
  }

  if (id) {
    const customer = await getCustomerById(id);
    return NextResponse.json({ customer }, { headers: cacheHeader(60) });
  }

  const page        = parseInt(searchParams.get('page') || '1');
  const limit       = parseInt(searchParams.get('limit') || '30');
  const search      = searchParams.get('search') || undefined;
  const sortBy      = (searchParams.get('sortBy') || 'created_at') as 'name' | 'mileage' | 'created_at' | 'bookingCount' | 'totalSales';
  const sortDir     = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const trashed     = searchParams.get('trashed') === 'true';
  const minSales    = searchParams.get('minSales')    ? parseInt(searchParams.get('minSales')!)    : undefined;
  const maxSales    = searchParams.get('maxSales')    ? parseInt(searchParams.get('maxSales')!)    : undefined;
  const minBookings = searchParams.get('minBookings') ? parseInt(searchParams.get('minBookings')!) : undefined;
  const maxBookings = searchParams.get('maxBookings') ? parseInt(searchParams.get('maxBookings')!) : undefined;
  const grade       = searchParams.get('grade') || undefined;
  const status      = searchParams.get('status') || undefined;

  const result = await getCustomers({ search, page, limit, sortBy, sortDir, trashed, minSales, maxSales, minBookings, maxBookings, grade, status });
  return NextResponse.json({ customers: result.data, count: result.count, totalPages: result.totalPages, page }, { headers: cacheHeader(60) });
}

export async function POST(request: NextRequest) {
  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(
      { error: '관리자 권한이 필요합니다' },
      { status: 401 }
    );
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const body = await request.json();

    if (body.action === 'restore') {
      if (!body.id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
      await restoreCustomer(body.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'bulk_tag') {
      // 감사(2026-05-11): 기존 N+1 (SELECT+UPDATE × N) → 단일 RPC 1 round-trip.
      // 마이그레이션: 20260518010000_admin_perf_customers_bulk_rpcs.sql
      const { ids, tag } = body as { ids: string[]; tag: string };
      if (!ids?.length || !tag) return NextResponse.json({ error: 'ids, tag 필요' }, { status: 400 });
      const { data: updated, error } = await supabaseAdmin.rpc('merge_customer_tags', {
        p_ids: ids,
        p_tag: tag,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, updated: updated ?? 0 });
    }

    if (body.action === 'bulk_field') {
      // 동일 필드 일괄 변경 (예: 마일리지 리셋). 클라이언트 N PATCH → 1 UPDATE.
      const { ids, field, value } = body as { ids: string[]; field: string; value: unknown };
      const allowed = ['mileage', 'grade', 'status'];
      if (!ids?.length) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
      if (!allowed.includes(field)) return NextResponse.json({ error: '허용되지 않은 필드' }, { status: 400 });
      const { error } = await supabaseAdmin
        .from('customers')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, updated: ids.length });
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '고객 이름이 필요합니다.' }, { status: 400 });
    }

    // ── 중복 감지 (신규 생성 시에만 — body.id 없을 때) ──────────────────────
    // skipDedup: true 시 스킵 (병합 승인 후 강제 신규 생성 등 예외 경로)
    if (!body.id && !body.skipDedup) {
      // rawPhone 원본(대시 포함 가능) 그대로 전달 → findDuplicateCustomers 내부에서 양쪽 형식 모두 검색
      const dup = await findDuplicateCustomers({ name: body.name, phone: body.phone ?? undefined });

      // 전화번호 정확 일치 → 기존 고객 재사용 (자동 병합)
      if (dup.exact) {
        return NextResponse.json({
          customer: dup.exact,
          reused: true,
          reason: 'phone_exact_match',
        });
      }

      // 이름 후보 존재 + dryRun 요청 → 후보만 반환 (사용자 결정 대기)
      if (dup.candidates.length > 0 && body.dryRun) {
        return NextResponse.json({
          customer: null,
          duplicates: dup.candidates,
          reason: 'name_candidates',
        });
      }
    }

    // 전화번호 정규화 (11자리만 저장, 아니면 null)
    if (body.phone !== undefined) {
      body.phone = normalizePhone(body.phone);
    }

    const customer = await upsertCustomer(body);
    return NextResponse.json({ customer });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '고객 저장 실패' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    // 단일 필드 인라인 편집 (기존 호환)
    if (body.field !== undefined) {
      const allowed = ['name', 'phone', 'email', 'passport_no', 'passport_expiry',
                       'tags', 'memo', 'mileage', 'status', 'grade', 'cafe_sync_data'];
      if (!allowed.includes(body.field))
        return NextResponse.json({ error: '허용되지 않은 필드' }, { status: 400 });
      const customer = await upsertCustomer({ id, [body.field]: body.value });
      return NextResponse.json({ customer });
    }

    // 다중 필드 업데이트 (사이드 드로어 저장)
    const ALLOWED = ['name', 'phone', 'email', 'passport_no', 'passport_expiry',
                     'birth_date', 'tags', 'memo', 'mileage', 'status',
                     'grade', 'cafe_sync_data', 'total_spent'];
    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED) {
      if (field in body) updates[field] = body[field];
    }
    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });

    const customer = await upsertCustomer({ id, ...updates });
    return NextResponse.json({ customer });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '수정 실패' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (id) {
      await deleteCustomer(id);
      return NextResponse.json({ ok: true });
    }
    const body = await request.json();
    const ids: string[] = body.ids || [];
    if (!ids.length) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
    for (const cid of ids) await deleteCustomer(cid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '삭제 실패' },
      { status: 500 }
    );
  }
}
