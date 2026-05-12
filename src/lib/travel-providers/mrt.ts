/**
 * travel-providers/mrt.ts
 *
 * 마이리얼트립 Phase 0 구현.
 * - 검색: MRT MCP HTTP (JSON-RPC 2.0) — 인증 불필요
 * - 어필리에이트 링크: MRT Partner API POST /v1/mylink — Bearer 인증
 * - 예약/취소: Phase 1 (MRT RESERVATIONS:WRITE 권한 승인 후)
 *
 * MRT MCP 응답 스키마는 런타임 전까지 불확실 → Zod 방어 파싱 강제.
 */

import { z } from 'zod';
import { getSecret } from '@/lib/secret-registry';
import type {
  TravelProvider,
  FlightSearchParams,
  FlightResult,
  StaySearchParams,
  StayResult,
  ActivitySearchParams,
  ActivityResult,
} from './types';

// ─── 환경 변수 ────────────────────────────────────────────────────────────────

const MCP_URL   = 'https://mcp-servers.myrealtrip.com/mcp';
const API_URL   = 'https://partner-ext-api.myrealtrip.com';
const API_KEY   = getSecret('MYREALTRIP_API_KEY') ?? '';
const MYLINK_ID = getSecret('MYREALTRIP_MYLINK_ID') ?? '';

// ─── MCP JSON-RPC 헬퍼 ───────────────────────────────────────────────────────

let _rpcId = 1;

async function mcpCall<T>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 5000,
  externalSignal?: AbortSignal,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 외부 signal(aggregator 타임아웃)이 abort되면 내부 fetch도 즉시 취소
  externalSignal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: _rpcId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    if (!res.ok) return null;
    const json = await res.json() as { result?: { content?: { text?: string }[] }; error?: unknown };

    if (json.error) return null;

    // MRT MCP wraps result in content[0].text as JSON string
    const text = json.result?.content?.[0]?.text;
    if (!text) return null;

    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Zod 방어 스키마 ─────────────────────────────────────────────────────────

// 항공 검색 결과 — 실제 MRT MCP 응답 필드에 맞춰 느슨하게 정의
const MrtFlightItemSchema = z.object({
  id:            z.union([z.string(), z.number()]).transform(String),
  airline:       z.string().optional().default(''),
  flightNumber:  z.string().optional(),
  departureAirport: z.string().optional().default(''),
  arrivalAirport:   z.string().optional().default(''),
  departureTime: z.string().optional().default(''),
  arrivalTime:   z.string().optional().default(''),
  price:         z.number().optional().default(0),
  currency:      z.string().optional().default('KRW'),
  seatClass:     z.string().optional(),
  url:           z.string().optional().default(''),
}).passthrough();

const MrtFlightListSchema = z.object({
  items: z.array(MrtFlightItemSchema).optional().default([]),
}).or(z.array(MrtFlightItemSchema).transform(items => ({ items })));

// 숙소 검색 결과 (MRT searchStays 응답 — gid·thumbnailUrl·link 등 실제 필드명 수용)
const MrtStayItemSchema = z.object({
  id:             z.union([z.string(), z.number()]).transform(String).optional(),
  gid:            z.union([z.string(), z.number()]).transform(String).optional(),
  name:           z.string().optional().default(''),
  rating:         z.number().optional(),
  reviewRating:   z.number().optional(),
  reviewCount:    z.number().optional(),
  reviewRatingCount: z.number().optional(),
  pricePerNight:  z.number().optional().default(0),
  minPrice:       z.number().optional(),
  totalPrice:     z.number().optional(),
  currency:       z.string().optional().default('KRW'),
  amenities:      z.array(z.string()).optional(),
  location:       z.string().optional(),
  address:        z.string().optional(),
  imageUrl:       z.string().optional(),
  thumbnailUrl:   z.string().optional(),
  url:            z.string().optional().default(''),
  link:           z.string().optional(),
}).passthrough();

const MrtStayListSchema = z.object({
  items: z.array(MrtStayItemSchema).optional().default([]),
  stays: z.array(MrtStayItemSchema).optional(),
  results: z.array(MrtStayItemSchema).optional(),
}).or(z.array(MrtStayItemSchema).transform(items => ({ items })));

