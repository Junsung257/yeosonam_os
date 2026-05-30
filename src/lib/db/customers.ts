/**
 * 여소남 OS — 고객(customers) DB 계층
 *
 * customers 테이블 CRUD + 중복 검색 + 소프트 딜리트.
 * supabase.ts God Object 에서 분리한 모듈.
 */
import { supabaseAdmin } from '@/lib/supabase';

// ── 조회 ─────────────────────────────────────────────────────

/** 어드민 목록에서 쓰는 컬럼만 명시 — payload 축소. */
const CUSTOMER_LIST_COLUMNS = 'id, name, phone, email, passport_no, passport_expiry, birth_date, mileage, grade, status, total_spent, cafe_sync_data, tags, memo, created_at, deleted_at';

export async function getCustomers(opts: {
  search?: string; page?: number; limit?: number;
  sortBy?: 'name' | 'mileage' | 'created_at' | 'bookingCount' | 'totalSales';
  sortDir?: 'asc' | 'desc';
  trashed?: boolean;
  minSales?: number; maxSales?: number;
  minBookings?: number; maxBookings?: number;
  grade?: string;
  status?: string;
} = {}) {
  try {
    const { search, page = 1, limit = 30, sortBy = 'created_at', sortDir = 'desc', trashed = false, minSales, maxSales, minBookings, maxBookings, grade, status } = opts;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const isJsSort = sortBy === 'bookingCount' || sortBy === 'totalSales';
    let query = supabaseAdmin.from('customers').select(CUSTOMER_LIST_COLUMNS, { count: 'exact' });

    if (trashed) {
      query = query.not('deleted_at', 'is', null);
    } else {
      query = query.is('deleted_at', null);
    }

    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    if (grade)  query = query.eq('grade', grade);
    if (status) query = query.eq('status', status);

    if (!isJsSort) {
      query = query.order(sortBy, { ascending: sortDir === 'asc' });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    if (!isJsSort) query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const needsAllStats = isJsSort || minSales !== undefined || maxSales !== undefined
      || minBookings !== undefined || maxBookings !== undefined;
    const pageIds = (data || []).map((c: unknown) => (c as { id?: string }).id).filter(Boolean);
    let statsQuery = supabaseAdmin
      .from('customer_booking_stats')
      .select('customer_id, booking_count, total_sales');
    if (!needsAllStats && pageIds.length > 0) {
      statsQuery = statsQuery.in('customer_id', pageIds);
    }
    const { data: statsRows, error: statsErr } = await statsQuery;
    if (statsErr) {
      console.warn('[getCustomers] customer_booking_stats 조회 실패 — 통계 0 처리:', statsErr.message);
    }
    const statsMap = new Map<string, { count: number; totalSales: number }>();
    for (const row of statsRows || []) {
      const r = row as { customer_id: string; booking_count: number | string; total_sales: number | string };
      if (!r.customer_id) continue;
      statsMap.set(r.customer_id, {
        count: Number(r.booking_count),
        totalSales: Number(r.total_sales),
      });
    }

    let enriched = (data || []).map((c: unknown) => {
      const cust = c as Record<string, unknown>;
      return {
        ...cust,
        bookingCount: statsMap.get(cust.id as string)?.count || 0,
        totalSales: statsMap.get(cust.id as string)?.totalSales || 0,
      };
    });

    // 후처리 필터
    if (minSales !== undefined) enriched = enriched.filter((c: Record<string, unknown>) => (c.totalSales as number) >= minSales);
    if (maxSales !== undefined) enriched = enriched.filter((c: Record<string, unknown>) => (c.totalSales as number) <= maxSales);
    if (minBookings !== undefined) enriched = enriched.filter((c: Record<string, unknown>) => (c.bookingCount as number) >= minBookings);
    if (maxBookings !== undefined) enriched = enriched.filter((c: Record<string, unknown>) => (c.bookingCount as number) <= maxBookings);

    if (isJsSort) {
      enriched.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const va = (a[sortBy] ?? 0) as number;
        const vb = (b[sortBy] ?? 0) as number;
        return sortDir === 'asc' ? va - vb : vb - va;
      });
    }

    const totalCount = isJsSort || (minSales !== undefined || maxSales !== undefined || minBookings !== undefined || maxBookings !== undefined)
      ? enriched.length
      : (count || 0);

    const paginated = isJsSort ? enriched.slice(from, to + 1) : enriched;

    return { data: paginated, count: totalCount, totalPages: Math.ceil(totalCount / limit) };
  } catch (error) { console.error('고객 조회 실패:', error); return { data: [], count: 0, totalPages: 0 }; }
}

