import { createClient } from '@supabase/supabase-js';

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

function getSupabase() {
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

function getSupabaseAdmin() {
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

    const LIST_FIELDS = `
      id, title, destination, category, product_type, trip_style,
      departure_days, airline, min_participants, ticketing_deadline,
      price, price_tiers, status, confidence, created_at,
      inclusions, excludes, guide_tip, single_supplement,
      small_group_surcharge, optional_tours, itinerary, special_notes,
      land_operator, product_tags, product_highlights, product_summary
    `;
    let query = supabase
      .from('travel_packages')
      .select(LIST_FIELDS, { count: 'exact' })
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
      .select('*')
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
      .select('*')
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

// Q&A 저장
export async function saveInquiry(data: {
  question: string;
  inquiryType: string;
  relatedPackages?: string[];
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}) {
  try {
    const { data: result, error } = await supabase
      .from('qa_inquiries')
      .insert([
        {
          question: data.question,
          inquiry_type: data.inquiryType,
          related_packages: data.relatedPackages || [],
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone,
          status: 'pending',
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    return result?.[0];
  } catch (error) {
    console.error('문의 저장 실패:', error);
    throw error;
  }
}

// Q&A 조회
export async function getInquiries(status?: string) {
  try {
    let query = supabase
      .from('qa_inquiries')
      .select(
        `
        *,
        ai_responses (
          id,
          response_text,
          ai_model,
          created_at,
          approved
        )
      `
      )
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('문의 조회 실패:', error);
    return [];
  }
}

// AI 응답 저장
export async function saveAIResponse(data: {
  inquiryId: string;
  responseText: string;
  aiModel: string;
  confidence: number;
  usedPackages?: string[];
}) {
  try {
    const { data: result, error } = await supabase
      .from('ai_responses')
      .insert([
        {
          inquiry_id: data.inquiryId,
          response_text: data.responseText,
          ai_model: data.aiModel,
          confidence: data.confidence,
          used_packages: data.usedPackages || [],
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    return result?.[0];
  } catch (error) {
    console.error('AI 응답 저장 실패:', error);
    throw error;
  }
}

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

    // 예약 통계 집계
    const { data: bStats } = await supabaseAdmin
      .from('bookings')
      .select('lead_customer_id, total_price')
      .or('is_deleted.is.null,is_deleted.eq.false')
      .neq('status', 'cancelled');

    const statsMap = new Map<string, { count: number; totalSales: number }>();
    for (const b of bStats || []) {
      const cid = (b as any).lead_customer_id;
      if (!cid) continue;
      const prev = statsMap.get(cid) || { count: 0, totalSales: 0 };
      statsMap.set(cid, { count: prev.count + 1, totalSales: prev.totalSales + ((b as any).total_price || 0) });
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

    const { data: result, error } = data.id
      ? await supabaseAdmin.from('customers').update(payload).eq('id', data.id as string).select()
      : await supabaseAdmin.from('customers').insert([payload]).select();
    if (error) throw error;
    return result?.[0];
  } catch (error) { console.error('고객 저장 실패:', error); throw error; }
}

// 전화번호로 고객 조회/생성 — P4.5 리드 제출 시점에 customer_facts/conversations 역참조 용도
export async function findOrCreateCustomerByPhone(
  rawPhone: string,
  name?: string,
): Promise<string | null> {
  const digits = (rawPhone ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return null;

  // 1차 조회 (phone은 UNIQUE NULLABLE — 빈 문자열은 null로 정규화되어 저장됨)
  const existing = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('phone', digits)
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
      .eq('phone', digits)
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
  const phone = normalizePhone(input.phone);
  const name = input.name?.trim() ?? '';

  // 1) 전화번호 정확 일치 우선
  if (phone) {
    const { data } = await supabaseAdmin
      .from('customers')
      .select('id, name, phone')
      .eq('phone', phone)
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
  }
) {
  try {
    let query = supabaseAdmin
      .from('bookings')
      .select('*, customers!lead_customer_id(id,name,phone)')
      .order('created_at', { ascending: false });

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
  conversationId?: string;
  companions?: { name: string; phone?: string; passport_no?: string; passport_expiry?: string }[];
  quickCreated?: boolean; quickCreatedTxId?: string;
}) {
  try {
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
      ...(selfReferralFlag ? { self_referral_flag: true, self_referral_reason: selfReferralReason, influencer_commission: 0 } : {}),
      ...(data.conversationId ? { conversation_id: data.conversationId } : {}),
      ...(data.quickCreated ? { quick_created: true } : {}),
      ...(data.quickCreatedTxId ? { quick_created_tx_id: data.quickCreatedTxId } : {}),
    }] as never).select();
    if (error) throw error;
    const bookingId = booking?.[0]?.id;

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
    if (data.paidAmount !== undefined) payload.paid_amount = data.paidAmount;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.status !== undefined) {
      payload.status = data.status;
      if (data.status === 'completed') payload.payment_date = new Date().toISOString();
    }

    const { data: booking, error } = await supabaseAdmin.from('bookings').update(payload).eq('id', id).select();
    if (error) throw error;

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

// 대시보드 통계
export async function getDashboardStats() {
  try {
    const thisMonthStart = new Date();
    thisMonthStart.setDate(1); thisMonthStart.setHours(0,0,0,0);

    const [allBookingsRes, pendingRes, customersRes] = await Promise.all([
      // 이번 달 출발일 기준 전체 예약 (삭제 안 된 것)
      supabaseAdmin
        .from('bookings')
        .select('total_cost,total_price,paid_amount,status')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .neq('status', 'cancelled')
        .gte('departure_date', thisMonthStart.toISOString().split('T')[0]),
      supabaseAdmin.from('bookings').select('id').in('status',['pending','confirmed']).or('is_deleted.is.null,is_deleted.eq.false').gte('departure_date', thisMonthStart.toISOString().split('T')[0]),
      supabaseAdmin.from('customers').select('mileage,passport_expiry'),
    ]);

    const allBookings = allBookingsRes.data || [];
    // 이번 달 총 판매가 (출발일 기준)
    const totalSales = allBookings.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
    // 이번 달 원가 (결제완료 건만)
    const completedBookings = allBookings.filter((b: any) => b.status === 'completed');
    const totalCost = completedBookings.reduce((s: number, b: any) => s + (b.total_cost || 0), 0);
    // 이번 달 총 입금액
    const totalPaid = allBookings.reduce((s: number, b: any) => s + (b.paid_amount || 0), 0);
    // 미수금 (잔금) = 총 판매가 - 입금액
    const totalOutstanding = totalSales - totalPaid;

    const customers = customersRes.data || [];
    const totalMileage = customers.reduce((s: number, c: any) => s + (c.mileage || 0), 0);
    const sixMonthsLater = new Date(); sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
    const expiringPassports = customers.filter((c: any) =>
      c.passport_expiry && new Date(c.passport_expiry) <= sixMonthsLater
    ).length;

    return {
      totalSales,       // 이번 달 총 판매가
      totalCost,        // 이번 달 원가 (결제완료)
      totalPaid,        // 이번 달 입금 완료액
      totalOutstanding, // 이번 달 미수금
      margin: completedBookings.reduce((s: number, b: any) => s + ((b.total_price || 0) - (b.total_cost || 0)), 0),
      activeBookings: pendingRes.data?.length || 0,
      totalMonthBookings: allBookings.length,
      totalMileage,
      expiringPassports,
    };
  } catch (error) { console.error('대시보드 통계 실패:', error); return null; }
}

// ────────────────────────────────────────────────────────────
// 어필리에이트 ERP 함수들
// ────────────────────────────────────────────────────────────

export interface Affiliate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  referral_code: string;
  grade: number;
  bonus_rate: number;
  payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number;
  total_commission: number;
  memo?: string;
}

/** 어필리에이트 전체 목록 조회 */
export async function getAffiliates(): Promise<Affiliate[]> {
  try {
    const { data, error } = await supabase
      .from('affiliates')
      .select('id, name, phone, email, referral_code, grade, bonus_rate, payout_type, booking_count, total_commission, memo')
      .order('grade', { ascending: false });
    if (error) throw error;
    return (data || []) as Affiliate[];
  } catch (error) {
    console.error('어필리에이트 목록 조회 실패:', error);
    return [];
  }
}

/** 추천코드로 어필리에이트 단건 조회 */
export async function getAffiliateByCode(referralCode: string): Promise<Affiliate | null> {
  try {
    const { data, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('referral_code', referralCode)
      .single();
    if (error) throw error;
    return data as Affiliate;
  } catch {
    return null;
  }
}

export interface MonthlyChartData {
  month: string;           // "2026-01"
  direct_sales: number;
  affiliate_sales: number;
  direct_margin: number;
  affiliate_margin: number;
  total_commission: number;
}

/** 대시보드 차트용 월별 직판/인플 통계 (최근 N개월) */
export async function getDashboardStatsV2(months = 6): Promise<MonthlyChartData[]> {
  try {
    const result: MonthlyChartData[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const { data: bookings } = await supabase
        .from('bookings')
        .select('total_price, margin, influencer_commission, booking_type')
        .gte('departure_date', start)
        .lte('departure_date', end)
        .neq('status', 'cancelled')
        .or('is_deleted.is.null,is_deleted.eq.false');

      const rows = bookings || [];
      const direct = rows.filter((b: any) => b.booking_type !== 'AFFILIATE');
      const affiliate = rows.filter((b: any) => b.booking_type === 'AFFILIATE');

      result.push({
        month: monthLabel,
        direct_sales: direct.reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        affiliate_sales: affiliate.reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        direct_margin: direct.reduce((s: number, b: any) => s + (b.margin || 0), 0),
        affiliate_margin: affiliate.reduce((s: number, b: any) => s + (b.margin || 0), 0),
        total_commission: affiliate.reduce((s: number, b: any) => s + (b.influencer_commission || 0), 0),
      });
    }
    return result;
  } catch (error) {
    console.error('차트 통계 조회 실패:', error);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// Meta Ads 헬퍼 함수
// ─────────────────────────────────────────────────────────────────

import type { AdCampaign, AdCreative, AdPerformanceSnapshot, CampaignStatus } from '@/types/meta-ads';

export async function getAdCampaigns(filters?: {
  packageId?: string;
  status?: CampaignStatus;
  page?: number;
  limit?: number;
}): Promise<AdCampaign[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('ad_campaigns')
    .select('*, travel_packages(title, destination)')
    .order('created_at', { ascending: false });

  if (filters?.packageId) query = query.eq('package_id', filters.packageId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.limit) query = query.limit(filters.limit);
  if (filters?.page && filters?.limit) {
    query = query.range((filters.page - 1) * filters.limit, filters.page * filters.limit - 1);
  }

  const { data } = await query;
  return (data ?? []).map((row: any) => ({
    ...row,
    package_title: row.travel_packages?.title,
    package_destination: row.travel_packages?.destination,
  }));
}

export async function upsertCampaign(data: Partial<AdCampaign> & { id?: string }): Promise<AdCampaign | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: result, error } = await supabase
    .from('ad_campaigns')
    .upsert({ ...data, updated_at: new Date().toISOString() } as never)
    .select()
    .single();

  if (error) throw new Error(`캠페인 저장 실패: ${error.message}`);
  return result as unknown as AdCampaign;
}

export async function saveCreatives(
  creatives: Omit<AdCreative, 'id' | 'created_at'>[]
): Promise<AdCreative[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('ad_creatives')
    .insert(creatives as never)
    .select();

  if (error) throw new Error(`소재 저장 실패: ${error.message}`);
  return data ?? [];
}

export async function getAdCreatives(filters: {
  packageId?: string;
  campaignId?: string;
  platform?: string;
}): Promise<AdCreative[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('ad_creatives')
    .select('*')
    .order('platform')
    .order('variant_index');

  if (filters.packageId) query = query.eq('package_id', filters.packageId);
  if (filters.campaignId) query = query.eq('campaign_id', filters.campaignId);
  if (filters.platform) query = query.eq('platform', filters.platform);

  const { data } = await query;
  return data ?? [];
}

export async function upsertAdPerformanceSnapshot(
  snapshot: Omit<AdPerformanceSnapshot, 'id' | 'created_at'>
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase.from('ad_performance_snapshots').upsert(snapshot as never, {
    onConflict: 'campaign_id,snapshot_date',
  });
}

export async function getAdPerformance(
  campaignId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<AdPerformanceSnapshot[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('ad_performance_snapshots')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('snapshot_date', { ascending: false });

  if (dateFrom) query = query.gte('snapshot_date', dateFrom);
  if (dateTo) query = query.lte('snapshot_date', dateTo);

  const { data } = await query;
  return data ?? [];
}

export async function getTopCampaignsByRoas(limit = 3): Promise<AdCampaign[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  // 최근 7일 스냅샷에서 campaign별 ROAS 집계
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: snapshots } = await supabase
    .from('ad_performance_snapshots')
    .select('campaign_id, spend_krw, attributed_margin')
    .gte('snapshot_date', sevenDaysAgo.toISOString().slice(0, 10));

  const byId = new Map<string, { spend: number; margin: number }>();
  for (const s of (snapshots ?? []) as { campaign_id: string; spend_krw: number; attributed_margin: number }[]) {
    const existing = byId.get(s.campaign_id) ?? { spend: 0, margin: 0 };
    byId.set(s.campaign_id, {
      spend: existing.spend + s.spend_krw,
      margin: existing.margin + s.attributed_margin,
    });
  }

  const ranked = Array.from(byId.entries())
    .map(([id, stats]) => ({
      id,
      roas: stats.spend > 0 ? (stats.margin / stats.spend) * 100 : 0,
    }))
    .sort((a, b) => b.roas - a.roas)
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const { data: campaigns } = await supabase
    .from('ad_campaigns')
    .select('*, travel_packages(title, destination)')
    .in('id', ranked.map(r => r.id));

  return (campaigns ?? []).map((c: any) => ({
    ...c,
    package_title: c.travel_packages?.title,
    package_destination: c.travel_packages?.destination,
    latest_roas: ranked.find(r => r.id === c.id)?.roas ?? 0,
  }));
}

export async function getMetaCpcThreshold(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 2000;

  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'meta_cpc_threshold')
    .single();

  const val = (data as { value?: string } | null)?.value;
  return val ? parseInt(val, 10) : 2000;
}

// ─────────────────────────────────────────────────────────────────
// 카드뉴스 헬퍼 함수
// ─────────────────────────────────────────────────────────────────

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
}

export interface CardNewsSlide {
  id: string;
  position: number;
  headline: string;
  body: string;
  bg_image_url: string;
  pexels_keyword: string;
  overlay_style: 'dark' | 'light' | 'gradient-bottom' | 'gradient-top';
  headline_style?: TextStyle;
  body_style?: TextStyle;
  // V1 디자인 시스템
  template_id?: string;
  role?: string;
  badge?: string | null;
  brief_section_position?: number;
  // V2 슬롯 (Atom 기반 템플릿에서 사용)
  template_family?: 'editorial' | 'cinematic' | 'premium' | 'bold';
  template_version?: string;
  eyebrow?: string | null;
  tip?: string | null;
  warning?: string | null;
  price_chip?: string | null;
  trust_row?: string[] | null;
  accent_color?: string | null;
  photo_hint?: string | null;
}

export interface CardNews {
  id: string;
  package_id: string | null;
  campaign_id: string | null;
  title: string;
  status: 'DRAFT' | 'CONFIRMED' | 'LAUNCHED' | 'ARCHIVED';
  slides: CardNewsSlide[];
  meta_creative_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 조인 필드
  package_title?: string;
  package_destination?: string;
  // 블로그 생성 시 업로드된 슬라이드 PNG URL (from-card-news 라우트가 저장)
  slide_image_urls?: string[] | null;
  linked_blog_id?: string | null;
  // 인스타그램 자동 발행 (20260414130000 migration)
  ig_post_id?: string | null;
  ig_published_at?: string | null;
  ig_scheduled_for?: string | null;
  ig_publish_status?: 'queued' | 'publishing' | 'published' | 'failed' | null;
  ig_caption?: string | null;
  ig_error?: string | null;
  ig_slide_urls?: string[] | null;
  // V2 컬럼 (20260423010000 migration)
  template_family?: 'editorial' | 'cinematic' | 'premium' | 'bold' | 'html' | null;
  template_version?: string | null;
  brand_kit_id?: string | null;
  // brief 스냅샷 (LLM ContentBrief V2 원본)
  generation_config?: { brief?: unknown; html_mode?: unknown } | null;
  // 기타 메타
  card_news_type?: 'product' | 'info';
  topic?: string | null;
  category_id?: string | null;
  // HTML 모드 (20260427100000 migration · Claude Sonnet 4.6 + Puppeteer)
  html_raw?: string | null;
  html_generated?: string | null;
  html_thinking?: string | null;
  html_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    costUsd?: number;
    model?: string;
    durationMs?: number;
    generatedAt?: string;
  } | null;
}

export async function getCardNewsList(filters?: {
  status?: string;
  packageId?: string;
  limit?: number;
}): Promise<CardNews[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  let query = admin
    .from('card_news')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.packageId) query = query.eq('package_id', filters.packageId);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) { console.error('getCardNewsList error:', error.message); return []; }
  return (data ?? []) as unknown as CardNews[];
}

export async function getCardNewsById(id: string): Promise<CardNews | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from('card_news')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as unknown as CardNews;
}

