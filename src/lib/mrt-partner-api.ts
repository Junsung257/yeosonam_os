/**
 * MRT Partner API 클라이언트
 *
 * 권한:
 *   REVENUES:READ   → 수익 현황 자동 조회
 *   RESERVATIONS:READ → 예약 내역 조회 및 세션 자동 매칭
 *   MYLINK:WRITE    → buildMylinkUrl로 대체 (URL 파라미터 방식)
 *
 * RESERVATIONS:WRITE 미보유 → 예약 생성/취소 불가 (MRT 파트너팀 신청 필요)
 */

import { getSecret } from '@/lib/secret-registry';

const BASE = 'https://partner-ext-api.myrealtrip.com';
const API_KEY = getSecret('MYREALTRIP_API_KEY') ?? '';

function authHeaders() {
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function mrtGet<T>(path: string, params?: Record<string, string | number | string[]>): Promise<T | null> {
  if (!API_KEY) return null;
  try {
    const url = new URL(BASE + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach(item => url.searchParams.append(k, item));
        } else {
          url.searchParams.set(k, String(v));
        }
      });
    }
    const res = await fetch(url.toString(), { headers: authHeaders(), next: { revalidate: 0 } });
    if (!res.ok) {
      console.warn(`[mrt-partner] ${path} → ${res.status}`);
      return null;
    }
    return res.json() as Promise<T>;
  } catch (e) {
    console.error('[mrt-partner] fetch error', e);
    return null;
  }
}

// ─── 수익 현황 (REVENUES:READ) ────────────────────────────────────────────────

export interface MrtRevenueItem {
  reservationNo:         string;
  reservedAt:            string;       // ISO8601
  productTitle:          string;
  productCategory:       string;       // 'stay' | 'tna' | 'flight'
  city:                  string;
  country:               string;
  salePrice:             number;       // 판매가 (원)
  commissionBase:        number;       // 수수료 기준 금액
  commission:            number;       // 수수료 (원)
  commissionRate:        number;       // 수수료율 (%)
  status:                string;       // 'confirmed' | 'cancelled' | 'settled'
  statusKor:             string;
  settlementCriteriaDate?: string;     // YYYY-MM-DD
  gid?:                  string;
  linkId?:               string;
  utmContent?:           string;       // 우리가 심은 utm_content (세션 ID)
}

export interface MrtRevenueResponse {
  data:       MrtRevenueItem[];
  meta:       { totalCount: number };
  result:     { status: string; message: string; code: string };
}

// 내부 표준화 응답 (admin route에서 사용)
export interface MrtRevenuePage {
  items:      MrtRevenueItem[];
  totalCount: number;
  page:       number;
}

export async function getMrtRevenues(params: {
  startDate:      string;   // YYYY-MM-DD
  endDate:        string;   // YYYY-MM-DD
  dateSearchType?: 'SETTLEMENT' | 'PAYMENT';  // default: SETTLEMENT
  page?:          number;
  pageSize?:      number;
}): Promise<MrtRevenuePage | null> {
  const raw = await mrtGet<MrtRevenueResponse>('/v1/revenues', {
    startDate:      params.startDate,
    endDate:        params.endDate,
    dateSearchType: params.dateSearchType ?? 'SETTLEMENT',
    page:           params.page     ?? 1,
    pageSize:       params.pageSize ?? 50,
  });
  if (!raw) return null;
  return {
    items:      raw.data ?? [],
    totalCount: raw.meta?.totalCount ?? 0,
    page:       params.page ?? 1,
  };
}

// ─── 예약 내역 (RESERVATIONS:READ) ───────────────────────────────────────────

export interface MrtReservationItem {
  reservationNo:   string;
  reservedAt:      string;       // ISO8601
  productTitle:    string;
  productCategory: string;       // 'stay' | 'tna' | 'flight'
  city:            string;
  status:          string;       // 'confirmed' | 'cancelled' | 'completed'
  statusKor:       string;
  salePrice:       number;
  quantity:        number;
  tripStartedAt?:  string;
  tripEndedAt?:    string;
  gid?:            string;
  linkId?:         string;
  utmContent?:     string;       // 우리가 심은 utm_content (세션 ID)
}

export interface MrtReservationResponse {
  data:   MrtReservationItem[];
  meta:   { totalCount: number };
  result: { status: string; message: string; code: string };
}

export interface MrtReservationPage {
  items:      MrtReservationItem[];
  totalCount: number;
  page:       number;
}

export async function getMrtReservations(params: {
  startDate:      string;   // YYYY-MM-DD
  endDate:        string;   // YYYY-MM-DD
  dateSearchType?: 'RESERVATION_DATE' | 'TRIP_END_DATE';
  statuses?:      string[];  // ['confirmed', 'cancelled', 'completed']
  page?:          number;
  pageSize?:      number;
}): Promise<MrtReservationPage | null> {
  const raw = await mrtGet<MrtReservationResponse>('/v1/reservations', {
    startDate:      params.startDate,
    endDate:        params.endDate,
    dateSearchType: params.dateSearchType ?? 'RESERVATION_DATE',
    page:           params.page     ?? 1,
    pageSize:       params.pageSize ?? 50,
    ...(params.statuses?.length ? { statuses: params.statuses } : {}),
  });
  if (!raw) return null;
  return {
    items:      raw.data ?? [],
    totalCount: raw.meta?.totalCount ?? 0,
    page:       params.page ?? 1,
  };
}

// ─── 헬스체크 ─────────────────────────────────────────────────────────────────

export async function checkMrtHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/health`, { headers: authHeaders() });
    return { ok: res.ok, latencyMs: Date.now() - t };
  } catch {
    return { ok: false, latencyMs: Date.now() - t };
  }
}