// 액티비티 검색 결과 (MRT searchTnas 응답 — title·gid·thumbnailUrl 등 실제 필드명 수용)
const MrtActivityItemSchema = z.object({
  id:           z.union([z.string(), z.number()]).transform(String).optional(),
  gid:          z.union([z.string(), z.number()]).transform(String).optional(),
  name:         z.string().optional().default(''),
  title:        z.string().optional(),
  category:     z.string().optional(),
  price:        z.number().optional().default(0),
  minPrice:     z.number().optional(),
  currency:     z.string().optional().default('KRW'),
  duration:     z.string().optional(),
  rating:       z.number().optional(),
  reviewScore:  z.number().optional(),
  reviewCount:  z.number().optional(),
  imageUrl:     z.string().optional(),
  thumbnailUrl: z.string().optional(),
  url:          z.string().optional().default(''),
  link:         z.string().optional(),
}).passthrough();

const MrtActivityListSchema = z.object({
  items:    z.array(MrtActivityItemSchema).optional().default([]),
  tnas:     z.array(MrtActivityItemSchema).optional(),
  products: z.array(MrtActivityItemSchema).optional(),
  results:  z.array(MrtActivityItemSchema).optional(),
}).or(z.array(MrtActivityItemSchema).transform(items => ({ items })));

// ─── Flight Schedule 조회 ────────────────────────────────────────────────────

export interface FlightScheduleResult {
  flightCode:    string;
  airline:       string;
  departure:     { airport: string; datetime: string };
  arrival:       { airport: string; datetime: string };
  price:         number;
  currency:      string;
  providerUrl?:  string;
}

/**
 * 특정 노선의 항공 스케줄 조회 (실시간 — MRT MCP searchInternationalFlights).
 * flightNo 지정 시 편명 매칭 우선; 없으면 최저가 순 첫 번째 반환.
 * 랜드사 상품의 항공 헤더 정보 최신화에 사용.
 */
export async function getFlightSchedule(
  departure: string,
  destination: string,
  date: string,
  flightNo?: string,
): Promise<FlightScheduleResult | null> {
  const raw = await mcpCall<unknown>('searchInternationalFlights', {
    departure,
    destination,
    departureDate: date,
    adults:       1,
    tripType:     'OW',
    cabinClass:   'ECONOMY',
  }, 6000);

  if (!raw) return null;

  const parsed = MrtFlightListSchema.safeParse(raw);
  if (!parsed.success || parsed.data.items.length === 0) return null;

  const items = parsed.data.items;
  const match = flightNo
    ? (items.find(i => i.flightNumber === flightNo) ?? items[0])
    : items[0];

  if (!match) return null;

  return {
    flightCode:  match.flightNumber ?? match.id,
    airline:     match.airline,
    departure:   { airport: match.departureAirport, datetime: match.departureTime },
    arrival:     { airport: match.arrivalAirport,   datetime: match.arrivalTime   },
    price:       match.price,
    currency:    'KRW',
    providerUrl: match.url,
  };
}

// ─── Fare Calendar 스키마 ────────────────────────────────────────────────────

export interface FareCalendarEntry {
  date:     string;   // YYYY-MM-DD
  price:    number;
  currency: string;
}

const FareCalendarItemSchema = z.object({
  date:     z.union([z.string(), z.number()]).transform(String),
  price:    z.number().optional().default(0),
  currency: z.string().optional().default('KRW'),
}).passthrough();

const FareCalendarSchema = z.object({
  fares:   z.array(FareCalendarItemSchema).optional().default([]),
  items:   z.array(FareCalendarItemSchema).optional().default([]),
  results: z.array(FareCalendarItemSchema).optional().default([]),
}).or(z.array(FareCalendarItemSchema).transform(arr => ({ fares: arr, items: [], results: [] })));

export async function getFareCalendar(
  from: string,
  to: string,
  departureDate: string,
  periodNights = 4,
  maxResults = 90,
): Promise<FareCalendarEntry[]> {
  const raw = await mcpCall<unknown>('flightsFareCalendar', {
    from,
    to,
    departureDate,
    period:        periodNights,
    international: true,
    maxResults,
    airlines:      ['*'],
    transfer:      0,
  }, 8000);

  if (!raw) return [];

  const parsed = FareCalendarSchema.safeParse(raw);
  if (!parsed.success) return [];

  const data = parsed.data as { fares: typeof FareCalendarItemSchema._type[]; items: typeof FareCalendarItemSchema._type[]; results: typeof FareCalendarItemSchema._type[] };
  const entries = data.fares.length > 0 ? data.fares
    : data.items.length > 0 ? data.items
    : data.results;

  return entries
    .map(e => ({
      date:     String(e.date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
      price:    e.price ?? 0,
      currency: (e.currency as string | undefined) ?? 'KRW',
    }))
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.price > 0);
}

