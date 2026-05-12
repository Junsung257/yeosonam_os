/**
 * 패키지 일정 호텔만 MRT MCP로 조회 → DB 영구 캐시 (스냅샷 + 매칭).
 * - 전체 OTA 카탈로그 저장 아님
 * - 자비스 FAQ(어메니티·취소규정 등)는 detail_jsonb + amenities
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { TravelItinerary } from '@/types/itinerary';
import type { RawPackageRow } from '@/lib/scoring/extract-features';
import { pickPackageRepresentativeDate } from '@/lib/scoring/extract-features';
import { mrtProvider, getStayDetail, type StayDetailResult } from '@/lib/travel-providers/mrt';
import type { StayResult } from '@/lib/travel-providers/types';

const TTL_DAYS = 21;
const MRT_DELAY_MS = 400;
const ADULTS = 2;

export interface HotelStaySegment {
  startDay: number;
  endDay: number;
  name: string;
  grade: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T12:00:00.000Z`).getTime();
  const b = new Date(`${checkOut}T12:00:00.000Z`).getTime();
  const n = Math.round((b - a) / 86400000);
  return Math.max(1, n);
}

/** 연속 동일 호텔명을 한 숙박 구간으로 합침 */
export function collapseHotelSegments(itin: TravelItinerary | null): HotelStaySegment[] {
  if (!itin?.days?.length) return [];
  const segments: HotelStaySegment[] = [];
  for (const d of itin.days) {
    const name = d.hotel?.name?.trim();
    if (!name) continue;
    const dayNum = typeof d.day === 'number' ? d.day : itin.days.indexOf(d) + 1;
    const prev = segments[segments.length - 1];
    if (prev && prev.name === name) {
      prev.endDay = dayNum;
    } else {
      segments.push({
        startDay: dayNum,
        endDay: dayNum,
        name,
        grade: d.hotel?.grade ?? null,
      });
    }
  }
  return segments;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/호텔|리조트|hotel|resort|빌라|villa|\s+/gi, '')
    .trim();
}

