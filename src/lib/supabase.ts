import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CartItem } from './db/concierge';
import { getSecret } from '@/lib/secret-registry';

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

// Next.js 클라이언트 번들링: process.env.NEXT_PUBLIC_* 는 정적 참조여야 inline됨.
// getSecret() 의 동적 인덱싱(process.env[key])은 client bundle 에서 undefined 가 되어
// /m/admin/* 등 client 컴포넌트가 "Supabase가 구성되지 않았습니다" 로 크래시한다.
// 정적 참조(↓) 를 우선 사용하고 server-only 키는 getSecret 으로 보강.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  getSecret('SUPABASE_URL');
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  getSecret('SUPABASE_ANON_KEY');
const supabaseServiceKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');

function isValidUrl(url?: string | null): url is string {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

export const isSupabaseConfigured = Boolean(
  isValidUrl(supabaseUrl) && supabaseKey && !supabaseUrl?.includes('your_supabase_url')
);

export const isSupabaseAdminConfigured = Boolean(
  isValidUrl(supabaseUrl) && supabaseServiceKey && !supabaseUrl?.includes('your_supabase_url')
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
    if (!isSupabaseAdminConfigured || !supabaseServiceKey) return null;
    try {
      supabaseAdminClient = createClient(supabaseUrl!, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch {
      supabaseAdminClient = null;
      return null;
    }
  }
  return supabaseAdminClient;
}

/**
 * Supabase Admin 클라이언트 프록시.
 *
 * 기존에는 `as any`로 선언되어 모든 체인 호출이 any 타입이었으나,
 * 실제 SupabaseClient 타입을 보존하도록 개선.
 * `.from()` / `.rpc()` / `.storage` / `.auth` 모두 정식 타입 유지.
 *
 * 사용 예:
 *   const { data } = await supabaseAdmin.from('customers').select('id').single();
 *   // data는 이제 unknown → 사용처에서 as T로 캐스팅 필요
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for supabaseAdmin');
    const value = client[prop as keyof typeof client];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// Auth 전용 - 실제 클라이언트 인스턴스 반환 (login 페이지에서 사용)
export function getSupabaseClient() {
  const client = getSupabase();
  if (!client) throw new Error('Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요.');
  return client;
}

// 이전 호환성을 위한 getter — anon 클라이언트 (public)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    if (!client) throw new Error('Supabase가 구성되지 않았습니다. 환경 변수를 확인하세요.');
    const value = client[prop as keyof typeof client];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

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

// ─── 패키지 함수들은 ./db/packages.ts 로 분리 — re-export ──
export {
  getPagedPackages, getApprovedPackages, getPendingPackages,
  approvePackage, getPackageById, calculateMargin,
} from './db/packages';

// ─── CRM 함수들은 ./db/customers.ts 로 분리 ─────────────
export {
  getCustomers, getCustomerById, upsertCustomer,
  findOrCreateCustomerByPhone, findDuplicateCustomers,
  deleteCustomer, restoreCustomer,
} from './db/customers';

// ─── 예약 함수들은 ./db/bookings.ts 로 분리 ─────────────
export {
  getBookings, getBookingById, createBooking,
  updateBookingStatus, updateBooking, voidBooking,
} from './db/bookings';

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

// Booking Void 연쇄 처리는 ./db/bookings.ts 로 분리

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
export type { SecureChat, Voucher, VoucherWithCustomerPhone } from './db/voucher';

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

// ─── 문의/QA 함수들은 ./db/inquiry.ts 로 분리 ─────────────
export {
  saveInquiry, getInquiries, saveAIResponse,
} from './db/inquiry';