// ─── 숙소 상세 조회 (getStayDetail) ─────────────────────────────────────────

export interface StayDetailResult {
  gid:                string;
  name:               string;
  description?:       string;
  rating?:            number;
  reviewCount?:       number;
  address?:           string;
  amenities?:         string[];
  rooms?:             { name: string; price: number; capacity: string }[];
  images?:            string[];
  checkInTime?:       string;
  checkOutTime?:      string;
  cancellationPolicy?: string;
  providerUrl?:       string;
}

const StayRoomSchema = z.object({
  name:     z.string().optional().default(''),
  price:    z.number().optional().default(0),
  capacity: z.union([z.string(), z.number()]).transform(String).optional().default(''),
}).passthrough();

const StayDetailSchema = z.object({
  gid:                z.union([z.string(), z.number()]).transform(String).optional(),
  id:                 z.union([z.string(), z.number()]).transform(String).optional(),
  name:               z.string().optional().default(''),
  description:        z.string().optional(),
  rating:             z.number().optional(),
  reviewRating:       z.number().optional(),
  reviewCount:        z.number().optional(),
  reviewRatingCount:  z.number().optional(),
  address:            z.string().optional(),
  amenities:          z.array(z.string()).optional(),
  rooms:              z.array(StayRoomSchema).optional(),
  images:             z.array(z.string()).optional(),
  photos:             z.array(z.string()).optional(),
  checkInTime:        z.string().optional(),
  checkOutTime:       z.string().optional(),
  cancellationPolicy: z.string().optional(),
  url:                z.string().optional(),
  link:               z.string().optional(),
}).passthrough();

export async function getStayDetail(
  gid: number | string,
  checkIn: string,
  checkOut: string,
  adults = 2,
  children = 0,
): Promise<StayDetailResult | null> {
  const raw = await mcpCall<unknown>('getStayDetail', {
    gid:        Number(gid),
    checkIn,
    checkOut,
    adultCount: adults,
    childCount: children,
  }, 8000);

  if (!raw) return null;

  const parsed = StayDetailSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;

  return {
    gid:                String(d.gid ?? d.id ?? gid),
    name:               d.name,
    description:        d.description,
    rating:             d.reviewRating ?? d.rating,
    reviewCount:        d.reviewRatingCount ?? d.reviewCount,
    address:            d.address,
    amenities:          d.amenities,
    rooms:              d.rooms?.map(r => ({
      name:     r.name ?? '',
      price:    r.price ?? 0,
      capacity: r.capacity ?? '',
    })),
    images:             d.images ?? d.photos,
    checkInTime:        d.checkInTime,
    checkOutTime:       d.checkOutTime,
    cancellationPolicy: d.cancellationPolicy,
    providerUrl:        d.url ?? d.link,
  };
}

// ─── 투어/액티비티 상세 조회 (getTnaDetail) ──────────────────────────────────

export interface TnaDetailResult {
  gid:          string;
  name:         string;
  description?: string;
  category?:    string;
  rating?:      number;
  reviewCount?: number;
  duration?:    string;
  includes?:    string[];
  excludes?:    string[];
  itinerary?:   string[];
  meetingPoint?: string;
  minPrice?:    number;
  currency?:    string;
  providerUrl?: string;
}

const TnaDetailSchema = z.object({
  gid:          z.union([z.string(), z.number()]).transform(String).optional(),
  id:           z.union([z.string(), z.number()]).transform(String).optional(),
  name:         z.string().optional(),
  title:        z.string().optional(),
  description:  z.string().optional(),
  category:     z.string().optional(),
  rating:       z.number().optional(),
  reviewScore:  z.number().optional(),
  reviewCount:  z.number().optional(),
  duration:     z.string().optional(),
  includes:     z.array(z.string()).optional(),
  inclusions:   z.array(z.string()).optional(),
  excludes:     z.array(z.string()).optional(),
  exclusions:   z.array(z.string()).optional(),
  itinerary:    z.array(z.string()).optional(),
  schedule:     z.array(z.string()).optional(),
  meetingPoint: z.string().optional(),
  minPrice:     z.number().optional(),
  price:        z.number().optional(),
  currency:     z.string().optional(),
  url:          z.string().optional(),
  link:         z.string().optional(),
}).passthrough();

