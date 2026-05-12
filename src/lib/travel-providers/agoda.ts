/**
 * travel-providers/agoda.ts — Phase 1 Skeleton
 *
 * 아고다 Affiliate API 파트너 신청 후 구현 예정.
 * 현재 모든 메서드는 빈 배열 반환 (aggregator에서 graceful degradation).
 */

import type {
  TravelProvider,
  FlightSearchParams,
  FlightResult,
  StaySearchParams,
  StayResult,
  ActivitySearchParams,
  ActivityResult,
} from './types';

export const agodaProvider: TravelProvider = {
  name: 'agoda',
  displayName: '아고다',
  supports: ['hotel'],

  async searchFlights(_params: FlightSearchParams): Promise<FlightResult[]> {
    return []; // 아고다는 항공 미지원
  },

  async searchStays(_params: StaySearchParams): Promise<StayResult[]> {
    // TODO Phase 1: Agoda Affiliate API 구현
    // 참고: https://partners.agoda.com/developers
    return [];
  },

  async searchActivities(_params: ActivitySearchParams): Promise<ActivityResult[]> {
    return []; // 아고다는 액티비티 미지원
  },

  async createAffiliateLink(targetUrl: string): Promise<string> {
    // TODO Phase 1: Agoda 딥링크 파라미터 주입
    return targetUrl;
  },
};