function bigrams(s: string): Set<string> {
  const n = normalizeName(s);
  const out = new Set<string>();
  for (let i = 0; i < Math.max(0, n.length - 1); i++) out.add(n.slice(i, i + 2));
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 0~1 유사도 — 동일 브랜드·부분일치 가산 */
export function hotelNameSimilarity(itineraryName: string, listingName: string): number {
  const a = normalizeName(itineraryName);
  const b = normalizeName(listingName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 0.9;
  const bg = jaccard(bigrams(itineraryName), bigrams(listingName));
  const ta = new Set(a.split(/[^a-z0-9가-힣]+/i).filter(t => t.length >= 2));
  const tb = new Set(b.split(/[^a-z0-9가-힣]+/i).filter(t => t.length >= 2));
  const tok = jaccard(ta, tb);
  return Math.max(bg, tok * 0.95);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 오름차순 배열 기준: 값보다 작은 가격 비율 (0~1, 저가일수록 낮음) */
function percentileRank(value: number, sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0.5;
  const below = sortedAsc.filter(x => x < value).length;
  return below / sortedAsc.length;
}

function listingTotalPrice(st: StayResult, nights: number): number {
  if (typeof st.totalPrice === 'number' && st.totalPrice > 0) return st.totalPrice;
  const per = st.pricePerNight ?? 0;
  return per > 0 ? per * nights : 0;
}

function minRoomPriceFromDetail(d: StayDetailResult): number {
  const rooms = d.rooms ?? [];
  if (rooms.length === 0) return 0;
  const prices = rooms.map(r => r.price).filter(p => p > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function computeComposite(args: {
  matchScore: number;
  rating?: number;
  reviewCount?: number;
  medianPeer: number;
  listingPrice: number;
}): number {
  const rating = args.rating ?? 4.0;
  const reviews = args.reviewCount ?? 0;
  const rNorm = (Math.min(5, Math.max(0, rating)) / 5) * 36;
  const revNorm = Math.min(30, (Math.log10(reviews + 1) / Math.log10(5001)) * 30);
  let priceNorm = 14;
  if (args.medianPeer > 0 && args.listingPrice > 0) {
    const ratio = args.listingPrice / args.medianPeer;
    const v = Math.max(0, Math.min(1, 1.2 - ratio));
    priceNorm = v * 28;
  }
  const base = rNorm + revNorm + priceNorm;
  const trust = 0.72 + 0.28 * Math.min(1, Math.max(0, args.matchScore));
  return Math.round(Math.max(0, Math.min(100, base * trust)) * 100) / 100;
}

async function upsertSnapshot(row: {
  mrt_gid: string;
  check_in: string;
  check_out: string;
  adult_count: number;
  child_count: number;
  mrt_name: string | null;
  rating: number | null;
  review_count: number | null;
  min_room_price_krw: number | null;
  amenities: string[];
  provider_url: string | null;
  detail_jsonb: Record<string, unknown>;
}): Promise<string | null> {
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + TTL_DAYS);
  const { data, error } = await supabaseAdmin
    .from('mrt_stay_detail_snapshots')
    .upsert(
      {
        ...row,
        fetched_at: new Date().toISOString(),
        expires_at: expires.toISOString(),
      },
      {
        onConflict: 'mrt_gid,check_in,check_out,adult_count,child_count',
      },
    )
    .select('id')
    .limit(1);
  if (error) {
    console.warn('[mrt-hotel-intel] snapshot upsert:', error.message);
    return null;
  }
  const id = (data?.[0] as { id?: string } | undefined)?.id;
  return id ?? null;
}

function bestListingMatch(hotelName: string, listings: StayResult[]): {
  st: StayResult;
  score: number;
} | null {
  let best: { st: StayResult; score: number } | null = null;
  for (const st of listings) {
    const sc = hotelNameSimilarity(hotelName, st.name);
    if (sc < 0.32) continue;
    if (!best || sc > best.score) best = { st, score: sc };
  }
  return best;
}

/**
 * 단일 패키지·출발일 기준 MRT 동기화 (승인 훅·어드민·크론).
 */
export async function syncPackageHotelIntel(
  pkg: Pick<RawPackageRow, 'id' | 'destination' | 'duration' | 'itinerary_data' | 'price_dates'>,
  departureDate: string,
): Promise<{ segments: number; snapshots: number; skipped: boolean }> {
  if (!isSupabaseConfigured) return { segments: 0, snapshots: 0, skipped: true };
  const itin = pkg.itinerary_data;
  const segments = collapseHotelSegments(itin);
  if (segments.length === 0 || !pkg.destination?.trim()) {
    return { segments: 0, snapshots: 0, skipped: true };
  }

  await supabaseAdmin
    .from('mrt_package_hotel_intel')
    .delete()
    .eq('package_id', pkg.id)
    .eq('departure_date', departureDate);

  let snapshots = 0;

  for (const seg of segments) {
    const checkIn = addDaysIso(departureDate, seg.startDay - 1);
    const checkOut = addDaysIso(departureDate, seg.endDay);
    const nights = nightsBetween(checkIn, checkOut);

    await sleep(MRT_DELAY_MS);
    const listings = await mrtProvider.searchStays({
      destination: pkg.destination.trim(),
      checkIn,
      checkOut,
      adults: ADULTS,
      children: 0,
    });

    const prices = listings.map(l => listingTotalPrice(l, nights)).filter(p => p > 0);
    const med = median(prices);
    const sortedPrices = [...prices].sort((a, b) => a - b);

    const hit = bestListingMatch(seg.name, listings);
    let snapshotId: string | null = null;
    let detail: StayDetailResult | null = null;
    let composite: number | null = null;
    let listingPrice = 0;
    let pct: number | null = null;
    let matchedGid: string | null = null;
    let matchedName: string | null = null;
    let matchScore: number | null = null;

    if (hit) {
      matchedGid = hit.st.providerId;
      matchedName = hit.st.name;
      matchScore = Math.round(hit.score * 10000) / 10000;
      listingPrice = listingTotalPrice(hit.st, nights);
      pct = listingPrice > 0 && sortedPrices.length
        ? Math.round(percentileRank(listingPrice, sortedPrices) * 10000) / 10000
        : null;

      await sleep(MRT_DELAY_MS);
      detail = await getStayDetail(hit.st.providerId, checkIn, checkOut, ADULTS, 0);

      const minRoom = detail ? minRoomPriceFromDetail(detail) : 0;
      const rating = detail?.rating ?? hit.st.rating;
      const reviews = detail?.reviewCount ?? hit.st.reviewCount;
      const detailJson: Record<string, unknown> | null = detail
        ? { ...detail as unknown as Record<string, unknown>, _source: 'getStayDetail' }
        : null;

      if (detail && detailJson) {
        snapshotId = await upsertSnapshot({
          mrt_gid: String(hit.st.providerId),
          check_in: checkIn,
          check_out: checkOut,
          adult_count: ADULTS,
          child_count: 0,
          mrt_name: detail.name,
          rating: rating ?? null,
          review_count: reviews ?? null,
          min_room_price_krw: minRoom > 0 ? minRoom : null,
          amenities: detail.amenities ?? [],
          provider_url: detail.providerUrl ?? hit.st.providerUrl ?? null,
          detail_jsonb: detailJson,
        });
        if (snapshotId) snapshots++;
      } else {
        // 상세 API 실패 시에도 검색 결과만 스냅샷(어메니티·URL) 저장 — 연동 끊김 대비
        snapshotId = await upsertSnapshot({
          mrt_gid: String(hit.st.providerId),
          check_in: checkIn,
          check_out: checkOut,
          adult_count: ADULTS,
          child_count: 0,
          mrt_name: hit.st.name,
          rating: hit.st.rating ?? null,
          review_count: hit.st.reviewCount ?? null,
          min_room_price_krw: listingPrice > 0 ? Math.round(listingPrice) : null,
          amenities: hit.st.amenities ?? [],
          provider_url: hit.st.providerUrl ?? null,
          detail_jsonb: {
            _source: 'searchStays_only',
            name: hit.st.name,
            rating: hit.st.rating,
            reviewCount: hit.st.reviewCount,
            pricePerNight: hit.st.pricePerNight,
            totalPrice: hit.st.totalPrice,
          },
        });
        if (snapshotId) snapshots++;
      }

      composite = computeComposite({
        matchScore: hit.score,
        rating: rating ?? undefined,
        reviewCount: reviews ?? undefined,
        medianPeer: med,
        listingPrice: minRoom > 0 ? minRoom : listingPrice,
      });
    }

    const { error: insErr } = await supabaseAdmin.from('mrt_package_hotel_intel').insert({
      package_id: pkg.id,
      departure_date: departureDate,
      day_index: seg.startDay,
      itinerary_hotel_name: seg.name,
      itinerary_hotel_grade: seg.grade,
      matched_mrt_gid: matchedGid,
      matched_mrt_name: matchedName,
      match_score: matchScore,
      snapshot_id: snapshotId,
      market_median_price_krw: med > 0 ? Math.round(med) : null,
      listing_price_krw: listingPrice > 0 ? Math.round(listingPrice) : null,
      price_percentile: pct,
      composite_mrt_score: composite,
    });
    if (insErr) console.warn('[mrt-hotel-intel] intel insert:', insErr.message);
  }

  return { segments: segments.length, snapshots, skipped: false };
}

/** 승인·어드민용 — DB에서 패키지 로드 후 동기화 */
export async function syncPackageHotelIntelByPackageId(packageId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, duration, itinerary_data, price_dates')
    .eq('id', packageId)
    .limit(1);
  if (error || !data?.[0]) return;
  const row = data[0] as RawPackageRow;
  const dep = pickPackageRepresentativeDate(row.price_dates);
  if (!dep) return;
  await syncPackageHotelIntel(row, dep);
}

export interface StaleSyncOpts {
  maxPackages?: number;
  /** 이 기간 안에 동기화된 패키지는 스킵 */
  freshWithinDays?: number;
}

/**
 * 크론용 — MRT 미동기·오래된 패키지 일부만 갱신 (부하 상한).
 */
export async function syncStaleMrtHotelIntel(opts: StaleSyncOpts = {}): Promise<{
  attempted: number;
  synced: number;
}> {
  if (!isSupabaseConfigured) return { attempted: 0, synced: 0 };
  const maxP = opts.maxPackages ?? 25;
  const freshDays = opts.freshWithinDays ?? 14;
  const threshold = new Date();
  threshold.setUTCDate(threshold.getUTCDate() - freshDays);

  const { data: pkgs, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, duration, itinerary_data, price_dates')
    .in('status', ['approved', 'active'])
    .not('itinerary_data', 'is', null)
    .limit(400);

  if (error || !pkgs?.length) return { attempted: 0, synced: 0 };

  const today = new Date().toISOString().slice(0, 10);
  let synced = 0;
  let attempted = 0;

  for (const raw of pkgs as RawPackageRow[]) {
    if (attempted >= maxP) break;
    const dep = pickPackageRepresentativeDate(raw.price_dates);
    if (!dep || dep < today) continue;

    const { data: fresh } = await supabaseAdmin
      .from('mrt_package_hotel_intel')
      .select('computed_at')
      .eq('package_id', raw.id)
      .eq('departure_date', dep)
      .order('computed_at', { ascending: false })
      .limit(1);

    const last = fresh?.[0] as { computed_at?: string } | undefined;
    if (last?.computed_at && new Date(last.computed_at) > threshold) continue;

    attempted++;
    try {
      await syncPackageHotelIntel(raw, dep);
      synced++;
    } catch (e) {
      console.warn('[mrt-hotel-intel] stale sync', raw.id, e instanceof Error ? e.message : e);
    }
  }

  return { attempted, synced };
}

/** 점수 파이프라인: 패키지+출발일별 평균 MRT 종합점수 (0~100), 없으면 null */
export async function loadMrtHotelQualityMap(
  entries: Array<{ packageId: string; departureDate: string | null }>,
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (!isSupabaseConfigured || entries.length === 0) return map;

  const ids = Array.from(new Set(entries.map(e => e.packageId)));
  const dates = Array.from(new Set(entries.map(e => e.departureDate).filter((d): d is string => !!d)));

  for (const e of entries) {
    const k = `${e.packageId}|${e.departureDate ?? '_'}`;
    map.set(k, null);
  }

  if (ids.length === 0 || dates.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('mrt_package_hotel_intel')
    .select('package_id, departure_date, composite_mrt_score')
    .in('package_id', ids)
    .in('departure_date', dates);

  if (error || !data) return map;

  type Row = { package_id: string; departure_date: string; composite_mrt_score: number | null };
  const agg = new Map<string, { sum: number; n: number }>();
  for (const r of data as Row[]) {
    if (r.composite_mrt_score == null) continue;
    const key = `${r.package_id}|${r.departure_date}`;
    const cur = agg.get(key) ?? { sum: 0, n: 0 };
    cur.sum += Number(r.composite_mrt_score);
    cur.n += 1;
    agg.set(key, cur);
  }

  for (const [key, v] of agg) {
    if (v.n > 0) map.set(key, Math.round((v.sum / v.n) * 100) / 100);
  }
  return map;
}

/** 자비스·상세용 — DB에 저장된 호텔 인텔 (연동 끊긴 뒤에도 조회) */
export async function fetchHotelIntelForJarvis(
  packageId: string,
  departureDate?: string | null,
): Promise<Array<Record<string, unknown>>> {
  if (!isSupabaseConfigured) return [];
  let q = supabaseAdmin
    .from('mrt_package_hotel_intel')
    .select(`
      day_index,
      departure_date,
      itinerary_hotel_name,
      itinerary_hotel_grade,
      matched_mrt_gid,
      matched_mrt_name,
      match_score,
      market_median_price_krw,
      listing_price_krw,
      price_percentile,
      composite_mrt_score,
      snapshot_id,
      computed_at
    `)
    .eq('package_id', packageId)
    .order('day_index');

  if (departureDate) q = q.eq('departure_date', departureDate);

  const { data: rows, error } = await q;
  if (error) {
    console.warn('[mrt-hotel-intel] jarvis fetch:', error.message);
    return [];
  }
  const list = (rows ?? []) as Array<{ snapshot_id: string | null }>;
  const snapIds = [...new Set(list.map(r => r.snapshot_id).filter((id): id is string => !!id))];
  if (snapIds.length === 0) return list as Array<Record<string, unknown>>;

  const { data: snaps } = await supabaseAdmin
    .from('mrt_stay_detail_snapshots')
    .select('id, rating, review_count, amenities, check_in, check_out, provider_url, detail_jsonb')
    .in('id', snapIds);
  type SnapRow = { id: string } & Record<string, unknown>;
  const byId = new Map(
    (snaps ?? []).map((s: SnapRow) => [s.id, s] as const),
  );

  return list.map(r => ({
    ...(r as Record<string, unknown>),
    mrt_snapshot: r.snapshot_id ? byId.get(r.snapshot_id) ?? null : null,
  }));
}
