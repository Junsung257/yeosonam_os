/**
 * travel-providers/index.ts — Provider Registry
 *
 * 활성 provider 목록을 한 곳에서 관리.
 * 새 OTA 추가: 이 파일에만 import + ACTIVE_PROVIDERS에 추가.
 */

export { mrtProvider }      from './mrt';
export { agodaProvider }    from './agoda';
export { yeosonamProvider } from './yeosonam';
export { TravelAggregator } from './aggregator';
export * from './types';

import { mrtProvider }      from './mrt';
import { agodaProvider }    from './agoda';
import { yeosonamProvider } from './yeosonam';
import { TravelAggregator } from './aggregator';

// Phase 0: MRT만 활성. 아고다는 API 파트너 신청 완료 후 추가.
const ACTIVE_PROVIDERS = [
  mrtProvider,
  // agodaProvider,    // Phase 1: Agoda 파트너십 체결 후 주석 해제
  // yeosonamProvider, // Phase 2: 직판 상품 출시 후 주석 해제
];

export const aggregator = new TravelAggregator(ACTIVE_PROVIDERS);