export async function getTnaDetail(
  gid: string,
  url: string,
): Promise<TnaDetailResult | null> {
  const raw = await mcpCall<unknown>('getTnaDetail', { gid, url }, 8000);
  if (!raw) return null;

  const parsed = TnaDetailSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;

  return {
    gid:          String(d.gid ?? d.id ?? gid),
    name:         d.title ?? d.name ?? '',
    description:  d.description,
    category:     d.category,
    rating:       d.reviewScore ?? d.rating,
    reviewCount:  d.reviewCount,
    duration:     d.duration,
    includes:     d.includes ?? d.inclusions,
    excludes:     d.excludes ?? d.exclusions,
    itinerary:    d.itinerary ?? d.schedule,
    meetingPoint: d.meetingPoint,
    minPrice:     d.minPrice ?? d.price,
    currency:     d.currency ?? 'KRW',
    providerUrl:  d.url ?? d.link ?? url,
  };
}

// ─── 투어/액티비티 옵션 조회 (getTnaOptions) ─────────────────────────────────

export interface TnaOption {
  optionId:    string;
  name:        string;
  price:       number;
  adultPrice?: number;
  childPrice?: number;
  available?:  boolean;
  stock?:      number;
  currency?:   string;
}

const TnaOptionItemSchema = z.object({
  id:          z.union([z.string(), z.number()]).transform(String).optional(),
  optionId:    z.union([z.string(), z.number()]).transform(String).optional(),
  name:        z.string().optional().default(''),
  title:       z.string().optional(),
  price:       z.number().optional().default(0),
  adultPrice:  z.number().optional(),
  childPrice:  z.number().optional(),
  available:   z.boolean().optional(),
  stock:       z.number().optional(),
  currency:    z.string().optional(),
}).passthrough();

const TnaOptionsSchema = z.object({
  items:   z.array(TnaOptionItemSchema).optional().default([]),
  options: z.array(TnaOptionItemSchema).optional().default([]),
}).or(z.array(TnaOptionItemSchema).transform(items => ({ items, options: [] })));

export async function getTnaOptions(
  gid: string,
  url: string,
  selectedDate: string,
): Promise<TnaOption[]> {
  const raw = await mcpCall<unknown>('getTnaOptions', { gid, url, selectedDate }, 8000);
  if (!raw) return [];

  const parsed = TnaOptionsSchema.safeParse(raw);
  if (!parsed.success) return [];

  const list = parsed.data.items.length > 0
    ? parsed.data.items
    : parsed.data.options ?? [];

  return list.map(o => {
    const r = o as Record<string, unknown>;
    return {
      optionId:   String(r.optionId ?? r.id ?? ''),
      name:       String(r.title ?? r.name ?? ''),
      price:      Number(r.price ?? 0),
      adultPrice: r.adultPrice as number | undefined,
      childPrice: r.childPrice as number | undefined,
      available:  r.available as boolean | undefined,
      stock:      r.stock as number | undefined,
      currency:   (r.currency as string | undefined) ?? 'KRW',
    };
  });
}

// ─── 프로모션 항공사 조회 (getPromotionAirlines) ─────────────────────────────

export interface PromotionAirline {
  airline:      string;
  iata?:        string;
  discountRate?: number;
  validUntil?:  string;
  providerUrl?: string;
  imageUrl?:    string;
}

const PromotionAirlineItemSchema = z.object({
  airline:      z.string().optional(),
  name:         z.string().optional(),
  iata:         z.string().optional(),
  code:         z.string().optional(),
  discountRate: z.number().optional(),
  discount:     z.number().optional(),
  validUntil:   z.string().optional(),
  expiresAt:    z.string().optional(),
  url:          z.string().optional(),
  link:         z.string().optional(),
  imageUrl:     z.string().optional(),
  logoUrl:      z.string().optional(),
}).passthrough();

const PromotionAirlinesSchema = z.object({
  airlines:   z.array(PromotionAirlineItemSchema).optional().default([]),
  items:      z.array(PromotionAirlineItemSchema).optional().default([]),
  promotions: z.array(PromotionAirlineItemSchema).optional().default([]),
}).or(z.array(PromotionAirlineItemSchema).transform(items => ({ airlines: items, items: [], promotions: [] })));

