/**
 * travel-providers/yeosonam.ts — Phase 2 Skeleton
 *
 * 여소남 자체 상품(travel_packages 테이블)을 TravelProvider로 래핑.
 * Phase 2에서 직판 상품이 생기면 이 provider를 통해 aggregator에 자동 포함.
 *
 * createBooking = 기존 /api/bookings 예약 시스템으로 라우팅.
 */

import type {
  TravelProvider,
  FlightSearchParams,
  FlightResult,
  StaySearchParams,
  StayResult,
  ActivitySearchParams,
  ActivityResult,
  CartItem,
  CustomerInfo,
  ProviderBookingResult,
} from './types';

export const yeosonamProvider: TravelProvider = {
  name: 'yeosonam',
  displayName: '여소남',
  supports: ['flight', 'hotel', 'activity'],

  async searchFlights(_params: FlightSearchParams): Promise<FlightResult[]> {
    // TODO Phase 2: travel_packages 직판 항공편 조회
    return [];
  },

  async searchStays(_params: StaySearchParams): Promise<StayResult[]> {
    // TODO Phase 2: travel_packages 직판 숙박 조회
    return [];
  },

  async searchActivities(_params: ActivitySearchParams): Promise<ActivityResult[]> {
    // TODO Phase 2: travel_packages 액티비티 조회
    return [];
  },

  async createBooking(item: CartItem, customer: CustomerInfo): Promise<ProviderBookingResult> {
    // TODO Phase 2: 기존 /api/bookings로 라우팅
    void item; void customer;
    return {
      providerBookingId: '',
      status: 'failed',
    };
  },

  async cancelBooking(_providerBookingId: string): Promise<{ success: boolean; message?: string }> {
    // TODO Phase 2: 기존 예약 취소 API로 라우팅
    return { success: false, message: 'Phase 2에서 활성화됩니다.' };
  },
};