export async function upsertCardNews(
  data: Partial<CardNews> & { title: string }
): Promise<CardNews | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: result, error } = await admin
    .from('card_news')
    .upsert({ ...data, updated_at: new Date().toISOString() } as never)
    .select()
    .single();

  if (error) throw new Error(`카드뉴스 저장 실패: ${error.message}`);
  return result as unknown as CardNews;
}

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
// 통합 대시보드 V3 (광고비 + 순마진 포함)
// ─────────────────────────────────────────────────────────────────

export interface MonthlyChartDataV3 {
  month: string;
  direct_sales: number;
  affiliate_sales: number;
  direct_margin: number;
  affiliate_margin: number;
  total_commission: number;
  ad_spend_krw: number;   // 신규
  net_margin: number;     // 신규: margins - commission - ad_spend
}

export async function getDashboardStatsV3(months = 6): Promise<MonthlyChartDataV3[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    // 전체 기간 계산 (단 2개 쿼리로 통합)
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fromStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
    const toStr = `${endMonth.getFullYear()}-${String(endMonth.getMonth() + 1).padStart(2, '0')}-${endMonth.getDate()}`;

    // 2개 쿼리 병렬 실행 (기존 12개 → 2개)
    const [{ data: bookings }, { data: snapshots }] = await Promise.all([
      supabase
        .from('bookings')
        .select('departure_date, total_price, margin, influencer_commission, booking_type')
        .gte('departure_date', fromStr)
        .lte('departure_date', toStr)
        .neq('status', 'cancelled')
        .eq('is_deleted', false),
      supabase
        .from('ad_performance_snapshots')
        .select('snapshot_date, spend_krw')
        .gte('snapshot_date', fromStr)
        .lte('snapshot_date', toStr),
    ]);

    // 월별로 그룹핑 (클라이언트 사이드)
    const bookingList = bookings ?? [];
    const snapshotList = snapshots ?? [];

    const result: MonthlyChartDataV3[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const monthBookings = bookingList.filter((b: any) => (b.departure_date ?? '').slice(0, 7) === monthLabel);
      const direct = monthBookings.filter((b: any) => b.booking_type !== 'AFFILIATE');
      const affiliate = monthBookings.filter((b: any) => b.booking_type === 'AFFILIATE');

      const directMargin = direct.reduce((s: number, b: any) => s + (b.margin || 0), 0);
      const affiliateMargin = affiliate.reduce((s: number, b: any) => s + (b.margin || 0), 0);
      const totalCommission = affiliate.reduce((s: number, b: any) => s + (b.influencer_commission || 0), 0);

      const adSpend = snapshotList
        .filter((r: any) => (r.snapshot_date ?? '').slice(0, 7) === monthLabel)
        .reduce((s: number, r: any) => s + (r.spend_krw || 0), 0);

      const netMargin = directMargin + affiliateMargin - totalCommission - adSpend;

      result.push({
        month: monthLabel,
        direct_sales: direct.reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        affiliate_sales: affiliate.reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        direct_margin: directMargin,
        affiliate_margin: affiliateMargin,
        total_commission: totalCommission,
        ad_spend_krw: adSpend,
        net_margin: netMargin,
      });
    }

    return result;
  } catch (error) {
    console.error('V3 차트 통계 조회 실패:', error);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// 고객 여정 타임라인 — message_logs
// ─────────────────────────────────────────────────────────────────

export interface MessageLog {
  id: string;
  booking_id: string;
  log_type: 'system' | 'kakao' | 'mock' | 'scheduler' | 'manual';
  event_type: string;
  title: string;
  content?: string | null;
  is_mock: boolean;
  created_by: string;
  created_at: string;
}

export async function getMessageLogs(bookingId: string): Promise<MessageLog[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('message_logs')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
  if (error) {
    // message_logs 테이블 미생성 시 조용히 빈 배열 반환 (PGRST205 방어)
    console.warn('[message_logs] 조회 실패 (테이블 없음 가능성):', error.message);
    return [];
  }
  return (data ?? []) as MessageLog[];
}

export async function createMessageLog(data: {
  booking_id: string;
  log_type: 'system' | 'kakao' | 'mock' | 'scheduler' | 'manual';
  event_type: string;
  title: string;
  content?: string;
  is_mock?: boolean;
  created_by?: string;
}): Promise<MessageLog | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('message_logs')
    .insert({
      booking_id: data.booking_id,
      log_type:   data.log_type,
      event_type: data.event_type,
      title:      data.title,
      content:    data.content ?? null,
      is_mock:    data.is_mock ?? false,
      created_by: data.created_by ?? 'system',
    } as never)
    .select()
    .single();
  if (error) {
    // message_logs 테이블 미생성 시 null 반환 (앱 중단 없음)
    console.warn('[message_logs] 생성 실패 (테이블 없음 가능성):', error.message);
    return null;
  }
  return row as MessageLog;
}

