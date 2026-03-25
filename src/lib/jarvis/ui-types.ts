// ─── Generative UI 타입 정의 ──────────────────────────────────────────────────

export interface DateChip {
  type: 'date_chip';
  date: string;        // YYYY-MM-DD
  price: number;       // 해당일 1인 판매가
  saving: number;      // 기준일 대비 절감액 (양수면 더 저렴)
  label: string;       // "3일 앞당기면 52,000원 절약"
}

export interface PackageCard {
  type: 'package_card';
  packageId: string;
  title: string;
  destination: string;
  nights: number;
  days: number;
  priceFrom: number;
  tags: string[];
  landOperator?: string;
}

export interface ItineraryCard {
  type: 'itinerary_card';
  title: string;
  destination: string;
  days: Array<{
    day: number;
    title: string;
    activities: string[];
  }>;
}

export type UIComponent = DateChip | PackageCard | ItineraryCard;

export interface JarvisResponse {
  reply: string;
  actions: Array<{ type: string; data: unknown }>;
  uiState: UIComponent[] | null;
  mode: 'PRODUCT_MODE' | 'BOOKING_MODE' | 'FINANCE_MODE' | 'MULTI_MODE' | 'BULK';
}
