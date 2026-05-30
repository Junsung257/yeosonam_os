/**
 * 여소남 OS — 패키지 DB 계층
 *
 * travel_packages 테이블 CRUD.
 * lib/supabase.ts 의 패키지 관련 함수를 분리한 모듈.
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// ── SELECT 상수 ──────────────────────────────────────────────

/** 목록·검색·자비스 도구 공통 — select('*') 대비 페이로드 절감 */
export const PACKAGE_LIST_SELECT = `
  id, title, destination, category, product_type, trip_style,
  departure_days, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_dates, excluded_dates, status, confidence, created_at,
  duration, nights,
  inclusions, excludes, guide_tip, single_supplement,
  small_group_surcharge, optional_tours, itinerary, special_notes,
  land_operator, product_tags, product_highlights, product_summary,
  audit_status, internal_code
`.replace(/\s+/g, ' ').trim();

// ── CRUD ─────────────────────────────────────────────────────

export async function saveTravelPackage(data: {
  title: string;
  destination: string;
  country?: string;
  category: string;
  product_type: string;
  trip_style?: string;
  duration?: number;
  nights?: number;
  departure_days?: string;
  departure_airport?: string;
  airline?: string;
  min_participants?: number;
  ticketing_deadline?: string;
  price?: number;
  price_tiers?: unknown;
  price_dates?: unknown;
  price_list?: unknown;
  excluded_dates?: unknown;
  confirmed_dates?: unknown;
  status?: string;
  internal_code?: string;
  land_operator?: string;
  commission_rate?: number;
  affiliate_commission_rate?: number;
  commission_fixed_amount?: number;
  commission_currency?: string;
  short_code?: string;
  seats_held?: number;
  seats_confirmed?: number;
  product_tags?: string[];
  product_highlights?: string[];
  product_summary?: string;
  itinerary?: unknown;
  inclusions?: string[];
  excludes?: string[];
  guide_tip?: string;
  single_supplement?: string;
  small_group_surcharge?: string;
  surcharges?: unknown;
  optional_tours?: unknown[];
  special_notes?: string;
  customer_notes?: string;
  internal_notes?: string;
  notices_parsed?: string[];
  cancellation_policy?: unknown;
  accommodations?: unknown;
  marketing_copies?: unknown;
  display_title?: string;
  hero_tagline?: string;
  data_completeness?: number;
  field_confidences?: unknown;
}): Promise<{ id: string } | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const insertPayload = { ...data };
    const { data: result, error } = await supabaseAdmin
      .from('travel_packages')
      .insert([insertPayload])
      .select('id')
      .single();
    if (error) throw error;
    return result;
  } catch (error) {
    console.error('패키지 저장 실패:', error);
    throw error;
  }
}

export async function updatePackage(id: string, data: Record<string, unknown>) {
  try {
    const { error } = await supabaseAdmin
      .from('travel_packages')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  } catch (error) {
    console.error('패키지 수정 실패:', error);
    throw error;
  }
}

export async function deletePackage(id: string) {
  try {
    // 감사 추적: soft delete 전에 audit_status 기록
    const { error: auditError } = await supabaseAdmin
      .from('travel_packages')
      .update({ audit_status: 'blocked', status: 'archived', deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (auditError) throw auditError;
  } catch (error) {
    console.error('패키지 삭제 실패:', error);
    throw error;
  }
}

// ── 조회 ─────────────────────────────────────────────────────

export async function getPagedPackages(filters?: {
  status?: string;
  category?: string;
  destination?: string;
  q?: string;
  page?: number;
  limit?: number;
  sort?: string;
  land_operator?: string;
}): Promise<{ data: unknown[]; count: number; totalPages: number }> {
  if (!isSupabaseConfigured) return { data: [], count: 0, totalPages: 0 };
  try {
    let query = supabaseAdmin
      .from('travel_packages')
      .select(PACKAGE_LIST_SELECT, { count: 'exact' });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.category) query = query.eq('category', filters.category);
    if (filters?.destination) query = query.ilike('destination', `%${filters.destination}%`);
    if (filters?.land_operator) query = query.eq('land_operator', filters.land_operator);
    if (filters?.q) {
      const q = filters.q.trim();
      if (q) {
        query = query.or(
          `title.ilike.%${q}%,internal_code.ilike.%${q}%,short_code.ilike.%${q}%`
        );
      }
    }

    // 정렬
    const sortMap: Record<string, string> = {
      created_desc: 'created_at.desc',
      created_asc: 'created_at.asc',
      price_asc: 'price.asc',
      price_desc: 'price.desc',
      title_asc: 'title.asc',
    };
    const sort = (filters?.sort && sortMap[filters.sort]) || 'created_at.desc';
    const [col, dir] = sort.split('.') as [string, 'asc' | 'desc'];
    query = query.order(col, { ascending: dir === 'asc' });

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) };
  } catch (error) {
    console.error('패키지 목록 조회 실패:', error);
    return { data: [], count: 0, totalPages: 0 };
  }
}

export async function getApprovedPackages(destination?: string, keyword?: string) {
  if (!isSupabaseConfigured) return [];
  try {
    let query = supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, category, price, price_dates, status, internal_code, short_code')
      .in('status', ['active', 'approved']);

    if (destination) query = query.eq('destination', destination);
    if (keyword) {
      query = query.or(
        `title.ilike.%${keyword}%,internal_code.ilike.%${keyword}%,short_code.ilike.%${keyword}%`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error('승인된 패키지 조회 실패:', error);
    return [];
  }
}

export async function getPendingPackages() {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('travel_packages')
      .select('*')
      .in('status', ['draft', 'review_needed'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error('대기 패키지 조회 실패:', error);
    return [];
  }
}

export async function approvePackage(packageId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('travel_packages')
      .update({
        status: 'approved',
        audit_status: 'passed',
        audit_checked_at: new Date().toISOString(),
        baseline_requested_at: new Date().toISOString(),
      })
      .eq('id', packageId)
      .select('id, short_code')
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('패키지 승인 실패:', error);
    throw error;
  }
}

// 특정 패키지 단건 조회
export async function getPackageById(id: string) {
  try {
    const { data, error } = await supabaseAdmin
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

// ── 마진 ─────────────────────────────────────────────────────

export async function calculateMargin(packageId: string, customerType: 'vip' | 'regular' | 'bulk') {
  try {
    const { data: marginData, error: marginError } = await supabaseAdmin
      .from('margin_settings')
      .select('*')
      .eq('package_id', packageId)
      .single();

    if (marginError) {
      console.warn('마진 설정 없음:', marginError);
      return null;
    }

    const { data: pkg, error: pkgError } = await supabaseAdmin
      .from('travel_packages')
      .select('price')
      .eq('id', packageId)
      .single();

    if (pkgError || !pkg) return null;

    const basePrice = pkg.price || 0;
    const marginRateMap: Record<string, number> = {
      vip: marginData.vip_margin_rate ?? 0.2,
      regular: marginData.regular_margin_rate ?? 0.15,
      bulk: marginData.bulk_margin_rate ?? 0.1,
    };
    const rate = marginRateMap[customerType] ?? 0.15;
    return Math.round(basePrice * rate);
  } catch (error) {
    console.error('마진 계산 실패:', error);
    return null;
  }
}

// ── getAdCampaigns / upsertCampaign 는 ./ads.ts 로 분리되어 있음 ──