// ============================================================
// AI 컨시어지 — Cart / Transaction / ApiOrder / MockConfig
// ============================================================

export interface CartItem {
  product_id:       string;
  product_name:     string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  cost:             number;
  price:            number;
  quantity:         number;
  description:      string;
  attrs?:           Record<string, unknown>;
}

/** 구버전 CartItem/ApiOrder에 product_category 없을 때 api_name으로 추론 */
export function resolveProductCategory(
  item: { product_category?: string; api_name?: string }
): 'DYNAMIC' | 'FIXED' {
  if (item.product_category === 'FIXED')   return 'FIXED';
  if (item.product_category === 'DYNAMIC') return 'DYNAMIC';
  return item.api_name === 'tenant_product' ? 'FIXED' : 'DYNAMIC';
}

export interface Cart {
  id:         string;
  session_id: string;
  items:      CartItem[];
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id:               string;
  idempotency_key:  string;
  session_id:       string;
  status:           'PENDING' | 'CUSTOMER_PAID' | 'API_PROCESSING' | 'COMPLETED' | 'PARTIAL_FAIL' | 'REFUNDED';
  total_cost:       number;
  total_price:      number;
  net_margin:       number;
  customer_name?:   string;
  customer_phone?:  string;
  customer_email?:  string;
  saga_log:         SagaEvent[];
  vouchers?:        VoucherItem[];
  created_at:       string;
  updated_at:       string;
}

