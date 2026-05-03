import { createClient } from '@supabase/supabase-js';
import type { CartItem } from './db/concierge';

/** 목록·검색·자비스 도구 공통 — select('*') 대비 페이로드 절감 */
const PACKAGE_LIST_SELECT = `
  id, title, destination, category, product_type, trip_style,
  departure_days, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_dates, excluded_dates, status, confidence, created_at,
  duration, nights,
  inclusions, excludes, guide_tip, single_supplement,
  small_group_surcharge, optional_tours, itinerary, special_notes,
  land_operator, product_tags, product_highlights, product_summary,
  audit_status, internal_code
`.replace(/\s+/g, ' ').trim();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isValidUrl(url?: string) {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

export const isSupabaseConfigured = Boolean(
  isValidUrl(supabaseUrl) && supabaseKey && !supabaseUrl?.includes('your_supabase_url')
);

// Lazy initialization - 사용할 때만 클라이언트 생성
let supabaseClient: ReturnType<typeof createClient> | null = null;

/**
 * 익명 키 기반 Supabase 클라이언트 (lazy init).
 * 환경 미설정 시 null. 도메인 분할 모듈(db/*)에서 직접 사용 가능하도록 export.
 */
export function getSupabase() {
  if (!supabaseClient) {
    if (!isSupabaseConfigured) {
      // 환경변수가 올바르게 설정되지 않으면 클라이언트 생성 안 함
      return null;
    }
    try {
      supabaseClient = createClient(supabaseUrl!, supabaseKey!);
    } catch (e) {
      console.warn('Supabase 클라이언트 생성 중 예외:', e);
      supabaseClient = null;
    }
  }
  return supabaseClient;
}

// 서버 전용 Admin 클라이언트 (service role key → RLS 우회)
// API 라우트에서 DB 직접 조작 시 사용
let supabaseAdminClient: ReturnType<typeof createClient> | null = null;

/**
 * 서비스 롤 키 기반 Admin 클라이언트 (lazy init).
 * 환경 미설정 시 anon 클라이언트로 fallback. 도메인 분할 모듈(db/*)에서 직접 사용 가능하도록 export.
 */
export function getSupabaseAdmin() {
  if (!supabaseAdminClient) {
    if (!isValidUrl(supabaseUrl)) return getSupabase(); // fallback
    const key = supabaseServiceKey || supabaseKey;
    if (!key) return getSupabase();
    try {
      supabaseAdminClient = createClient(supabaseUrl!, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch {
      return getSupabase();
    }
  }
  return supabaseAdminClient;
}

export const supabaseAdmin = {
  from: (table: string) => {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase가 구성되지 않았습니다.');
    return client.from(table);
  },
  rpc: (fn: string, args?: Record<string, unknown>) => {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase가 구성되지 않았습니다.');
    return (client as any).rpc(fn, args);
  },
  // Storage 프록시 — 매번 client 조회 후 storage 속성 반환
  // (V1 render / V2 render-v2 / 기타 모든 업로드 경로가 이걸 쓴다)
  get storage() {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase가 구성되지 않았습니다.');
    return (client as any).storage;
  },
  // Auth 프록시 (관리자 API: 사용자 생성/초대 등)
  get auth() {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase가 구성되지 않았습니다.');
    return (client as any).auth;
  },
} as any;

// Auth 전용 - 실제 클라이언트 인스턴스 반환 (login 페이지에서 사용)
export function getSupabaseClient() {
  const client = getSupabase();
  if (!client) throw new Error('Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요.');
  return client;
}

// 이전 호환성을 위한 getter
export const supabase = {
  from: (table: string) => {
    const client = getSupabase();
    if (!client) {
      throw new Error('Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요.');
    }
    return client.from(table);
  },
} as any;

// 여행 상품 저장 (v2 - 신규 컬럼 포함)
export async function saveTravelPackage(data: {
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  filename: string;
  fileType: 'pdf' | 'image' | 'hwp';
  rawText: string;
  itinerary?: string[];
  inclusions?: string[];
  excludes?: string[];
  accommodations?: string[];
  specialNotes?: string;
  confidence: number;
  // v2 신규 필드
  category?: string;
  product_type?: string;
  trip_style?: string;
  departure_days?: string;
  departure_airport?: string;
  airline?: string;
  min_participants?: number;
  ticketing_deadline?: string;
  guide_tip?: string;
  single_supplement?: string;
  small_group_surcharge?: string;
  price_tiers?: unknown[];
  surcharges?: unknown[];
  excluded_dates?: string[];
  optional_tours?: unknown[];
  cancellation_policy?: unknown[];
  category_attrs?: Record<string, unknown>;
  // v3 신규 필드
  land_operator?: string;
  product_tags?: string[];
  product_highlights?: string[];
  product_summary?: string;
  commission_rate?: number; // 랜드사 커미션율 (예: 10.0 = 10%)
  itinerary_data?: unknown;  // 고객용 일정표 JSON (TravelItinerary)
  notices_parsed?: unknown[]; // 4카테고리 분류 주의사항
  price_list?: unknown[];     // 다중 조건 구조화 가격표
  price_dates?: unknown[];    // 날짜별 개별 가격 (tiersToDatePrices 결과)
}) {
  try {
    const { data: result, error } = await supabaseAdmin
      .from('travel_packages')
      .insert([{
        title: data.title,
        destination: data.destination,
        duration: data.duration,
        price: data.price,
        filename: data.filename,
        file_type: data.fileType,
        raw_text: data.rawText,
        itinerary: data.itinerary || [],
        inclusions: data.inclusions || [],
        excludes: data.excludes || [],
        accommodations: data.accommodations || [],
        special_notes: data.specialNotes,
        confidence: data.confidence,
        status: 'pending',
        // v2
        category: data.category || 'package',
        product_type: data.product_type,
        trip_style: data.trip_style,
        departure_days: data.departure_days,
        departure_airport: data.departure_airport || '부산(김해)',
        airline: data.airline,
        min_participants: data.min_participants || 4,
        ticketing_deadline: data.ticketing_deadline || null,
        guide_tip: data.guide_tip,
        single_supplement: data.single_supplement,
        small_group_surcharge: data.small_group_surcharge,
        price_tiers: data.price_tiers || [],
        surcharges: data.surcharges || [],
        excluded_dates: data.excluded_dates || [],
        optional_tours: data.optional_tours || [],
        cancellation_policy: data.cancellation_policy || [],
        category_attrs: data.category_attrs || {},
        land_operator: data.land_operator || null,
        product_tags: data.product_tags || [],
        product_highlights: data.product_highlights || [],
        product_summary: data.product_summary || null,
        commission_rate: data.commission_rate ?? null,
        itinerary_data: data.itinerary_data ?? null,
        notices_parsed: data.notices_parsed ?? [],
        price_list: data.price_list ?? [],
        price_dates: data.price_dates ?? [],
      }])
      .select();

    if (error) throw error;
    return result?.[0];
  } catch (error) {
    console.error('여행 상품 저장 실패:', error);
    throw new Error(`여행 상품 저장 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// 여행 상품 수정
export async function updatePackage(id: string, data: Record<string, unknown>) {
  try {
    const { data: result, error } = await supabase
      .from('travel_packages')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    if (error) throw error;
    return result?.[0];
  } catch (error) {
    console.error('상품 수정 실패:', error);
    throw error;
  }
}

// 여행 상품 삭제 (연관 document_hashes도 함께 삭제 → 재업로드 가능)
export async function deletePackage(id: string) {
  try {
    // 1) 해당 상품의 internal_code 조회
    const { data: pkg } = await supabaseAdmin.from('travel_packages').select('internal_code').eq('id', id).maybeSingle();
    // 2) document_hashes에서 해당 product_id(internal_code) 삭제
    if (pkg?.internal_code) {
      await supabaseAdmin.from('document_hashes').delete().eq('product_id', pkg.internal_code);
    }
    // 3) 상품 삭제
    const { error } = await supabaseAdmin.from('travel_packages').delete().eq('id', id);
    if (error) throw error;
  } catch (error) {
    console.error('상품 삭제 실패:', error);
    throw error;
  }
}

// 상품 목록 조회 (필터 지원)
export async function getPackages(filters?: {
  status?: string;
  category?: string;
  destination?: string;
  page?: number;
  limit?: number;
}) {
  try {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const from = (page - 1) * limit;

    let query = supabase
      .from('travel_packages')
      .select(PACKAGE_LIST_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters?.category) query = query.eq('category', filters.category);
    if (filters?.destination) query = query.ilike('destination', `%${filters.destination}%`);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], count: count || 0, totalPages: Math.ceil((count || 0) / limit) };
  } catch (error) {
    console.error('상품 목록 조회 실패:', error);
    return { data: [], count: 0, totalPages: 0 };
  }
}

// god module 분할 — 순수 유틸은 @/lib/package-pricing 으로 이전.
// 기존 import 호환을 위해 re-export 유지.
export { getPriceTierForDate, getSurchargesForDate } from './package-pricing';

// 여행 상품 조회 (승인된 것만, 감사 차단 제외)
// audit_status === 'blocked'인 상품은 어드민이 승인하려 해도 API에서 차단되지만
// 혹시 우회 경로로 들어가더라도 고객에게는 절대 노출되지 않도록 이중 가드.
export async function getApprovedPackages(destination?: string, keyword?: string) {
  try {
    let query = supabase
      .from('travel_packages')
      .select(PACKAGE_LIST_SELECT)
      .eq('status', 'approved')
      .or('audit_status.is.null,audit_status.neq.blocked')
      .order('created_at', { ascending: false });

    if (destination) {
      query = query.ilike('destination', `%${destination}%`);
    }
    if (keyword) {
      query = query.or(
        `title.ilike.%${keyword}%,destination.ilike.%${keyword}%,product_summary.ilike.%${keyword}%,product_tags.cs.{${keyword}}`
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('여행 상품 조회 실패:', error);
    return [];
  }
}

// 승인 대기 중인 상품 조회
export async function getPendingPackages() {
  try {
    const { data, error } = await supabase
      .from('travel_packages')
      .select(PACKAGE_LIST_SELECT)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('승인 대기 상품 조회 실패:', error);
    return [];
  }
}

// 특정 상품 승인
export async function approvePackage(packageId: string) {
  try {
    const { data, error } = await supabase
      .from('travel_packages')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', packageId)
      .select();

    if (error) {
      throw error;
    }

    return data?.[0];
  } catch (error) {
    console.error('상품 승인 실패:', error);
    throw error;
  }
}

// Q&A Inquiry / AI Response — 본문은 ./db/inquiry.ts 로 분리
export { saveInquiry, getInquiries, saveAIResponse } from './db/inquiry';

// god module 분할 — applyCommission 은 @/lib/package-pricing 로 이전.
export { applyCommission } from './package-pricing';

// 특정 패키지 단건 조회
export async function getPackageById(id: string) {
  try {
    const { data, error } = await supabase
      .from('travel_packages')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('패키지 단건 조회 실패:', error);
    return null;
  }
}

// 마진 계산
export async function calculateMargin(packageId: string, customerType: 'vip' | 'regular' | 'bulk') {
  try {
    const { data: marginData, error: marginError } = await supabase
      .from('margin_settings')
      .select('*')
      .eq('package_id', packageId)
      .single();

    if (marginError) {
      console.warn('마진 설정 없음:', marginError);
      return null;
    }

    const { data: packageData, error: packageError } = await supabase
      .from('travel_packages')
      .select('price')
      .eq('id', packageId)
      .single();

    if (packageError || !packageData) {
      throw packageError;
    }

    const marginPercent =
      customerType === 'vip'
        ? marginData.vip_margin_percent
        : customerType === 'bulk'
          ? marginData.bulk_margin_percent
          : marginData.regular_margin_percent;

    const marginAmount = (packageData.price * marginPercent) / 100;
    const sellingPrice = packageData.price + marginAmount;

    return {
      basePrice: packageData.price,
      marginPercent,
      marginAmount: Math.round(marginAmount),
      sellingPrice: Math.round(sellingPrice),
    };
  } catch (error) {
    console.error('마진 계산 실패:', error);
    throw error;
  }
}

// ─── CRM 함수 ───────────────────────────────────────────

// 고객 목록 조회 (페이지네이션 + 정렬 + 필터 + 소프트딜리트 지원)
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
    let query = supabaseAdmin.from('customers').select('*', { count: 'exact' });

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

    const { data: statsRows, error: statsErr } = await supabaseAdmin
      .from('customer_booking_stats')
      .select('customer_id, booking_count, total_sales');
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

    let enriched = (data || []).map((c: any) => ({
      ...c,
      bookingCount: statsMap.get(c.id)?.count || 0,
      totalSales: statsMap.get(c.id)?.totalSales || 0,
    }));

    // 후처리 필터 (minSales/maxSales/minBookings/maxBookings)
    if (minSales !== undefined) enriched = enriched.filter((c: any) => c.totalSales >= minSales);
    if (maxSales !== undefined) enriched = enriched.filter((c: any) => c.totalSales <= maxSales);
    if (minBookings !== undefined) enriched = enriched.filter((c: any) => c.bookingCount >= minBookings);
    if (maxBookings !== undefined) enriched = enriched.filter((c: any) => c.bookingCount <= maxBookings);

    // JS sort + 페이지네이션
    if (isJsSort) {
      enriched.sort((a: any, b: any) => {
        const va = a[sortBy] ?? 0;
        const vb = b[sortBy] ?? 0;
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

// 고객 단건 조회
export async function getCustomerById(id: string) {
  try {
    const { data, error } = await supabaseAdmin.from('customers').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  } catch (error) { console.error('고객 단건 조회 실패:', error); return null; }
}

// 고객 저장/업데이트
export async function upsertCustomer(data: Record<string, unknown>) {
  try {
    // 빈 문자열 → null 정규화 (phone UNIQUE 제약 충돌 방지)
    const NULLABLE = ['phone', 'email', 'passport_no', 'passport_expiry', 'birth_date', 'memo'];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(data)) {
      payload[k] = (NULLABLE.includes(k) && v === '') ? null : v;
    }
    // 전화번호 DB 트리거와 동일한 010-XXXX-XXXX 형식으로 정규화
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

    // 23505: 전화번호 중복 → 기존 고객 반환 (병렬 등록 race 또는 재임포트 시)
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

// 전화번호로 고객 조회/생성 — P4.5 리드 제출 시점에 customer_facts/conversations 역참조 용도
export async function findOrCreateCustomerByPhone(
  rawPhone: string,
  name?: string,
): Promise<string | null> {
  const digits = (rawPhone ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return null;
  // DB 트리거가 010-XXXX-XXXX 형식으로 저장하므로 동일 형식으로 조회
  const dbPhone = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;

  // 1차 조회 (phone은 UNIQUE NULLABLE — 빈 문자열은 null로 정규화되어 저장됨)
  const existing = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('phone', dbPhone)
    .limit(1);

  if (existing.data?.[0]?.id) return existing.data[0].id as string;

  // 신규 생성 (UNIQUE race 발생 시 재조회)
  const { data: inserted, error } = await supabaseAdmin
    .from('customers')
    .insert([{ phone: digits, name: name?.trim() || null }])
    .select('id')
    .limit(1);

  if (!error && inserted?.[0]?.id) return inserted[0].id as string;

  // 23505 = unique_violation (Postgres)
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

// 고객 중복 검색 (전화 우선, 없으면 이름 유사도)
// - phone: 정규화 11자리 일치 시 해당 고객 즉시 반환
// - name: 정규화된 이름 유사도 ≥ NAME_MATCH_THRESHOLD → 후보 배열
// 반환: { exact: 전화일치, candidates: 이름후보[] }
export async function findDuplicateCustomers(input: { name?: string; phone?: string }): Promise<{
  exact: { id: string; name: string; phone: string | null } | null;
  candidates: Array<{ id: string; name: string; phone: string | null; similarity: number }>;
}> {
  const { normalizePhone, normalizeName, nameSimilarity, NAME_MATCH_THRESHOLD } = await import('./customer-name');
  const rawPhone = input.phone?.trim() ?? null;
  const phone = normalizePhone(rawPhone);
  const name = input.name?.trim() ?? '';

  // 1) 전화번호 정확 일치 우선 — 정규화·비정규화 양쪽 모두 검색 (레거시 대시 포함 레코드 대응)
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

  // 2) 이름 후보 — DB 전체 로드는 비효율이므로 접두 2자 LIKE 로 1차 필터
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

// 고객 소프트 딜리트
export async function deleteCustomer(id: string) {
  const { error } = await supabaseAdmin.from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// 고객 복원
export async function restoreCustomer(id: string) {
  const { error } = await supabaseAdmin.from('customers').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
}

// 예약 목록 조회
export async function getBookings(
  status?: string,
  customerId?: string,
  opts?: {
    departureFrom?: string;   // 출발일 시작 (YYYY-MM-DD)
    departureTo?: string;     // 출발일 종료 (YYYY-MM-DD)
    includeDeleted?: string;  // 'only' = 휴지통만, 'all' = 전체, 미지정 = 정상만
    limit?: number;           // 페이지 크기 (기본 100)
    offset?: number;          // 페이지 오프셋 (기본 0)
  }
) {
  try {
    const pageLimit = opts?.limit ?? 100;
    const pageOffset = opts?.offset ?? 0;
    let query = supabaseAdmin
      .from('bookings')
      .select('*, customers!lead_customer_id(id,name,phone)')
      .order('created_at', { ascending: false })
      .range(pageOffset, pageOffset + pageLimit - 1);

    // 소프트 삭제 필터
    if (opts?.includeDeleted === 'only') {
      query = query.eq('is_deleted', true);
    } else if (opts?.includeDeleted === 'all') {
      // 필터 없음 — 전부 가져옴
    } else {
      // 기본: 삭제되지 않은 것만 (NULL 포함 — 마이그레이션 이전 레코드 대응)
      query = query.or('is_deleted.is.null,is_deleted.eq.false');
    }

    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('lead_customer_id', customerId);
    if (opts?.departureFrom) query = query.gte('departure_date', opts.departureFrom);
    if (opts?.departureTo) query = query.lte('departure_date', opts.departureTo);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) { console.error('예약 조회 실패:', error); return []; }
}

// 예약 단건 조회 (동행자 포함)
export async function getBookingById(id: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*, customers!lead_customer_id(id,name,phone,passport_expiry), booking_passengers(customers(id,name,phone,passport_expiry,passport_no))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  } catch (error) { console.error('예약 단건 조회 실패:', error); return null; }
}

// 예약 생성
export async function createBooking(data: {
  packageId?: string; packageTitle?: string; leadCustomerId: string;
  adultCount: number; childCount: number; adultCost: number; adultPrice: number;
  childCost: number; childPrice: number; infantCount?: number; infantCost?: number; fuelSurcharge: number;
  departureDate?: string; departureRegion?: string; landOperator?: string;
  bookingDate?: string; notes?: string; passengerIds?: string[];
  status?: string;
  paidAmount?: number;
  affiliateId?: string; bookingType?: string;
  // ── 어필리에이터 커미션 스냅샷 (가산식 정책 엔진 결과) ──
  influencerCommission?: number;
  appliedTotalCommissionRate?: number;
  commissionBreakdown?: Record<string, unknown>;
  // ── 콘텐츠 크리에이티브 어트리뷰션 (어떤 카드뉴스/블로그로 들어왔나) ──
  contentCreativeId?: string;
  // ── 멱등성: 클라이언트 발급 UUID v4. 동일 키 재시도 시 새 booking 생성 차단. ──
  idempotencyKey?: string;
  conversationId?: string;
  companions?: { name: string; phone?: string; passport_no?: string; passport_expiry?: string }[];
  quickCreated?: boolean; quickCreatedTxId?: string;
  /** 명시하지 않으면 BOOKING_AUTOMATION_TIER 에 따름 (assisted=true, full_auto=false) */
  depositNoticeBlocked?: boolean;
  /** 마케팅 귀속 (블로그·광고·제휴) — 예약 행에 스냅샷 저장 */
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  utm_attributed_campaign_id?: string | null;
  referral_code?: string | null;
}) {
  try {
    const { initialDepositNoticeBlockedForNewBooking } = await import('./booking-automation-policy');
    let selfReferralFlag = false;
    let selfReferralReason: string | null = null;
    if (data.affiliateId) {
      const { checkSelfReferral } = await import('./affiliate/self-referral');
      const [{ data: aff }, { data: lead }] = await Promise.all([
        supabaseAdmin.from('affiliates').select('phone, email').eq('id', data.affiliateId).maybeSingle(),
        supabaseAdmin.from('customers').select('phone, email').eq('id', data.leadCustomerId).maybeSingle(),
      ]);
      const result = checkSelfReferral({
        bookingPhone: (lead as any)?.phone,
        bookingEmail: (lead as any)?.email,
        affiliatePhone: (aff as any)?.phone,
        affiliateEmail: (aff as any)?.email,
      });
      selfReferralFlag = result.flagged;
      selfReferralReason = result.reason;
    }

    const { data: booking, error } = await supabaseAdmin.from('bookings').insert([{
      package_id: data.packageId || null,
      package_title: data.packageTitle || '미정',
      lead_customer_id: data.leadCustomerId,
      adult_count: data.adultCount,
      child_count: data.childCount,
      adult_cost: data.adultCost,
      adult_price: data.adultPrice,
      child_cost: data.childCost,
      child_price: data.childPrice,
      infant_count: data.infantCount ?? 0,
      infant_cost: data.infantCost ?? 0,
      fuel_surcharge: data.fuelSurcharge,
      departure_date: data.departureDate || null,
      departure_region: data.departureRegion || null,
      land_operator: data.landOperator || null,
      booking_date: data.bookingDate || new Date().toISOString().split('T')[0],
      notes: data.notes,
      status: data.status || 'pending',
      paid_amount: data.paidAmount ?? 0,
      is_deleted: false,
      ...(data.affiliateId ? { affiliate_id: data.affiliateId, booking_type: 'AFFILIATE' } : {}),
      // self-referral은 커미션 0 강제 (스냅샷도 0으로 — UI에서 "왜 0?" 명확히 답할 수 있도록)
      ...(selfReferralFlag
        ? {
            self_referral_flag: true,
            self_referral_reason: selfReferralReason,
            influencer_commission: 0,
            applied_total_commission_rate: 0,
            commission_breakdown: {
              base: 0,
              tier: 0,
              campaigns: [],
              raw_total: 0,
              cap: null,
              cap_policy_name: null,
              final_rate: 0,
              capped: false,
              self_referral: true,
              self_referral_reason: selfReferralReason,
              computed_at: new Date().toISOString(),
            },
          }
        : {
            ...(data.influencerCommission !== undefined ? { influencer_commission: data.influencerCommission } : {}),
            ...(data.appliedTotalCommissionRate !== undefined ? { applied_total_commission_rate: data.appliedTotalCommissionRate } : {}),
            ...(data.commissionBreakdown ? { commission_breakdown: data.commissionBreakdown } : {}),
          }),
      ...(data.contentCreativeId ? { content_creative_id: data.contentCreativeId } : {}),
      ...(data.idempotencyKey ? { idempotency_key: data.idempotencyKey } : {}),
      ...(data.conversationId ? { conversation_id: data.conversationId } : {}),
      ...(data.quickCreated ? { quick_created: true } : {}),
      ...(data.quickCreatedTxId ? { quick_created_tx_id: data.quickCreatedTxId } : {}),
      deposit_notice_blocked:
        data.depositNoticeBlocked ?? initialDepositNoticeBlockedForNewBooking(),
      ...(data.utm_source ? { utm_source: data.utm_source } : {}),
      ...(data.utm_medium ? { utm_medium: data.utm_medium } : {}),
      ...(data.utm_campaign ? { utm_campaign: data.utm_campaign } : {}),
      ...(data.utm_term ? { utm_term: data.utm_term } : {}),
      ...(data.utm_content ? { utm_content: data.utm_content } : {}),
      ...(data.utm_attributed_campaign_id
        ? { utm_attributed_campaign_id: data.utm_attributed_campaign_id }
        : {}),
      ...(data.referral_code ? { referral_code: data.referral_code } : {}),
    }] as never).select();
    if (error) throw error;
    const bookingId = booking?.[0]?.id;

    // Phase 2a — 신규 booking 이 paid_amount > 0 으로 시작하면 ledger seed entry 가 필요.
    //   기본 0 인 경우 record_ledger_entry 가 0 amount 면 NULL 반환하므로 자동 skip.
    if (bookingId && (data.paidAmount ?? 0) > 0) {
      await supabaseAdmin.rpc('record_ledger_entry', {
        p_booking_id: bookingId,
        p_account: 'paid_amount',
        p_entry_type: 'manual_adjust',
        p_amount: data.paidAmount,
        p_source: 'admin_manual_edit',
        p_source_ref_id: bookingId,
        p_idempotency_key: `create:${bookingId}:paid`,
        p_memo: 'createBooking initial paid_amount',
        p_created_by: 'admin',
      });
    }

    // companions 원시 데이터 → upsertCustomer → UUID 수집
    const companionUUIDs: string[] = [];
    if (data.companions && data.companions.length > 0) {
      for (const c of data.companions) {
        const customer = await upsertCustomer({
          name: c.name,
          phone: c.phone,
          passport_no: c.passport_no,
          passport_expiry: c.passport_expiry,
        });
        if (customer?.id) companionUUIDs.push(customer.id);
      }
    }

    // lead_customer + passengerIds + companionUUIDs 일괄 booking_passengers 연결
    const allPassengerIds = [
      ...new Set([
        data.leadCustomerId,
        ...(data.passengerIds || []),
        ...companionUUIDs,
      ]),
    ];
    if (bookingId && allPassengerIds.length > 0) {
      const passengers = allPassengerIds.map(cid => ({
        booking_id: bookingId, customer_id: cid,
      }));
      await supabaseAdmin.from('booking_passengers').insert(passengers as never);
    }

    if (booking?.[0]) {
      void import('./affiliate/celebrate').then(({ notifyAffiliateOnBooking }) =>
        notifyAffiliateOnBooking(booking[0] as any),
      );
    }
    return booking?.[0];
  } catch (error) { console.error('예약 생성 실패:', error); throw error; }
}

// 예약 상태 변경 (입금 확인 포함)
export async function updateBookingStatus(id: string, status: string) {
  try {
    const payload: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === 'completed') payload.payment_date = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update(payload)
      .eq('id', id)
      .select('*, affiliates!affiliate_id(name, phone)');
    if (error) throw error;
    if (data?.[0]) {
      void import('./affiliate/celebrate').then(({ notifyAffiliateOnBooking }) =>
        notifyAffiliateOnBooking(data[0] as any),
      );
    }
    return data?.[0];
  } catch (error) { console.error('예약 상태 변경 실패:', error); throw error; }
}

// 예약 전체 필드 수정
export async function updateBooking(id: string, data: {
  packageId?: string; packageTitle?: string;
  adultCount?: number; childCount?: number;
  adultCost?: number; adultPrice?: number;
  childCost?: number; childPrice?: number;
  fuelSurcharge?: number; departureDate?: string | null;
  departureRegion?: string; landOperator?: string;
  bookingDate?: string; paidAmount?: number;
  notes?: string; status?: string;
  passengerIds?: string[];
}) {
  try {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.packageId !== undefined) payload.package_id = data.packageId || null;
    if (data.packageTitle !== undefined) payload.package_title = data.packageTitle;
    if (data.adultCount !== undefined) payload.adult_count = data.adultCount;
    if (data.childCount !== undefined) payload.child_count = data.childCount;
    if (data.adultCost !== undefined) payload.adult_cost = data.adultCost;
    if (data.adultPrice !== undefined) payload.adult_price = data.adultPrice;
    if (data.childCost !== undefined) payload.child_cost = data.childCost;
    if (data.childPrice !== undefined) payload.child_price = data.childPrice;
    if (data.fuelSurcharge !== undefined) payload.fuel_surcharge = data.fuelSurcharge;
    if (data.departureDate !== undefined) payload.departure_date = data.departureDate || null;
    if (data.departureRegion !== undefined) payload.departure_region = data.departureRegion;
    if (data.landOperator !== undefined) payload.land_operator = data.landOperator;
    if (data.bookingDate !== undefined) payload.booking_date = data.bookingDate;
    // Phase 2a — paid_amount 는 record_manual_paid_amount_change RPC 경로로 분리 (ledger 이중쓰기 보장)
    const hasPaidAmount = data.paidAmount !== undefined;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.status !== undefined) {
      payload.status = data.status;
      if (data.status === 'completed') payload.payment_date = new Date().toISOString();
    }

    const { data: booking, error } = await supabaseAdmin.from('bookings').update(payload).eq('id', id).select();
    if (error) throw error;

    if (hasPaidAmount) {
      const { error: rpcErr } = await supabaseAdmin.rpc('record_manual_paid_amount_change', {
        p_booking_id: id,
        p_new_paid_amount: data.paidAmount as number,
        p_new_total_paid_out: null,
        p_source: 'admin_manual_edit',
        p_source_ref_id: id,
        p_idempotency_key: `manual:${id}:${Date.now()}`,
        p_memo: 'updateBooking() paid_amount edit',
        p_created_by: 'admin',
      });
      if (rpcErr) throw rpcErr;
    }

    // 동행자 업데이트
    if (data.passengerIds !== undefined) {
      await supabaseAdmin.from('booking_passengers').delete().eq('booking_id', id);
      if (data.passengerIds.length > 0) {
        await supabaseAdmin.from('booking_passengers').insert(
          data.passengerIds.map(cid => ({ booking_id: id, customer_id: cid }))
        );
      }
    }

    return booking?.[0];
  } catch (error) { console.error('예약 수정 실패:', error); throw error; }
}

// 대시보드 V1 — 본문은 ./db/dashboard.ts 로 분리
export { getDashboardStats } from './db/dashboard';

// ────────────────────────────────────────────────────────────
// 어필리에이트 ERP — 본문은 ./db/affiliate.ts 로 분리
// ────────────────────────────────────────────────────────────
export { getAffiliates, getAffiliateByCode, getDashboardStatsV2 } from './db/affiliate';
export type { Affiliate, MonthlyChartData } from './db/affiliate';

// ─────────────────────────────────────────────────────────────────
// Meta Ads — 본문은 ./db/ads.ts 로 분리
// ─────────────────────────────────────────────────────────────────
export {
  getAdCampaigns, upsertCampaign,
  saveCreatives, getAdCreatives,
  upsertAdPerformanceSnapshot, getAdPerformance,
  getTopCampaignsByRoas, getMetaCpcThreshold,
} from './db/ads';

// ─────────────────────────────────────────────────────────────────
// 카드뉴스 — 본문은 ./db/card-news.ts 로 분리
// ─────────────────────────────────────────────────────────────────
export { getCardNewsList, getCardNewsById, upsertCardNews } from './db/card-news';
export type { CardNews, CardNewsSlide, TextStyle } from './db/card-news';

// ─────────────────────────────────────────────────────────────────
// Booking Void 연쇄 처리
// ─────────────────────────────────────────────────────────────────

export async function voidBooking(bookingId: string, reason?: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  // 1. 예약 정보 조회
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, margin, utm_attributed_campaign_id, affiliate_id, departure_date')
    .eq('id', bookingId)
    .single();

  if (!booking) return;
  const bk = booking as unknown as { id: string; margin?: number; utm_attributed_campaign_id?: string; affiliate_id?: string; departure_date?: string };

  await Promise.allSettled([
    // 2. bookings voided_at, void_reason 업데이트
    supabase.from('bookings').update({
      voided_at: new Date().toISOString(),
      void_reason: reason ?? '예약 취소',
    } as never).eq('id', bookingId),

    // 3. 광고 성과 스냅샷에서 귀속 마진 차감
    (async () => {
      if (!bk.utm_attributed_campaign_id || !bk.margin) return;

      const snapshotDate = bk.departure_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

      const { data: snapshot } = await supabase
        .from('ad_performance_snapshots')
        .select('attributed_bookings, attributed_margin, spend_krw')
        .eq('campaign_id', bk.utm_attributed_campaign_id)
        .eq('snapshot_date', snapshotDate)
        .single();

      if (snapshot) {
        const snap = snapshot as unknown as { attributed_bookings?: number; attributed_margin?: number; spend_krw: number };
        const newBookings = Math.max(0, (snap.attributed_bookings ?? 0) - 1);
        const newMargin = Math.max(0, (snap.attributed_margin ?? 0) - (bk.margin ?? 0));
        const newRoas = snap.spend_krw > 0
          ? Math.round((newMargin / snap.spend_krw) * 10000) / 100
          : 0;

        await supabase
          .from('ad_performance_snapshots')
          .update({
            attributed_bookings: newBookings,
            attributed_margin: newMargin,
            net_roas_pct: newRoas,
          } as never)
          .eq('campaign_id', bk.utm_attributed_campaign_id)
          .eq('snapshot_date', snapshotDate);
      }
    })(),

    // 4. 어필리에이트 PENDING 정산 Void
    (async () => {
      if (!bk.affiliate_id) return;
      const currentPeriod = new Date().toISOString().slice(0, 7); // "2026-03"
      await supabase
        .from('settlements')
        .update({ status: 'VOID' } as never)
        .eq('affiliate_id', bk.affiliate_id)
        .eq('settlement_period', currentPeriod)
        .eq('status', 'PENDING');
    })(),

    // 5. audit_logs
    supabase.from('audit_logs').insert({
      action: 'BOOKING_VOID',
      target_type: 'booking',
      target_id: bookingId,
      description: reason ?? '예약 취소로 인한 Void 처리',
      before_value: { margin: bk.margin, status: 'active' },
      after_value: { voided: true, reason },
    } as never),
  ]);
}

// ─────────────────────────────────────────────────────────────────
// Dashboard V3 (광고비+순마진) — 본문은 ./db/dashboard.ts 로 분리
// ─────────────────────────────────────────────────────────────────
export { getDashboardStatsV3 } from './db/dashboard';
export type { MonthlyChartDataV3 } from './db/dashboard';

// ─────────────────────────────────────────────────────────────────
// Dashboard V4 (매출 인식 분리, IFRS 15/ASC 606) — 2026-04-28
// ─────────────────────────────────────────────────────────────────
export { getRecognizedRevenueMonthly, getNewBookingsMonthly, getBookingPaceAndCancellation, getAIUsageStats, getSettlementBalances, getOperatorTakeRates, getRepeatBookingStats, getDataQualityIssues } from './db/dashboard';
export type { RecognizedRevenueMonth, NewBookingsMonth, BookingPaceBucket, PaceAndCancellation, AIUsageStats, SettlementBalances, OperatorTakeRate, RepeatBookingStats, DataQualityIssue, DataQualityIssueId, DataQualityReport } from './db/dashboard';

// ─────────────────────────────────────────────────────────────────
// MessageLog — 본문은 ./db/message-log.ts 로 분리
// ─────────────────────────────────────────────────────────────────
export { getMessageLogs, createMessageLog } from './db/message-log';
export type { MessageLog } from './db/message-log';

// ============================================================
// AI 컨시어지 — Cart / Transaction / ApiOrder / MockConfig
// ============================================================
// 본문은 ./db/concierge.ts 로 분리 (god 모듈 분할 2026-04-27).
// 기존 import 호환을 위해 re-export — 호출자는 변경 불필요.
export {
  resolveProductCategory,
  getCart, upsertCart,
  createTransaction, updateTransaction, getTransaction,
  listTransactions, getTransactionByIdempotencyKey,
  createApiOrder, updateApiOrder, getApiOrdersByTransaction,
  listMockConfigs, updateMockConfig,
} from './db/concierge';
export type {
  CartItem, Cart,
  Transaction, SagaEvent, VoucherItem,
  ApiOrder,
  MockApiConfig,
} from './db/concierge';

// ============================================================
// SaaS Marketplace — Tenants / Inventory / Cross-Search / Ledger / Settlements
// ============================================================
// 본문은 ./db/tenant.ts 로 분리 (god 모듈 분할 2026-04-27).
export {
  listTenants, getTenant, createTenant, updateTenant,
  getTenantProducts, upsertTenantProduct,
  getInventoryBlocks, getInventoryByTenant, upsertInventoryBlock, deductInventory,
  searchTenantProducts,
  getMasterLedger,
  getTenantSettlements,
  updateTenantReliability,
} from './db/tenant';
export type {
  Tenant, TenantProduct, InventoryBlock, CrossSearchResult,
  LedgerEntry, TenantSettlementRow,
} from './db/tenant';


// ============================================================
// ============================================================
// 공유 일정 (shared_itineraries) — 본문은 ./db/shared-itinerary.ts
// ============================================================
export { createSharedItinerary, getSharedItinerary } from './db/shared-itinerary';
export type { SharedItinerary } from './db/shared-itinerary';

// ============================================================
// Group RFQ — AI 단체여행 무인 중개 & 선착순 입찰 엔진
// ============================================================
// 본문은 ./db/rfq.ts 로 분리 (god 모듈 분할 2026-04-27).
export {
  createGroupRfq, getGroupRfq, listGroupRfqs, updateGroupRfq,
  claimRfqBid, getRfqBids, updateRfqBid, getExpiredBids,
  createRfqProposal, getRfqProposals, getRfqProposal, updateRfqProposal,
  createRfqMessage, getRfqMessages,
} from './db/rfq';
export type {
  GroupRfq, RfqBid, ChecklistItem, ProposalChecklist, RfqProposal, RfqMessage,
} from './db/rfq';

// ═══════════════════════════════════════════════════════════════
// 3대 광고 통합 데이터 댐 — 본문은 ./db/ads.ts 로 분리
// ═══════════════════════════════════════════════════════════════
export {
  insertTrafficLog, insertSearchLog, insertEngagementLog, insertConversionLog,
  getLatestTrafficBySession, getFirstTrafficBySession, mergeSessionToUser,
} from './db/ads';
export type {
  AdTrafficLog, AdSearchLog, AdEngagementLog, AdConversionLog,
} from './db/ads';

// ═══════════════════════════════════════════════════════════════
// SecureChat / Voucher — 본문은 ./db/voucher.ts 로 분리
// ═══════════════════════════════════════════════════════════════
export {
  createSecureChat, getSecureChats, unmaskChatsForBooking,
  createVoucher, getVoucher, getVoucherByBooking, updateVoucher,
  getVouchersForReviewNotification,
} from './db/voucher';
export type { SecureChat, Voucher } from './db/voucher';

// ═══════════════════════════════════════════════════════════════
// AdAccount / KeywordPerformance — 본문은 ./db/ads.ts 로 분리
// ═══════════════════════════════════════════════════════════════
export {
  getAdAccounts, updateAdAccountBalance,
  getKeywordPerformances, updateKeywordStatus, updateKeywordBid, upsertKeywordPerformance,
  getAdDashboardStats,
} from './db/ads';
export type { AdAccount, KeywordPerformance } from './db/ads';

// ── Mileage CRUD — 본문은 ./db/mileage-tx.ts 로 분리 ────────────
export {
  createMileageTransaction, getMileageBalance,
  getEarnedMileageByBooking, getMileageHistory,
} from './db/mileage-tx';
export type { MileageTransaction } from './db/mileage-tx';
