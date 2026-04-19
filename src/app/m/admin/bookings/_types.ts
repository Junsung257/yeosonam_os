export type SortMode = 'recent' | 'dep_asc' | 'dep_desc';

export const SORT_LABELS: Record<SortMode, string> = {
  recent: '최근 등록순',
  dep_asc: '출발 빠른순',
  dep_desc: '출발 먼순',
};

export const SORT_CYCLE: Record<SortMode, SortMode> = {
  recent: 'dep_asc',
  dep_asc: 'dep_desc',
  dep_desc: 'recent',
};

export interface MobileBookingRow {
  id: string;
  booking_no: string | null;
  status: string;
  package_title: string | null;
  departure_date: string | null;
  total_price: number | null;
  paid_amount: number | null;
  customer_name: string | null;
  created_at: string | null;
}

export function parseSort(v?: string): SortMode {
  if (v === 'dep_asc' || v === 'dep_desc') return v;
  return 'recent';
}