export interface SagaEvent {
  event:     string;
  timestamp: string;
  detail?:   string;
}

export interface VoucherItem {
  code:         string;
  product_name: string;
  product_type: string;
}

export interface ApiOrder {
  id:               string;
  transaction_id:   string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  product_id:       string;
  product_name:     string;
  cost:             number;
  price:            number;
  quantity:         number;
  status:           'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';
  external_ref?:    string;
  attrs?:           Record<string, unknown>;
  created_at:       string;
}

export interface MockApiConfig {
  id:        string;
  api_name:  string;
  mode:      'success' | 'fail' | 'timeout';
  delay_ms:  number;
  updated_at: string;
}

// ── Cart ────────────────────────────────────────────────────

export async function getCart(sessionId: string): Promise<Cart | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('carts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data as Cart | null;
}

export async function upsertCart(sessionId: string, items: CartItem[]): Promise<Cart | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const existing = await getCart(sessionId);
  if (existing) {
    const { data } = await sb
      .from('carts')
      .update({ items, updated_at: new Date().toISOString() } as never)
      .eq('id', existing.id)
      .select()
      .single();
    return data as Cart | null;
  } else {
    const { data } = await sb
      .from('carts')
      .insert({ session_id: sessionId, items } as never)
      .select()
      .single();
    return data as Cart | null;
  }
}

// ── Transaction ─────────────────────────────────────────────

export async function createTransaction(data: {
  idempotency_key: string;
  session_id:      string;
  total_cost:      number;
  total_price:     number;
  customer_name?:  string;
  customer_phone?: string;
  customer_email?: string;
}): Promise<Transaction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('transactions')
    .insert({ ...data, status: 'PENDING', saga_log: [] } as never)
    .select()
    .single();
  if (error) {
    console.error('트랜잭션 생성 실패:', error);
    return null;
  }
  return row as Transaction;
}

export async function updateTransaction(
  id: string,
  updates: Partial<Pick<Transaction, 'status' | 'saga_log' | 'vouchers'>> & { tenant_cost_breakdown?: Record<string, number> }
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('transactions')
    .update({ ...updates, updated_at: new Date().toISOString() } as never)
    .eq('id', id);
}

export async function getTransaction(
  id: string
): Promise<(Transaction & { api_orders: ApiOrder[] }) | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('transactions')
    .select('*, api_orders(*)')
    .eq('id', id)
    .single();
  return data as (Transaction & { api_orders: ApiOrder[] }) | null;
}

export async function listTransactions(limit = 50): Promise<Transaction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Transaction[];
}

export async function getTransactionByIdempotencyKey(
  key: string
): Promise<Transaction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('transactions')
    .select('*')
    .eq('idempotency_key', key)
    .single();
  return data as Transaction | null;
}

// ── ApiOrder ────────────────────────────────────────────────

export async function createApiOrder(data: {
  transaction_id:   string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  product_id:       string;
  product_name:     string;
  cost:             number;
  price:            number;
  quantity:         number;
  attrs?:           Record<string, unknown>;
}): Promise<ApiOrder | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('api_orders')
    .insert({ ...data, status: 'PENDING' } as never)
    .select()
    .single();
  if (error) {
    console.error('api_order 생성 실패:', error);
    return null;
  }
  return row as ApiOrder;
}

export async function updateApiOrder(
  id: string,
  updates: Partial<Pick<ApiOrder, 'status' | 'external_ref'>>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('api_orders').update(updates as never).eq('id', id);
}

export async function getApiOrdersByTransaction(transactionId: string): Promise<ApiOrder[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('api_orders')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ApiOrder[];
}

// ── MockApiConfig ────────────────────────────────────────────

export async function listMockConfigs(): Promise<MockApiConfig[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('mock_api_configs')
    .select('*')
    .order('api_name');
  return (data ?? []) as MockApiConfig[];
}

export async function updateMockConfig(
  apiName: string,
  updates: Partial<Pick<MockApiConfig, 'mode' | 'delay_ms'>>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('mock_api_configs')
    .update({ ...updates, updated_at: new Date().toISOString() } as never)
    .eq('api_name', apiName);
}

// ============================================================
// SaaS Marketplace — Tenants / Inventory / Cross-Search / Ledger
// ============================================================

export interface Tenant {
  id:                string;
  name:              string;
  contact_name?:     string;
  contact_phone?:    string;
  contact_email?:    string;
  commission_rate:   number;
  status:            'active' | 'inactive' | 'suspended';
  description?:      string;
  tier:              'GOLD' | 'SILVER' | 'BRONZE';
  reliability_score: number;
  created_at:        string;
  updated_at:        string;
}

export interface TenantProduct {
  id:              string;
  tenant_id:       string;
  title:           string;
  destination?:    string;
  category?:       string;
  product_type?:   string;
  cost_price:      number;
  price:           number;
  min_participants?: number;
  status:          string;
  land_operator?:  string;
  notes?:          string;
  created_at:      string;
  updated_at:      string;
}

export interface InventoryBlock {
  id:              string;
  tenant_id:       string;
  product_id:      string;
  date:            string;
  total_seats:     number;
  booked_seats:    number;
  available_seats: number;
  price_override?: number;
  status:          'OPEN' | 'CLOSED' | 'SOLDOUT';
  created_at:      string;
  updated_at:      string;
}

export interface CrossSearchResult {
  product_id:   string;
  product_name: string;
  tenant_id:    string;
  tenant_name:  string;
  product_type: string;
  category?:    string;
  cost_price:   number;
  effective_price: number;
  price:        number;
  margin:       number;
  destination?: string;
  available_seats: number;
  date:         string;
  price_override?: number;
  attrs?:       Record<string, unknown>;
}

// ── Tenant CRUD ─────────────────────────────────────────────

export async function listTenants(): Promise<Tenant[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('tenants')
    .select('*')
    .order('name');
  return (data ?? []) as Tenant[];
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('tenants')
    .select('*')
    .eq('id', id)
    .single();
  return data as Tenant | null;
}

export async function createTenant(data: Omit<Tenant, 'id' | 'created_at' | 'updated_at'>): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('tenants')
    .insert(data as never)
    .select()
    .single();
  if (error) { console.error('테넌트 생성 실패:', error); return null; }
  return row as Tenant;
}

export async function updateTenant(id: string, data: Partial<Omit<Tenant, 'id' | 'created_at'>>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('tenants').update({ ...data, updated_at: new Date().toISOString() } as never).eq('id', id);
}

// ── Tenant Products ─────────────────────────────────────────

export async function getTenantProducts(tenantId: string): Promise<TenantProduct[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('travel_packages')
    .select('id, tenant_id, title, destination, category, product_type, cost_price, price, min_participants, status, land_operator, notes, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return (data ?? []) as TenantProduct[];
}

export async function upsertTenantProduct(data: {
  id?: string;
  tenant_id: string;
  title: string;
  destination?: string;
  category?: string;
  product_type?: string;
  cost_price: number;
  price: number;
  min_participants?: number;
  notes?: string;
}): Promise<TenantProduct | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload = { ...data, status: 'approved', updated_at: new Date().toISOString() };
  let query;
  if (data.id) {
    query = sb.from('travel_packages').update(payload as never).eq('id', data.id).select().single();
  } else {
    query = sb.from('travel_packages').insert(payload as never).select().single();
  }
  const { data: row, error } = await query;
  if (error) { console.error('테넌트 상품 저장 실패:', error); return null; }
  return row as TenantProduct;
}

// ── Inventory Blocks ─────────────────────────────────────────

export async function getInventoryBlocks(
  productId: string,
  from: string,
  to: string
): Promise<InventoryBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('inventory_blocks')
    .select('*')
    .eq('product_id', productId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  return (data ?? []) as InventoryBlock[];
}

