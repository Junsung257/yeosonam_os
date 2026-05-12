/**
 * travel-providers/types.ts
 *
 * 여소남 Multi-OTA 공통 인터페이스.
 * MRT, 아고다, 호텔스닷컴, 여소남 직접 상품 등 모든 공급자가 이 인터페이스를 구현.
 * 공급자 교체 시 이 파일과 해당 provider 파일만 수정하면 됨.
 */

export type ProviderName = 'mrt' | 'agoda' | 'hotels_com' | 'yeosonam';

// ─── 검색 파라미터 ────────────────────────────────────────────────────────────

export interface FlightSearchParams {
  departure: string;    // IATA 코드: 'PUS', 'ICN', 'GMP'
  destination: string;  // IATA 코드: 'DAD', 'BKK', 'NRT'
  dateFrom: string;     // 'YYYY-MM-DD'
  dateTo?: string;      // 왕복 시 귀국일
  adults: number;
  children?: number;
  infants?: number;
  tripType?: 'OW' | 'RT'; // 편도 | 왕복 (기본: OW)
  cabinClass?: 'ECONOMY' | 'BUSINESS' | 'FIRST';
  signal?: AbortSignal; // 타임아웃 시 aggregator가 주입, provider는 fetch에 전달
}

export interface StaySearchParams {
  destination: string; // 도시명: '다낭', '방콕' (MRT MCP는 한국어 OK)
  checkIn: string;     // 'YYYY-MM-DD'
  checkOut: string;    // 'YYYY-MM-DD'
  adults: number;
  children?: number;
  rooms?: number;
  signal?: AbortSignal;
}

export interface ActivitySearchParams {
  destination: string;
  category?: string;   // 'family' | 'adventure' | 'culture' | 'ticket'
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  signal?: AbortSignal;
}

// ─── 검색 결과 ────────────────────────────────────────────────────────────────

export interface FlightResult {
  providerId: string;
  provider: ProviderName;
  providerUrl: string;
  airline: string;
  flightCode?: string;
  departure: { airport: string; datetime: string };
  arrival: { airport: string; datetime: string };
  price: number;       // KRW
  currency: 'KRW';
  seatClass?: string;
  affiliateLink?: string;       // mylink 등 추적 가능 URL (Phase 0)
  bookableViaYeosonam: boolean; // Phase 1 이후 직접 예약 지원 여부
}

export interface StayResult {
  providerId: string;
  provider: ProviderName;
  providerUrl: string;
  name: string;
  rating?: number;       // 0~5
  reviewCount?: number;
  pricePerNight: number; // KRW
  totalPrice?: number;   // 전체 숙박 기간 합산
  currency: 'KRW';
  amenities?: string[];
  location?: string;
  imageUrl?: string;
  affiliateLink?: string;
  bookableViaYeosonam: boolean;
}

export interface ActivityResult {
  providerId: string;
  provider: ProviderName;
  providerUrl: string;
  name: string;
  category?: string;
  price: number;        // KRW, 1인 기준
  currency: 'KRW';
  duration?: string;    // '3시간', '반일', '종일'
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  affiliateLink?: string;
  bookableViaYeosonam: boolean;
}

// ─── 예약 (Phase 1) ───────────────────────────────────────────────────────────

export interface CartItem {
  id: string; // 여소남 내부 UUID
  type: 'flight' | 'hotel' | 'activity';
  provider: ProviderName;
  providerId: string;
  providerUrl: string;
  name: string;
  price: number;        // KRW
  affiliateLink?: string;
  dateFrom: string;
  dateTo?: string;
  quantity: number;
  details?: Record<string, unknown>;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface ProviderBookingResult {
  providerBookingId: string;
  status: 'confirmed' | 'pending' | 'failed';
  confirmationNumber?: string;
  details?: Record<string, unknown>;
}

export interface CancelResult {
  success: boolean;
  refundAmount?: number;
  message?: string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

// ─── Provider 공통 인터페이스 ─────────────────────────────────────────────────

export interface TravelProvider {
  name: ProviderName;
  displayName: string;
  supports: ('flight' | 'hotel' | 'activity')[];

  // 검색 (Phase 0+)
  searchFlights(params: FlightSearchParams): Promise<FlightResult[]>;
  searchStays(params: StaySearchParams): Promise<StayResult[]>;
  searchActivities(params: ActivitySearchParams): Promise<ActivityResult[]>;

  // 어필리에이트 링크 생성 (Phase 0 redirect)
  createAffiliateLink?(targetUrl: string): Promise<string>;

  // 예약/취소 (Phase 1+, optional)
  createBooking?(item: CartItem, customer: CustomerInfo): Promise<ProviderBookingResult>;
  cancelBooking?(providerBookingId: string, reason?: string): Promise<CancelResult>;
  getBookingStatus?(providerBookingId: string): Promise<BookingStatus>;
}

// ─── Aggregator 결과 ─────────────────────────────────────────────────────────

export interface AggregatedResults {
  flights: FlightResult[];
  hotels: StayResult[];
  activities: ActivityResult[];
  providersQueried: ProviderName[];
  providerErrors: { provider: ProviderName; error: string }[];
  searchDurationMs: number;
}

// ─── 자유여행 일정표 (AI 조합 결과) ──────────────────────────────────────────

export interface FreeTravelItinerary {
  sessionId: string;
  destination: string;
  departure: string;
  dateFrom: string;
  dateTo: string;
  nights: number;
  pax: { adults: number; children: number };

  recommendedFlight: FlightResult | null;
  alternativeFlights: FlightResult[];

  recommendedHotel: StayResult | null;
  alternativeHotels: StayResult[];

  activities: ActivityResult[];

  totalEstimateMin: number; // 최저가 조합
  totalEstimateMax: number; // 최고가 조합

  aiSummary: string; // Gemini 생성 자유여행 코멘트

  // Decoy: 여소남 패키지 비교
  packageComparison: {
    available: boolean;
    packages: Array<{
      id: string;
      title: string;
      price: number;
      highlights: string[];
      savings: number; // 자유여행 최저 견적 대비 절약액
    }>;
    message: string;
  };

  expiresAt: string; // ISO timestamp (검색 후 15분, Phase 1 예약 유효성 검사용)
}