export async function getPromotionAirlines(): Promise<PromotionAirline[]> {
  const raw = await mcpCall<unknown>('getPromotionAirlines', {}, 6000);
  if (!raw) return [];

  const parsed = PromotionAirlinesSchema.safeParse(raw);
  if (!parsed.success) return [];

  const data = parsed.data as { airlines: unknown[]; items: unknown[]; promotions: unknown[] };
  const list = data.airlines.length > 0 ? data.airlines
    : data.items.length > 0 ? data.items
    : data.promotions;

  return (list as Record<string, unknown>[]).map(r => ({
    airline:      String(r.name ?? r.airline ?? ''),
    iata:         (r.iata ?? r.code) as string | undefined,
    discountRate: (r.discountRate ?? r.discount) as number | undefined,
    validUntil:   (r.validUntil ?? r.expiresAt) as string | undefined,
    providerUrl:  (r.url ?? r.link) as string | undefined,
    imageUrl:     (r.logoUrl ?? r.imageUrl) as string | undefined,
  }));
}

// ─── 카테고리 목록 조회 (getCategoryList) ────────────────────────────────────

export interface TnaCategory {
  id:     string;
  name:   string;
  count?: number;
}

const TnaCategoryItemSchema = z.object({
  id:    z.union([z.string(), z.number()]).transform(String).optional(),
  name:  z.string().optional().default(''),
  label: z.string().optional(),
  count: z.number().optional(),
}).passthrough();

const TnaCategoryListSchema = z.object({
  categories: z.array(TnaCategoryItemSchema).optional().default([]),
  items:      z.array(TnaCategoryItemSchema).optional().default([]),
}).or(z.array(TnaCategoryItemSchema).transform(items => ({ categories: items, items: [] })));

export async function getCategoryList(city: string): Promise<TnaCategory[]> {
  const raw = await mcpCall<unknown>('getCategoryList', { city }, 6000);
  if (!raw) return [];

  const parsed = TnaCategoryListSchema.safeParse(raw);
  if (!parsed.success) return [];

  const data = parsed.data as { categories: unknown[]; items: unknown[] };
  const list = data.categories.length > 0 ? data.categories : data.items;

  return (list as Record<string, unknown>[]).map((r, idx) => ({
    id:    String(r.id ?? idx),
    name:  String(r.label ?? r.name ?? ''),
    count: r.count as number | undefined,
  }));
}

// ─── 어필리에이트 링크 생성 ──────────────────────────────────────────────────
// MRT 공식 방식: URL에 ?mylink_id=xxx&utm_content=yyy 파라미터만 추가 (API 호출 불필요)
// utm_content = 세션 ID (클릭별 전환 추적용)

export function buildMylinkUrl(targetUrl: string, utmContent?: string): string {
  if (!MYLINK_ID || !targetUrl) return targetUrl;
  const sep = targetUrl.includes('?') ? '&' : '?';
  const utm = utmContent ? `&utm_content=${encodeURIComponent(utmContent)}` : '';
  return `${targetUrl}${sep}mylink_id=${MYLINK_ID}${utm}`;
}

// shortlink 생성 (선택 사항 — 단축 URL 필요 시만 호출)
export async function createShortMylink(targetUrl: string, utmContent?: string): Promise<string> {
  const longUrl = buildMylinkUrl(targetUrl, utmContent);
  if (!API_KEY) return longUrl;
  try {
    const res = await fetch(`${API_URL}/v1/mylink`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: longUrl }),
    });
    if (!res.ok) return longUrl;
    const data = await res.json() as { shortUrl?: string; url?: string };
    return data.shortUrl ?? data.url ?? longUrl;
  } catch {
    return longUrl;
  }
}

// ─── MRT Provider 구현 ───────────────────────────────────────────────────────

