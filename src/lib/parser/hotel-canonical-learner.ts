/**
 * @file hotel-canonical-learner.ts — 호텔 빈도 기반 canonical 학습 (2026-05-14 박제, 사장님 인사이트)
 *
 * 박제 사유 (사장님):
 *   "호텔은 오류가 있을 수 있으니까 횟수로 치자. 반복 빈도를 확인해서 그걸 나중에 정규화하는 건?"
 *
 * 동작:
 *   1. 등록 시 itinerary_data.days[].hotel.name 을 빈도 누적
 *   2. 같은 destination 의 호텔명 fuzzy 유사도 0.85+ 면 같은 canonical 로 묶음
 *   3. total_count >= 3 면 자동 canonical 승격 (is_canonical=true)
 *   4. 사장님 어드민 정정 시 manual canonical 지정 가능
 *
 * 호텔은 MRT 가 SSOT 가 못 됨 (체인/등급 변동·표기 다양) — 사장님 빈도 인사이트.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { hangulSimilarity } from './hangul-fuzzy';

const AUTO_CANONICAL_THRESHOLD = 3;
const FUZZY_THRESHOLD = 0.85;

// 2026-05-19 박제 (SF-4): hotel_canonical 적재 silent fail 누적 카운터.
//   SF-1 (classification-signals) 와 동일 패턴 — 10회 + 30분 cooldown.
const hotelLearnFailState = {
  consecutive: 0,
  lastAlertAt: 0,
  ALERT_THRESHOLD: 10,
  ALERT_COOLDOWN_MS: 30 * 60 * 1000,
};
function reportHotelLearnFailure(reason: string): void {
  hotelLearnFailState.consecutive++;
  if (hotelLearnFailState.consecutive < hotelLearnFailState.ALERT_THRESHOLD) return;
  if (Date.now() - hotelLearnFailState.lastAlertAt < hotelLearnFailState.ALERT_COOLDOWN_MS) return;
  hotelLearnFailState.lastAlertAt = Date.now();
  if (!isSupabaseConfigured) return;
  supabaseAdmin.from('admin_alerts').insert({
    category: 'register-learning',
    severity: 'warning',
    title: `hotel_canonical 학습 실패 누적 ${hotelLearnFailState.consecutive}회`,
    message: `recordHotelOccurrence 적재 ${hotelLearnFailState.consecutive}회 연속 실패 — 호텔 alias 학습 단절. 최근 reason: ${reason.slice(0, 300)}`,
    ref_type: 'parser',
    ref_id: null,
    meta: { phase: 'hotel-canonical', consecutive: hotelLearnFailState.consecutive, reason: reason.slice(0, 300) },
  }).then(() => {}, () => {});
  hotelLearnFailState.consecutive = 0;
}
function resetHotelLearnFailure(): void {
  hotelLearnFailState.consecutive = 0;
}

interface HotelRow {
  id: number;
  canonical_name: string;
  aliases: string[];
  total_count: number;
  is_canonical: boolean;
}

/** 호텔명 정규화 — 공백/괄호/등급 표기 제거. "Lotte Hotel Hanoi (5성)" → "Lotte Hotel Hanoi". */
function normalizeHotelName(name: string): string {
  return name
    .replace(/\s*\(?[3-5]\.?5?성\)?/g, '')
    .replace(/\s*\(?(?:준)?\d성\)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 호텔명 한 건을 누적. 같은 destination 안에서 유사한 이름 있으면 합쳐서 빈도 증가.
 * 호출 측은 fire-and-forget — await 안 해도 됨.
 */
export async function recordHotelOccurrence(args: {
  hotelName: string;
  destination?: string | null;
  country?: string | null;
  grade?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  const cleaned = normalizeHotelName(args.hotelName ?? '');
  if (!cleaned || cleaned.length < 2 || cleaned.length > 200) return;

  try {
    const destination = args.destination?.trim() || null;
    // 같은 destination 안의 기존 호텔 후보 로드 (성능: 최대 50건)
    let q = supabaseAdmin
      .from('hotel_canonical')
      .select('id, canonical_name, aliases, total_count, is_canonical')
      .order('total_count', { ascending: false })
      .limit(50);
    if (destination) q = q.eq('destination', destination);

    const { data: existing } = await q;
    const candidates = (existing ?? []) as HotelRow[];

    // 1) 완전 일치 (canonical 또는 alias 안에)
    const exact = candidates.find(c =>
      c.canonical_name === cleaned ||
      (Array.isArray(c.aliases) && c.aliases.includes(cleaned)),
    );
    if (exact) {
      const newAliases = Array.isArray(exact.aliases) ? exact.aliases : [];
      if (!newAliases.includes(cleaned) && cleaned !== exact.canonical_name) {
        newAliases.push(cleaned);
      }
      const newCount = exact.total_count + 1;
      const { error: updExactErr } = await supabaseAdmin
        .from('hotel_canonical')
        .update({
          aliases: newAliases,
          total_count: newCount,
          is_canonical: exact.is_canonical || newCount >= AUTO_CANONICAL_THRESHOLD,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', exact.id);
      if (updExactErr) reportHotelLearnFailure(`exact UPDATE fail: ${updExactErr.message}`);
      else resetHotelLearnFailure();
      return;
    }

    // 2) Hangul fuzzy — 유사도 0.85+ 면 같은 호텔로 간주
    let bestSim = 0;
    let bestRow: HotelRow | null = null;
    for (const c of candidates) {
      const sim = hangulSimilarity(cleaned, c.canonical_name);
      if (sim >= FUZZY_THRESHOLD && sim > bestSim) {
        bestSim = sim;
        bestRow = c;
      }
    }
    if (bestRow) {
      const newAliases = Array.isArray(bestRow.aliases) ? bestRow.aliases : [];
      if (!newAliases.includes(cleaned)) newAliases.push(cleaned);
      const newCount = bestRow.total_count + 1;
      const { error: updFuzzyErr } = await supabaseAdmin
        .from('hotel_canonical')
        .update({
          aliases: newAliases,
          total_count: newCount,
          is_canonical: bestRow.is_canonical || newCount >= AUTO_CANONICAL_THRESHOLD,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', bestRow.id);
      if (updFuzzyErr) reportHotelLearnFailure(`fuzzy UPDATE fail: ${updFuzzyErr.message}`);
      else resetHotelLearnFailure();
      return;
    }

    // 3) 신규 호텔 — INSERT
    const { error: insErr } = await supabaseAdmin
      .from('hotel_canonical')
      .insert({
        canonical_name: cleaned,
        destination,
        country: args.country ?? null,
        grade: args.grade ?? null,
        aliases: [],
        total_count: 1,
        is_canonical: false,
      });
    if (insErr) reportHotelLearnFailure(`INSERT fail: ${insErr.message}`);
    else resetHotelLearnFailure();
  } catch (e) {
    // fire-and-forget — 학습 실패는 등록 흐름에 영향 없음. 누적 카운터로 alert.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[Hotel-Canonical] 누적 실패:', msg);
    reportHotelLearnFailure(`exception: ${msg}`);
  }
}

/**
 * itinerary_data 의 모든 day.hotel 을 추출해 빈도 누적.
 * upload/route.ts INSERT 직후 fire-and-forget 호출.
 */
export async function recordHotelsFromItinerary(args: {
  itineraryData: unknown;
  destination?: string | null;
  country?: string | null;
}): Promise<void> {
  if (!args.itineraryData || typeof args.itineraryData !== 'object') return;
  const days = (args.itineraryData as { days?: unknown[] }).days;
  if (!Array.isArray(days)) return;

  const seen = new Set<string>();
  for (const day of days) {
    if (!day || typeof day !== 'object') continue;
    const hotel = (day as { hotel?: { name?: string; grade?: string } }).hotel;
    const name = hotel?.name?.trim();
    if (!name) continue;
    const key = normalizeHotelName(name);
    if (seen.has(key)) continue; // 같은 등록 안에서 중복 카운트 방지
    seen.add(key);
    await recordHotelOccurrence({
      hotelName: name,
      destination: args.destination ?? null,
      country: args.country ?? null,
      grade: hotel?.grade ?? null,
    });
  }
}