export async function getInventoryByTenant(
  tenantId: string,
  from: string,
  to: string
): Promise<InventoryBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('inventory_blocks')
    .select('*, travel_packages!product_id(title, destination, category)')
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  return (data ?? []) as InventoryBlock[];
}

export async function upsertInventoryBlock(data: {
  tenant_id:      string;
  product_id:     string;
  date:           string;
  total_seats:    number;
  booked_seats?:  number;
  price_override?: number;
  status?:        'OPEN' | 'CLOSED' | 'SOLDOUT';
}): Promise<InventoryBlock | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload = {
    ...data,
    booked_seats: data.booked_seats ?? 0,
    status: data.status ?? 'OPEN',
    updated_at: new Date().toISOString(),
  };
  const { data: row, error } = await sb
    .from('inventory_blocks')
    .upsert(payload as never, { onConflict: 'product_id,date' })
    .select()
    .single();
  if (error) { console.error('재고 저장 실패:', error); return null; }
  return row as InventoryBlock;
}

export async function deductInventory(
  productId: string,
  date: string,
  quantity: number
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // 현재 booked_seats 조회 후 증가
  const { data: current } = await sb
    .from('inventory_blocks')
    .select('booked_seats, total_seats')
    .eq('product_id', productId)
    .eq('date', date)
    .single();
  if (!current) return;
  const cur = current as unknown as { booked_seats: number; total_seats: number };

  const newBooked = cur.booked_seats + quantity;
  const isSoldOut = newBooked >= cur.total_seats;

  await sb
    .from('inventory_blocks')
    .update({
      booked_seats: newBooked,
      status: isSoldOut ? 'SOLDOUT' : 'OPEN',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('product_id', productId)
    .eq('date', date);
}

// ── Cross-Tenant AI Search ───────────────────────────────────

export async function searchTenantProducts(opts: {
  destination?: string;
  category?:    string;
  date?:        string;
  persons?:     number;
}): Promise<CrossSearchResult[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const minPersons = opts.persons ?? 1;

  let query = sb
    .from('inventory_blocks')
    .select(`
      id, date, available_seats, price_override, status,
      tenant_id,
      travel_packages!product_id(
        id, title, destination, category, product_type,
        cost_price, price, min_participants
      ),
      tenants!tenant_id(id, name)
    `)
    .gt('available_seats', 0)
    .eq('status', 'OPEN');

  if (opts.date) {
    query = query.eq('date', opts.date);
  } else {
    // 오늘 이후 날짜만
    query = query.gte('date', new Date().toISOString().slice(0, 10));
  }

  const { data } = await query.limit(50);
  if (!data) return [];

  type RawRow = {
    id: string;
    date: string;
    available_seats: number;
    price_override: number | null;
    status: string;
    tenant_id: string;
    travel_packages: { id: string; title: string; destination?: string; category?: string; product_type?: string; cost_price: number; price: number; min_participants?: number } | null;
    tenants: { id: string; name: string } | null;
  };

  let results: CrossSearchResult[] = (data as RawRow[])
    .filter(row => {
      if (!row.travel_packages || !row.tenants) return false;
      if (row.available_seats < minPersons) return false;
      const pkg = row.travel_packages;
      if (opts.destination && pkg.destination) {
        const dest = opts.destination.toLowerCase();
        if (!pkg.destination.toLowerCase().includes(dest) && !pkg.title?.toLowerCase().includes(dest)) return false;
      }
      if (opts.category && pkg.category !== opts.category) return false;
      return true;
    })
    .map(row => {
      const pkg = row.travel_packages!;
      const tenant = row.tenants!;
      const effectivePrice = row.price_override ?? pkg.price;
      const margin = effectivePrice - pkg.cost_price;
      return {
        product_id:   pkg.id,
        product_name: pkg.title,
        tenant_id:    tenant.id,
        tenant_name:  tenant.name,
        product_type: pkg.category?.toUpperCase() ?? 'PACKAGE',
        category:     pkg.category,
        cost_price:   pkg.cost_price,
        effective_price: effectivePrice,
        price:        effectivePrice,
        margin,
        destination:  pkg.destination,
        available_seats: row.available_seats,
        date:         row.date,
        price_override: row.price_override ?? undefined,
        attrs: { category: pkg.category, min_participants: pkg.min_participants },
      };
    });

  // 마진 높은 순 정렬 (AI 추천 1순위)
  results = results.sort((a, b) => b.margin - a.margin);
  return results;
}

// ── Master Ledger ────────────────────────────────────────────

export interface LedgerEntry {
  tenant_id:        string | null;
  tenant_name:      string;
  order_count:      number;
  total_cost:       number;
  total_price:      number;
  platform_fee:     number;
  product_category: 'DYNAMIC' | 'FIXED' | 'MIXED';
}

export async function getMasterLedger(month: string, category?: 'DYNAMIC' | 'FIXED'): Promise<{
  entries: LedgerEntry[];
  kpis: { total_price: number; total_cost: number; platform_fee: number; tx_count: number; dynamic_price: number; fixed_price: number };
}> {
  const sb = getSupabase();
  const emptyKpis = { total_price: 0, total_cost: 0, platform_fee: 0, tx_count: 0, dynamic_price: 0, fixed_price: 0 };
  if (!sb) return { entries: [], kpis: emptyKpis };

  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}T23:59:59Z`;

  // api_orders JOIN transactions(COMPLETED) JOIN tenants
  const { data: orders } = await sb
    .from('api_orders')
    .select(`
      id, api_name, product_category, cost, price, quantity, tenant_id,
      transactions!transaction_id(id, status, created_at),
      tenants!tenant_id(id, name)
    `)
    .gte('created_at', from)
    .lte('created_at', to);

  if (!orders) return { entries: [], kpis: emptyKpis };

  type OrderRow = {
    api_name: string; product_category: string | null;
    cost: number; price: number; quantity: number; tenant_id: string | null;
    transactions: { status: string; created_at: string } | null;
    tenants: { id: string; name: string } | null;
  };

  const allCompleted = (orders as OrderRow[]).filter(o => o.transactions?.status === 'COMPLETED');

  // product_category 없는 구버전 rows: api_name 기반 추론
  const resolveCategory = (o: OrderRow): 'DYNAMIC' | 'FIXED' => {
    if (o.product_category === 'FIXED')   return 'FIXED';
    if (o.product_category === 'DYNAMIC') return 'DYNAMIC';
    return o.api_name === 'tenant_product' ? 'FIXED' : 'DYNAMIC';
  };

  // 카테고리 필터 (옵션)
  const completed = category
    ? allCompleted.filter(o => resolveCategory(o) === category)
    : allCompleted;

  // 테넌트별 집계
  const map = new Map<string, LedgerEntry>();

  for (const o of completed) {
    const key  = o.tenant_id ?? 'mock';
    const name = o.tenants?.name ?? 'Mock API (자체 상품)';
    const cat  = resolveCategory(o);
    if (!map.has(key)) {
      map.set(key, { tenant_id: o.tenant_id, tenant_name: name, order_count: 0, total_cost: 0, total_price: 0, platform_fee: 0, product_category: cat });
    }
    const entry = map.get(key)!;
    entry.order_count += 1;
    entry.total_cost  += o.cost  * o.quantity;
    entry.total_price += o.price * o.quantity;
    // MIXED 판정
    if (entry.product_category !== cat) entry.product_category = 'MIXED';
  }

  const entries = Array.from(map.values()).map(e => ({
    ...e,
    platform_fee: e.total_price - e.total_cost,
  })).sort((a, b) => b.total_cost - a.total_cost);

  // KPI 집계 (DYNAMIC/FIXED 분리)
  let dynamic_price = 0, fixed_price = 0;
  for (const o of allCompleted) {
    const v = o.price * o.quantity;
    if (resolveCategory(o) === 'FIXED') fixed_price += v; else dynamic_price += v;
  }

  const kpis = entries.reduce(
    (s, e) => ({
      total_price:  s.total_price  + e.total_price,
      total_cost:   s.total_cost   + e.total_cost,
      platform_fee: s.platform_fee + e.platform_fee,
      tx_count:     s.tx_count     + e.order_count,
      dynamic_price,
      fixed_price,
    }),
    { total_price: 0, total_cost: 0, platform_fee: 0, tx_count: 0, dynamic_price, fixed_price }
  );

  return { entries, kpis };
}

// ── Tenant Settlements ───────────────────────────────────────

export interface TenantSettlementRow {
  order_id:     string;
  product_name: string;
  date:         string;
  quantity:     number;
  cost:         number;   // 정산 원가 (판매가/마진은 제공 안 함)
}

export async function getTenantSettlements(
  tenantId: string,
  month: string
): Promise<{ rows: TenantSettlementRow[]; total_cost: number }> {
  const sb = getSupabase();
  if (!sb) return { rows: [], total_cost: 0 };

  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}T23:59:59Z`;

  const { data } = await sb
    .from('api_orders')
    .select('id, product_name, created_at, quantity, cost, transactions!transaction_id(status)')
    .eq('tenant_id', tenantId)
    .gte('created_at', from)
    .lte('created_at', to);

  if (!data) return { rows: [], total_cost: 0 };

  type Row = { id: string; product_name: string; created_at: string; quantity: number; cost: number; transactions: { status: string } | null };

  const rows: TenantSettlementRow[] = (data as Row[])
    .filter(o => o.transactions?.status === 'COMPLETED')
    .map(o => ({
      order_id:     o.id,
      product_name: o.product_name,
      date:         o.created_at.slice(0, 10),
      quantity:     o.quantity,
      cost:         o.cost * o.quantity,
    }));

  const total_cost = rows.reduce((s, r) => s + r.cost, 0);
  return { rows, total_cost };
}

// ============================================================
// 공유 일정 (shared_itineraries)
// ============================================================

export interface SharedItinerary {
  id:            string;
  share_code:    string;
  share_type:    'DYNAMIC' | 'FIXED';
  // DYNAMIC
  items?:        CartItem[];
  search_query?: string;
  // FIXED
  product_id?:   string;
  product_name?: string;
  review_text?:  string;
  // 공통
  creator_name:  string;
  view_count:    number;
  expires_at:    string;
  created_at:    string;
}

function generateShareCode(): string {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return part() + part();
}

export async function createSharedItinerary(
  data: Omit<SharedItinerary, 'id' | 'share_code' | 'view_count' | 'created_at' | 'expires_at'>
): Promise<SharedItinerary | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const share_code = generateShareCode();
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: row, error } = await sb
    .from('shared_itineraries')
    .insert([{ ...data, share_code, expires_at }] as never)
    .select()
    .single();
  if (error) { console.error('공유 일정 생성 실패:', error); return null; }
  return row as SharedItinerary;
}

