/**
 * Dynamic search providers — ⌘K 팔레트의 비동기 검색 결과 공급자.
 *
 * 호출 패턴:
 *   1. 사용자가 쿼리 입력
 *   2. 250ms debounce
 *   3. 모든 provider 병렬 호출 (Promise.all)
 *   4. 결과를 통합해 노출
 *
 * 안전 장치:
 *   - 빈 쿼리는 즉시 빈 배열 반환 (네트워크 절약)
 *   - 글자 수 < 2 도 빈 배열 (오버피치 방지)
 *   - 각 provider 결과 최대 5건
 *   - 401/네트워크 실패는 빈 배열 (UI 안정성 우선)
 */

import type { LucideIcon } from 'lucide-react';
import { BookOpenCheck, Users, Package } from 'lucide-react';

export interface DynamicResult {
  id: string;            // 'booking:abc-123'
  label: string;         // '김여행 (B-123) — 일본 골프'
  hint?: string;         // 출발일 등
  href: string;          // /admin/bookings?id=...
  icon: LucideIcon;
  group: string;         // '예약' / '고객' / '상품'
}

const MIN_QUERY_LEN = 2;
const PER_PROVIDER_LIMIT = 5;

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface BookingRow {
  id: string;
  booking_no?: string;
  package_title?: string | null;
  departure_date?: string | null;
  customers?: { name?: string; phone?: string } | null;
}

async function searchBookings(q: string): Promise<DynamicResult[]> {
  const url = `/api/bookings?search=${encodeURIComponent(q)}&limit=${PER_PROVIDER_LIMIT}`;
  const json = await safeJson<{ data?: BookingRow[]; bookings?: BookingRow[] }>(url);
  const rows = json?.data ?? json?.bookings ?? [];
  return rows.slice(0, PER_PROVIDER_LIMIT).map((b) => ({
    id: `booking:${b.id}`,
    label: `${b.customers?.name ?? '—'} (${b.booking_no ?? b.id.slice(0, 6)})`,
    hint: [b.package_title, b.departure_date?.slice(0, 10)].filter(Boolean).join(' · '),
    href: `/admin/bookings?id=${b.id}`,
    icon: BookOpenCheck,
    group: '예약',
  }));
}

interface CustomerRow {
  id: string;
  name: string;
  phone?: string | null;
  grade?: string | null;
}

async function searchCustomers(q: string): Promise<DynamicResult[]> {
  const url = `/api/customers?search=${encodeURIComponent(q)}&limit=${PER_PROVIDER_LIMIT}`;
  const json = await safeJson<{ data?: CustomerRow[]; customers?: CustomerRow[] }>(url);
  const rows = json?.data ?? json?.customers ?? [];
  return rows.slice(0, PER_PROVIDER_LIMIT).map((c) => ({
    id: `customer:${c.id}`,
    label: c.name,
    hint: [c.grade, c.phone ? `···${c.phone.slice(-4)}` : null].filter(Boolean).join(' · '),
    href: `/admin/customers?id=${c.id}`,
    icon: Users,
    group: '고객',
  }));
}

interface PackageRow {
  id: string;
  title?: string;
  display_title?: string;
  destination?: string;
}

async function searchPackages(q: string): Promise<DynamicResult[]> {
  const url = `/api/packages?search=${encodeURIComponent(q)}&limit=${PER_PROVIDER_LIMIT}`;
  const json = await safeJson<{ data?: PackageRow[]; packages?: PackageRow[] }>(url);
  const rows = json?.data ?? json?.packages ?? [];
  return rows.slice(0, PER_PROVIDER_LIMIT).map((p) => ({
    id: `package:${p.id}`,
    label: p.display_title ?? p.title ?? '(제목 없음)',
    hint: p.destination,
    href: `/admin/packages?id=${p.id}`,
    icon: Package,
    group: '상품',
  }));
}

/**
 * 모든 provider 병렬 호출. 빈 쿼리 / 짧은 쿼리는 빈 배열.
 */
export async function searchAll(q: string): Promise<DynamicResult[]> {
  const trimmed = q.trim();
  if (trimmed.length < MIN_QUERY_LEN) return [];

  const results = await Promise.all([
    searchBookings(trimmed).catch(() => []),
    searchCustomers(trimmed).catch(() => []),
    searchPackages(trimmed).catch(() => []),
  ]);
  return results.flat();
}