export async function getCustomerById(id: string) {
  try {
    const { data, error } = await supabaseAdmin.from('customers').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  } catch (error) { console.error('고객 단건 조회 실패:', error); return null; }
}

// ── 저장/업데이트 ─────────────────────────────────────────────

export async function upsertCustomer(data: Record<string, unknown>) {
  try {
    const NULLABLE = ['phone', 'email', 'passport_no', 'passport_expiry', 'birth_date', 'memo'];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(data)) {
      payload[k] = (NULLABLE.includes(k) && v === '') ? null : v;
    }
    if (payload.phone != null) {
      const digits = String(payload.phone).replace(/\D/g, '');
      payload.phone = digits.length === 11
        ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
        : null;
    }

    if (data.id) {
      const { data: result, error } = await supabaseAdmin
        .from('customers').update(payload).eq('id', data.id as string).select();
      if (error) throw error;
      return result?.[0];
    }

    const { data: result, error } = await supabaseAdmin
      .from('customers').insert([payload]).select();
    if (!error) return result?.[0];

    if ((error as { code?: string }).code === '23505' && payload.phone) {
      const { data: existing } = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('phone', payload.phone as string)
        .is('deleted_at', null)
        .limit(1);
      if (existing?.[0]) return existing[0];
    }
    throw error;
  } catch (error) { console.error('고객 저장 실패:', error); throw error; }
}

// ── 전화번호 기반 ────────────────────────────────────────────

export async function findOrCreateCustomerByPhone(
  rawPhone: string,
  name?: string,
): Promise<string | null> {
  const digits = (rawPhone ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return null;
  const dbPhone = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;

  const existing = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('phone', dbPhone)
    .limit(1);

  if (existing.data?.[0]?.id) return existing.data[0].id as string;

  const { data: inserted, error } = await supabaseAdmin
    .from('customers')
    .insert([{ phone: digits, name: name?.trim() || null }])
    .select('id')
    .limit(1);

  if (!error && inserted?.[0]?.id) return inserted[0].id as string;

  if ((error as { code?: string } | null)?.code === '23505') {
    const retry = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('phone', dbPhone)
      .limit(1);
    if (retry.data?.[0]?.id) return retry.data[0].id as string;
  }

  console.warn('[findOrCreateCustomerByPhone] 실패:', error);
  return null;
}

// ── 중복 검색 ────────────────────────────────────────────────

export async function findDuplicateCustomers(input: { name?: string; phone?: string }): Promise<{
  exact: { id: string; name: string; phone: string | null } | null;
  candidates: Array<{ id: string; name: string; phone: string | null; similarity: number }>;
}> {
  const { normalizePhone, normalizeName, nameSimilarity, NAME_MATCH_THRESHOLD } = await import('../customer-name');
  const rawPhone = input.phone?.trim() ?? null;
  const phone = normalizePhone(rawPhone);
  const name = input.name?.trim() ?? '';

  if (phone) {
    const phonesToSearch = Array.from(new Set([phone, ...(rawPhone && rawPhone !== phone ? [rawPhone] : [])]));
    const { data } = await supabaseAdmin
      .from('customers')
      .select('id, name, phone')
      .in('phone', phonesToSearch)
      .is('deleted_at', null)
      .limit(1);
    const row = data?.[0] as { id: string; name: string; phone: string | null } | undefined;
    if (row) return { exact: row, candidates: [] };
  }

  if (!name) return { exact: null, candidates: [] };
  const key = normalizeName(name).slice(0, 2);
  if (!key) return { exact: null, candidates: [] };

  const { data } = await supabaseAdmin
    .from('customers')
    .select('id, name, phone')
    .ilike('name', `${key}%`)
    .is('deleted_at', null)
    .limit(50);

  const candidates = ((data ?? []) as Array<{ id: string; name: string; phone: string | null }>)
    .map(c => ({ ...c, similarity: nameSimilarity(name, c.name ?? '') }))
    .filter(c => c.similarity >= NAME_MATCH_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);

  return { exact: null, candidates };
}

// ── 소프트 딜리트 ────────────────────────────────────────────

export async function deleteCustomer(id: string) {
  const { error } = await supabaseAdmin.from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function restoreCustomer(id: string) {
  const { error } = await supabaseAdmin.from('customers').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
}