export async function getSharedItinerary(code: string): Promise<SharedItinerary | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row } = await sb
    .from('shared_itineraries')
    .select('*')
    .eq('share_code', code)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (!row) return null;
  // view_count 증가 (fire-and-forget)
  sb.from('shared_itineraries')
    .update({ view_count: (row as SharedItinerary).view_count + 1 } as never)
    .eq('share_code', code)
    .then(() => {});
  return row as SharedItinerary;
}

// ============================================================
// Group RFQ — AI 단체여행 무인 중개 & 선착순 입찰 엔진
// ============================================================

export interface GroupRfq {
  id:                   string;
  rfq_code:             string;
  customer_id?:         string;
  customer_name:        string;
  customer_phone?:      string;
  destination:          string;
  departure_date_from?: string;
  departure_date_to?:   string;
  duration_nights?:     number;
  adult_count:          number;
  child_count:          number;
  budget_per_person?:   number;
  total_budget?:        number;
  hotel_grade?:         string;
  meal_plan?:           string;
  transportation?:      string;
  special_requests?:    string;
  custom_requirements?: Record<string, unknown>;
  status:               'draft'|'published'|'bidding'|'analyzing'|'awaiting_selection'|'contracted'|'completed'|'cancelled';
  published_at?:        string;
  gold_unlock_at?:      string;
  silver_unlock_at?:    string;
  bronze_unlock_at?:    string;
  bid_deadline?:        string;
  max_proposals:        number;
  selected_proposal_id?: string;
  ai_interview_log?:    unknown[];
  created_at:           string;
  updated_at:           string;
}

export interface RfqBid {
  id:              string;
  rfq_id:          string;
  tenant_id:       string;
  tenant_name?:    string;   // JOIN용
  status:          'locked'|'submitted'|'selected'|'rejected'|'timeout'|'withdrawn';
  locked_at:       string;
  submit_deadline: string;
  submitted_at?:   string;
  is_penalized:    boolean;
  penalty_reason?: string;
}

export interface ChecklistItem {
  included: boolean;
  amount:   number | null;
  note:     string;
}

export interface ProposalChecklist {
  guide_fee:      ChecklistItem;
  driver_tip:     ChecklistItem;
  fuel_surcharge: ChecklistItem;
  local_tax:      ChecklistItem;
  water_cost:     ChecklistItem;
  inclusions:     string[];
  exclusions:     string[];
  optional_tours: { name: string; price: number }[];
  hotel_info:     { grade: string; name: string; notes: string };
  meal_plan:      string;
  transportation: string;
}

export interface RfqProposal {
  id:                   string;
  rfq_id:               string;
  bid_id:               string;
  tenant_id:            string;
  tenant_name?:         string;   // JOIN용
  proposal_title?:      string;
  itinerary_summary?:   string;
  total_cost:           number;
  total_selling_price:  number;
  hidden_cost_estimate: number;
  real_total_price?:    number;
  checklist:            Partial<ProposalChecklist>;
  checklist_completed:  boolean;
  ai_review?:           { score: number; issues: string[]; suggestions: string[]; fact_check: string[] };
  ai_reviewed_at?:      string;
  rank?:                number;
  status:               'draft'|'submitted'|'reviewing'|'approved'|'selected'|'rejected';
  submitted_at?:        string;
  created_at:           string;
  updated_at:           string;
}

export interface RfqMessage {
  id:                     string;
  rfq_id:                 string;
  proposal_id?:           string;
  sender_type:            'customer'|'tenant'|'ai'|'system';
  sender_id?:             string;
  raw_content:            string;
  processed_content?:     string;
  pii_detected:           boolean;
  pii_blocked:            boolean;
  recipient_type:         'customer'|'tenant'|'admin';
  is_visible_to_customer: boolean;
  is_visible_to_tenant:   boolean;
  created_at:             string;
}