export const mrtProvider: TravelProvider = {
  name: 'mrt',
  displayName: '마이리얼트립',
  supports: ['flight', 'hotel', 'activity'],

  async searchFlights(params: FlightSearchParams): Promise<FlightResult[]> {
    const raw = await mcpCall<unknown>('searchInternationalFlights', {
      departure:   params.departure,
      destination: params.destination,
      departureDate: params.dateFrom,
      returnDate:  params.dateTo,
      adults:      params.adults,
      children:    params.children ?? 0,
      infants:     params.infants  ?? 0,
      tripType:    params.tripType ?? 'OW',
      cabinClass:  params.cabinClass ?? 'ECONOMY',
    }, 5000, params.signal);

    if (!raw) return [];

    const parsed = MrtFlightListSchema.safeParse(raw);
    if (!parsed.success) return [];

    return parsed.data.items.map(item => ({
      providerId:           item.id,
      provider:             'mrt' as const,
      providerUrl:          item.url,
      airline:              item.airline,
      flightCode:           item.flightNumber,
      departure: {
        airport:   item.departureAirport,
        datetime:  item.departureTime,
      },
      arrival: {
        airport:   item.arrivalAirport,
        datetime:  item.arrivalTime,
      },
      price:                item.price,
      currency:             'KRW' as const,
      seatClass:            item.seatClass,
      bookableViaYeosonam:  false,
    }));
  },

  async searchStays(params: StaySearchParams): Promise<StayResult[]> {
    // MRT MCP 도구명: searchStays (searchHotels X)
    // 파라미터: keyword(목적지), adultCount, childCount, isDomestic
    const raw = await mcpCall<unknown>('searchStays', {
      keyword:    params.destination,
      checkIn:    params.checkIn,
      checkOut:   params.checkOut,
      adultCount: params.adults,
      childCount: params.children ?? 0,
      isDomestic: false,
    }, 5000, params.signal);

    if (!raw) return [];

    const parsed = MrtStayListSchema.safeParse(raw);
    if (!parsed.success) return [];

    // MRT 응답 필드 정규화 (gid/id, thumbnailUrl/imageUrl, link/url, minPrice/pricePerNight 등)
    const rawItems = parsed.data.items.length > 0
      ? parsed.data.items
      : ((parsed.data as Record<string, unknown>).stays as typeof parsed.data.items | undefined)
          ?? ((parsed.data as Record<string, unknown>).results as typeof parsed.data.items | undefined)
          ?? [];

    return rawItems.map(item => {
      const r = item as Record<string, unknown>;
      return {
        providerId:          String(r.gid ?? r.id ?? ''),
        provider:            'mrt' as const,
        providerUrl:         String(r.link ?? r.url ?? ''),
        name:                String(r.name ?? ''),
        rating:              (r.reviewRating ?? r.rating) as number | undefined,
        reviewCount:         (r.reviewRatingCount ?? r.reviewCount) as number | undefined,
        pricePerNight:       Number(r.minPrice ?? r.pricePerNight ?? 0),
        totalPrice:          r.totalPrice as number | undefined,
        currency:            'KRW' as const,
        amenities:           r.amenities as string[] | undefined,
        location:            String(r.address ?? r.location ?? ''),
        imageUrl:            String(r.thumbnailUrl ?? r.imageUrl ?? ''),
        bookableViaYeosonam: false,
      };
    });
  },

  async searchActivities(params: ActivitySearchParams): Promise<ActivityResult[]> {
    // MRT MCP 도구명: searchTnas (searchActivities X)
    // 파라미터: query(검색어), perPage
    const raw = await mcpCall<unknown>('searchTnas', {
      query:   params.destination,
      perPage: params.limit ?? 20,
      ...(params.category ? { category: params.category } : {}),
    }, 5000, params.signal);

    if (!raw) return [];

    const parsed = MrtActivityListSchema.safeParse(raw);
    if (!parsed.success) return [];

    // MRT 응답 필드 정규화 (title/name, gid/id, thumbnailUrl/imageUrl, link/url 등)
    const rawItems = parsed.data.items.length > 0
      ? parsed.data.items
      : ((parsed.data as Record<string, unknown>).tnas as typeof parsed.data.items | undefined)
          ?? ((parsed.data as Record<string, unknown>).products as typeof parsed.data.items | undefined)
          ?? ((parsed.data as Record<string, unknown>).results as typeof parsed.data.items | undefined)
          ?? [];

    return rawItems.map(item => {
      const r = item as Record<string, unknown>;
      return {
        providerId:          String(r.gid ?? r.id ?? ''),
        provider:            'mrt' as const,
        providerUrl:         String(r.link ?? r.url ?? ''),
        name:                String(r.title ?? r.name ?? ''),
        category:            r.category as string | undefined,
        price:               Number(r.minPrice ?? r.price ?? 0),
        currency:            'KRW' as const,
        duration:            r.duration as string | undefined,
        rating:              (r.reviewScore ?? r.rating) as number | undefined,
        reviewCount:         r.reviewCount as number | undefined,
        imageUrl:            String(r.thumbnailUrl ?? r.imageUrl ?? ''),
        bookableViaYeosonam: false,
      };
    });
  },

  createAffiliateLink(targetUrl: string, utmContent?: string): Promise<string> {
    return Promise.resolve(buildMylinkUrl(targetUrl, utmContent));
  },

  // Phase 1 — MRT RESERVATIONS:WRITE 권한 승인 후 구현
  // createBooking, cancelBooking, getBookingStatus: 미구현
};
