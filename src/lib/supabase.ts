import { createClient } from '@supabase/supabase-js';
import type { CartItem } from './db/concierge';

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