// RFQ 채번 헬퍼
function generateRfqCode(): string {
  return `GRP-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

// ── GroupRfq CRUD ────────────────────────────────────────────

export async function createGroupRfq(
  data: Omit<GroupRfq, 'id' | 'rfq_code' | 'created_at' | 'updated_at'>
): Promise<GroupRfq | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('group_rfqs')
    .insert([{ ...data, rfq_code: generateRfqCode() }] as never)
    .select()
    .single();
  if (error) { console.error('RFQ 생성 실패:', error); return null; }
  return row as GroupRfq;
}

export async function getGroupRfq(id: string): Promise<GroupRfq | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('group_rfqs')
    .select('*')
    .eq('id', id)
    .single();
  return data as GroupRfq | null;
}

export async function listGroupRfqs(status?: string, limit = 50): Promise<GroupRfq[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from('group_rfqs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return (data ?? []) as GroupRfq[];
}

export async function updateGroupRfq(id: string, patch: Partial<GroupRfq>): Promise<GroupRfq | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('group_rfqs')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('RFQ 업데이트 실패:', error); return null; }
  return data as GroupRfq;
}

// ── RfqBid CRUD ──────────────────────────────────────────────

export async function claimRfqBid(rfqId: string, tenantId: string): Promise<RfqBid | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const timeoutMin = parseInt(process.env.RFQ_BID_TIMEOUT_MINUTES ?? '180');
  const submit_deadline = new Date(Date.now() + timeoutMin * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('rfq_bids')
    .insert([{ rfq_id: rfqId, tenant_id: tenantId, submit_deadline }] as never)
    .select()
    .single();
  if (error) { console.error('입찰 확정 실패:', error); return null; }
  return data as RfqBid;
}

export async function getRfqBids(rfqId: string): Promise<RfqBid[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('rfq_bids')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .order('locked_at', { ascending: true });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as RfqBid & { tenants?: { name?: string } };
    return { ...row, tenant_name: row.tenants?.name } as RfqBid;
  });
}

export async function updateRfqBid(id: string, patch: Partial<RfqBid>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('rfq_bids').update(patch as never).eq('id', id);
}

export async function getExpiredBids(): Promise<RfqBid[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('rfq_bids')
    .select('*')
    .eq('status', 'locked')
    .lt('submit_deadline', new Date().toISOString());
  return (data ?? []) as RfqBid[];
}

// ── RfqProposal CRUD ─────────────────────────────────────────

export async function createRfqProposal(
  data: Omit<RfqProposal, 'id' | 'created_at' | 'updated_at'>
): Promise<RfqProposal | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('rfq_proposals')
    .insert([data] as never)
    .select()
    .single();
  if (error) { console.error('제안서 생성 실패:', error); return null; }
  return row as RfqProposal;
}

export async function getRfqProposals(rfqId: string): Promise<RfqProposal[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('rfq_proposals')
    .select('*, tenants(name)')
    .eq('rfq_id', rfqId)
    .order('rank', { ascending: true, nullsFirst: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as RfqProposal & { tenants?: { name?: string } };
    return { ...row, tenant_name: row.tenants?.name } as RfqProposal;
  });
}

export async function getRfqProposal(id: string): Promise<RfqProposal | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('rfq_proposals').select('*').eq('id', id).single();
  return data as RfqProposal | null;
}

export async function updateRfqProposal(
  id: string, patch: Partial<RfqProposal>
): Promise<RfqProposal | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('rfq_proposals')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('제안서 업데이트 실패:', error); return null; }
  return data as RfqProposal;
}

// ── RfqMessage CRUD ──────────────────────────────────────────

export async function createRfqMessage(
  data: Omit<RfqMessage, 'id' | 'created_at'>
): Promise<RfqMessage | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('rfq_messages')
    .insert([data] as never)
    .select()
    .single();
  if (error) { console.error('RFQ 메시지 생성 실패:', error); return null; }
  return row as RfqMessage;
}

export async function getRfqMessages(
  rfqId: string,
  viewAs: 'customer' | 'tenant' | 'admin',
  proposalId?: string
): Promise<RfqMessage[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from('rfq_messages').select('*').eq('rfq_id', rfqId);
  if (proposalId) q = q.eq('proposal_id', proposalId);
  if (viewAs === 'customer') q = q.eq('is_visible_to_customer', true);
  else if (viewAs === 'tenant') q = q.eq('is_visible_to_tenant', true);
  const { data } = await q.order('created_at', { ascending: true });
  return (data ?? []) as RfqMessage[];
}

// ── Tenant 신뢰도 점수 ───────────────────────────────────────

export async function updateTenantReliability(tenantId: string, delta: number): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // reliability_score = GREATEST(0, LEAST(100, current + delta))
  const { data: t } = await sb.from('tenants').select('reliability_score').eq('id', tenantId).single();
  if (!t) return;
  const newScore = Math.max(0, Math.min(100, (t as { reliability_score: number }).reliability_score + delta));
  await sb.from('tenants').update({ reliability_score: newScore } as never).eq('id', tenantId);
}

// ═══════════════════════════════════════════════════════════════
// 3대 광고 통합 데이터 댐 — TrafficLog / SearchLog / EngagementLog / ConversionLog
// ═══════════════════════════════════════════════════════════════

export interface AdTrafficLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign_name?: string | null;
  keyword?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  n_keyword?: string | null;
  current_cpc?: number | null;
  consent_agreed: boolean;
  landing_page?: string | null;
  content_creative_id?: string | null;
  created_at: string;
}

export interface AdSearchLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  search_query?: string | null;
  search_category?: string | null;
  result_count?: number;
  lead_time_days?: number | null;
  created_at: string;
}

export interface AdEngagementLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  event_type: 'page_view' | 'product_view' | 'cart_added' | 'checkout_start';
  product_id?: string | null;
  product_name?: string | null;
  cart_added: boolean;
  page_url?: string | null;
  lead_time_days?: number | null;
  created_at: string;
}

export interface AdConversionLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  final_booking_id?: string | null;
  final_sales_price: number;
  base_cost: number;
  allocated_ad_spend: number;
  net_profit: number; // GENERATED ALWAYS
  attributed_source?: string | null;
  attributed_gclid?: string | null;
  attributed_fbclid?: string | null;
  // First-touch 어트리뷰션
  first_touch_source?: string | null;
  first_touch_keyword?: string | null;
  first_touch_landing_page?: string | null;
  first_touch_creative_id?: string | null;
  first_touch_at?: string | null;
  content_creative_id?: string | null;
  created_at: string;
}

// ── INSERT 헬퍼 ──────────────────────────────────────────────

export async function insertTrafficLog(data: Omit<AdTrafficLog, 'id' | 'created_at'>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_traffic_logs').insert(data as never);
}

export async function insertSearchLog(data: Omit<AdSearchLog, 'id' | 'created_at'>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_search_logs').insert(data as never);
}

export async function insertEngagementLog(data: Omit<AdEngagementLog, 'id' | 'created_at'>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_engagement_logs').insert(data as never);
}

export async function insertConversionLog(
  data: Omit<AdConversionLog, 'id' | 'net_profit' | 'created_at'>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // net_profit는 GENERATED ALWAYS 컬럼 — INSERT payload에서 제외
  await sb.from('ad_conversion_logs').insert(data as never);
}

// ── QUERY 헬퍼 ───────────────────────────────────────────────

export async function getLatestTrafficBySession(session_id: string): Promise<AdTrafficLog | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('ad_traffic_logs')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: false })
    .limit(1);
  return (data && data.length > 0) ? (data[0] as unknown as AdTrafficLog) : null;
}

/** First-touch: 해당 세션의 가장 첫 번째 유입 기록 */
export async function getFirstTrafficBySession(session_id: string): Promise<AdTrafficLog | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('ad_traffic_logs')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(1);
  return (data && data.length > 0) ? (data[0] as unknown as AdTrafficLog) : null;
}

export async function mergeSessionToUser(session_id: string, user_id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // 3개 테이블의 session_id 행에 user_id 채우기 (user_id가 NULL인 행만)
  await Promise.all([
    sb.from('ad_traffic_logs')
      .update({ user_id } as never)
      .eq('session_id', session_id)
      .is('user_id', null),
    sb.from('ad_search_logs')
      .update({ user_id } as never)
      .eq('session_id', session_id)
      .is('user_id', null),
    sb.from('ad_engagement_logs')
      .update({ user_id } as never)
      .eq('session_id', session_id)
      .is('user_id', null),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// 안심 중개 채팅 (SecureChat) & 여소남 표준 확정서 (Voucher)
// ═══════════════════════════════════════════════════════════════

import type { VoucherData } from './voucher-generator';

export interface SecureChat {
  id: string;
  booking_id?: string | null;
  rfq_id?: string | null;
  sender_type: 'customer' | 'land_agency' | 'system';
  sender_id: string;
  receiver_type: 'customer' | 'land_agency' | 'admin';
  raw_message: string;
  masked_message: string;
  is_filtered: boolean;
  filter_detail?: string | null;
  is_unmasked: boolean;
  unmasked_at?: string | null;
  created_at: string;
}

export interface Voucher {
  id: string;
  booking_id?: string | null;
  rfq_id?: string | null;
  customer_id?: string | null;
  land_agency_id?: string | null;
  parsed_data: VoucherData;
  upsell_data: unknown[];
  pdf_url?: string | null;
  status: 'draft' | 'issued' | 'sent' | 'cancelled';
  issued_at?: string | null;
  sent_at?: string | null;
  end_date?: string | null;
  review_notified: boolean;
  created_at: string;
  updated_at: string;
}

// ── SecureChat CRUD ─────────────────────────────────────────────

export async function createSecureChat(
  data: Omit<SecureChat, 'id' | 'created_at'>
): Promise<SecureChat | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('secure_chats')
    .insert(data as never)
    .select()
    .single();
  if (error) { console.error('createSecureChat', error); return null; }
  return row as SecureChat;
}

export async function getSecureChats(params: {
  bookingId?: string;
  rfqId?: string;
  receiverType: 'customer' | 'land_agency' | 'admin';
}): Promise<SecureChat[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from('secure_chats')
    .select('*')
    .eq('receiver_type', params.receiverType);
  if (params.bookingId) q = q.eq('booking_id', params.bookingId);
  if (params.rfqId)     q = q.eq('rfq_id', params.rfqId);
  const { data } = await q.order('created_at', { ascending: true });
  return (data ?? []) as SecureChat[];
}

/** 결제 완료 후 해당 booking의 채팅 마스킹 일괄 해제 */
export async function unmaskChatsForBooking(bookingId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('secure_chats')
    .update({ is_unmasked: true, unmasked_at: new Date().toISOString() } as never)
    .eq('booking_id', bookingId)
    .eq('is_unmasked', false);
}

// ── Voucher CRUD ────────────────────────────────────────────────

export async function createVoucher(
  data: Omit<Voucher, 'id' | 'created_at' | 'updated_at'>
): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('vouchers')
    .insert({ ...data, updated_at: new Date().toISOString() } as never)
    .select()
    .single();
  if (error) { console.error('createVoucher', error); return null; }
  return row as Voucher;
}

export async function getVoucher(id: string): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('vouchers').select('*').eq('id', id).single();
  return data ? (data as unknown as Voucher) : null;
}

export async function getVoucherByBooking(bookingId: string): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('vouchers')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data ? (data as unknown as Voucher) : null;
}

export async function updateVoucher(
  id: string,
  patch: Partial<Omit<Voucher, 'id' | 'created_at'>>
): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('vouchers')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateVoucher', error); return null; }
  return data as Voucher;
}

/** 여행 종료일 +1일이 지났고 만족도 조사를 아직 보내지 않은 확정서 목록 */
export async function getVouchersForReviewNotification(): Promise<Voucher[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const { data } = await sb
    .from('vouchers')
    .select('*')
    .eq('status', 'sent')
    .eq('review_notified', false)
    .lte('end_date', yesterday.toISOString().slice(0, 10));
  return (data ?? []) as Voucher[];
}

// ═══════════════════════════════════════════════════════════════
// AI 마케팅 관제소 — AdAccount / KeywordPerformance / Mileage
// ═══════════════════════════════════════════════════════════════

export interface AdAccount {
  id: string;
  platform: 'naver' | 'google' | 'meta';
  account_name: string;
  current_balance: number;
  daily_budget: number;
  low_balance_threshold: number;
  is_active: boolean;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeywordPerformance {
  id: string;
  platform: 'naver' | 'google' | 'meta';
  keyword: string;
  ad_account_id?: string | null;
  total_spend: number;
  total_revenue: number;
  total_cost: number;
  net_profit: number;   // GENERATED ALWAYS
  roas_pct: number;     // GENERATED ALWAYS
  status: 'ACTIVE' | 'PAUSED' | 'FLAGGED_UP';
  current_bid: number;
  clicks: number;
  impressions: number;
  conversions: number;
  is_longtail: boolean;
  discovered_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  updated_at: string;
}

export interface MileageTransaction {
  id: string;
  user_id: string;
  booking_id?: string | null;
  amount: number;
  type: 'EARNED' | 'USED' | 'CLAWBACK';
  margin_impact: number;
  base_net_profit: number;
  mileage_rate: number;
  memo?: string | null;
  ref_transaction_id?: string | null;
  created_at: string;
}

// ── AdAccount CRUD ──────────────────────────────────────────────

export async function getAdAccounts(): Promise<AdAccount[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from('ad_accounts').select('*').eq('is_active', true);
  return (data ?? []) as AdAccount[];
}

export async function updateAdAccountBalance(
  id: string,
  balance: number
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_accounts').update({
    current_balance: balance,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never).eq('id', id);
}

// ── KeywordPerformance CRUD ─────────────────────────────────────

export async function getKeywordPerformances(params?: {
  platform?: string;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<KeywordPerformance[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from('keyword_performances').select('*');
  if (params?.platform) q = q.eq('platform', params.platform);
  if (params?.status)   q = q.eq('status', params.status);
  if (params?.periodStart) q = q.gte('period_start', params.periodStart);
  if (params?.periodEnd)   q = q.lte('period_end', params.periodEnd);
  const { data } = await q.order('net_profit', { ascending: false });
  return (data ?? []) as KeywordPerformance[];
}

export async function updateKeywordStatus(
  id: string,
  status: 'ACTIVE' | 'PAUSED' | 'FLAGGED_UP'
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('keyword_performances').update({
    status,
    updated_at: new Date().toISOString(),
  } as never).eq('id', id);
}

export async function upsertKeywordPerformance(
  data: Omit<KeywordPerformance, 'id' | 'net_profit' | 'roas_pct' | 'updated_at'>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('keyword_performances').upsert(
    { ...data, updated_at: new Date().toISOString() } as never,
    { onConflict: 'platform,keyword' }
  );
}

/** 오늘 날짜 기준 총 광고 지출 및 전환 매출 집계 */
export async function getAdDashboardStats(date?: string): Promise<{
  total_spend: number;
  total_revenue: number;
  total_cost: number;
  total_net_profit: number;
}> {
  const sb = getSupabase();
  if (!sb) return { total_spend: 0, total_revenue: 0, total_cost: 0, total_net_profit: 0 };
  const today = date ?? new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from('keyword_performances')
    .select('total_spend, total_revenue, total_cost, net_profit')
    .eq('period_start', today);
  const rows = (data ?? []) as Pick<KeywordPerformance, 'total_spend' | 'total_revenue' | 'total_cost' | 'net_profit'>[];
  return {
    total_spend:      rows.reduce((s, r) => s + r.total_spend, 0),
    total_revenue:    rows.reduce((s, r) => s + r.total_revenue, 0),
    total_cost:       rows.reduce((s, r) => s + r.total_cost, 0),
    total_net_profit: rows.reduce((s, r) => s + r.net_profit, 0),
  };
}

// ── Mileage CRUD ────────────────────────────────────────────────

export async function createMileageTransaction(
  data: Omit<MileageTransaction, 'id' | 'created_at'>
): Promise<MileageTransaction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('mileage_transactions')
    .insert(data as never)
    .select()
    .single();
  if (error) { console.error('createMileageTransaction', error); return null; }
  return row as MileageTransaction;
}

/** 고객 마일리지 잔액 (SUM of amount) */
export async function getMileageBalance(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  // customer_mileage_balances View 사용
  const { data } = await sb
    .from('customer_mileage_balances')
    .select('balance')
    .eq('user_id', userId)
    .single();
  return (data as { balance: number } | null)?.balance ?? 0;
}

/** booking_id 기준 EARNED 트랜잭션 조회 (CLAWBACK 대상 확인용) */
export async function getEarnedMileageByBooking(
  bookingId: string
): Promise<MileageTransaction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('mileage_transactions')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('type', 'EARNED');
  return (data ?? []) as MileageTransaction[];
}

/** 고객 마일리지 거래 내역 */
export async function getMileageHistory(
  userId: string,
  limit = 20
): Promise<MileageTransaction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('mileage_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as MileageTransaction[];
}
