/**
 * 자유여행 일정표 — 「구성 만족도」 점수 (Itinerary Composition Score)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 설계 원칙                                                                │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ • 날씨·기후·시기 적합도는 여기서 다루지 않음 (패키지 상세의 기후 카드 등과 분리).   │
 * │ • 업계 일정표(브로셔·OTA 일정)처럼 “하루가 알차고 균형 잡혔는지”를 수치화.          │
 * │ • 1차 앵커: 여소남 승인 패키지 itinerary_data + product_highlights.            │
 * │ • 확장: 외부 일정 생성 API/모델 출력·제3자 일정 JSON을 같은 슬롯 스키마로 주입.    │
 * │   (카드뉴스/마케 콘텐츠는 일정 품질 레퍼런스로 부적합 — 사용하지 않음.)            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 점수 축 (합 100 → 가중 합산 후 반올림):
 *   structure   — 일자 뼈대·체크인/체크아웃·풀데이 구분
 *   richness    — 풀데이당 스톱 수·예약형 투어 포함(깊이)
 *   rhythm      — 오전/오후/저녁/종일 타임슬롯 분산
 *   paceFit     — 고객이 고른 여행 속도(여유/보통/빡빡)와 밀도 일치
 *   editorialEcho — 레퍼런스 일정 문구와의 토큰 겹침(내부 상품 또는 외부 일정 소스)
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { DayPlan } from '@/lib/free-travel/itinerary-schema';

// ─── 참조: 패키지 itinerary_data (TravelItinerary | 레거시) ─────────────────

interface LooseScheduleItem {
  activity?: string;
  time?: string | null;
}

interface LooseDay {
  day?: number;
  regions?: string[];
  schedule?: LooseScheduleItem[];
}

function extractDaysFromItineraryData(raw: unknown): LooseDay[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  if (Array.isArray(raw)) return raw as LooseDay[];
  if (Array.isArray(o.days)) return o.days as LooseDay[];
  return [];
}

export interface ReferenceItinerarySignals {
  /** 상품 일정·하이라이트에서 모은 문구 (겹침 계산용) */
  phrases: string[];
  /** 참조에 쓴 승인 패키지 수 */
  packageCount: number;
}

/**
 * 같은 목적지 승인 패키지의 일정표·하이라이트를 모아, 일정 작성 시 참고하는 신호로 사용.
 */
export async function loadReferenceItinerarySignals(
  destination: string,
  limit = 8,
): Promise<ReferenceItinerarySignals> {
  if (!supabaseAdmin || !destination.trim()) {
    return { phrases: [], packageCount: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('itinerary_data, product_highlights')
    .ilike('destination', `%${destination.trim()}%`)
    .eq('is_active', true)
    .eq('status', 'approved')
    .limit(limit);

  if (error || !data?.length) {
    return { phrases: [], packageCount: 0 };
  }

  const phrases: string[] = [];
  for (const row of data) {
    const hi = row.product_highlights;
    if (Array.isArray(hi)) {
      for (const h of hi) {
        if (typeof h === 'string' && h.trim()) phrases.push(h.trim());
      }
    }
    const days = extractDaysFromItineraryData(row.itinerary_data);
    for (const d of days) {
      for (const r of d.regions ?? []) {
        if (typeof r === 'string' && r.trim()) phrases.push(r.trim());
      }
      for (const s of d.schedule ?? []) {
        if (s?.activity && typeof s.activity === 'string' && s.activity.trim()) {
          phrases.push(s.activity.trim());
        }
      }
    }
  }

  return { phrases: dedupePhrases(phrases), packageCount: data.length };
}

function dedupePhrases(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    const k = p.slice(0, 200);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ─── 토큰 겹침 (한글 2자 이상 조각) ────────────────────────────────────────

function tokenize(label: string): string[] {
  return label
    .split(/[·,\s/\[\]()|]+/)
    .map(x => x.trim())
    .filter(x => x.length >= 2);
}

function tokensOverlap(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return false;
  for (const x of ta) {
    for (const y of tb) {
      if (x === y || x.includes(y) || y.includes(x)) return true;
    }
  }
  return false;
}

function editorialEchoScore(stopLabels: string[], referencePhrases: string[]): number {
  if (referencePhrases.length === 0) return 4;
  if (stopLabels.length === 0) return 2;
  let hitDays = 0;
  for (const label of stopLabels) {
    const ok = referencePhrases.some(ph => tokensOverlap(label, ph));
    if (ok) hitDays += 1;
  }
  if (hitDays === 0) return 2;
  const ratio = hitDays / stopLabels.length;
  return Math.round(10 * Math.min(1, ratio * 1.2));
}

// ─── 타임 리듬 ─────────────────────────────────────────────────────────────

const TIME_BUCKET = new Map<string, string>([
  ['오전', 'am'],
  ['오후', 'pm'],
  ['저녁', 'ev'],
  ['종일', 'fd'],
  ['밤', 'ev'],
]);

function bucketTime(hint: string): string {
  for (const [k, v] of TIME_BUCKET) {
    if (hint.includes(k)) return v;
  }
  return 'other';
}

// ─── 메인 산출 ─────────────────────────────────────────────────────────────

export interface ItineraryCompositionScore {
  /** 0–100, 일정 자체의 풍족·균형·만족 예측 (기후 무관) */
  score: number;
  label: string;
  /** UI용 짧은 설명 */
  summary: string;
  breakdown: {
    structure: number;
    richness: number;
    rhythm: number;
    paceFit: number;
    editorialEcho: number;
  };
  referencePackagesUsed: number;
}

function inferPaceBucket(travelPace: string | null | undefined): 'fast' | 'relaxed' | 'normal' {
  if (!travelPace) return 'normal';
  if (/빡|빽|촘|다이나믹|몰아/i.test(travelPace)) return 'fast';
  if (/여유|느긋|천천|휴양/i.test(travelPace)) return 'relaxed';
  return 'normal';
}

export function computeItineraryCompositionScore(
  dayPlans: DayPlan[],
  options: {
    travelPace?: string | null;
    referencePhrases?: string[];
    referencePackageCount?: number;
  } = {},
): ItineraryCompositionScore {
  const pace = inferPaceBucket(options.travelPace);
  const refPhrases = options.referencePhrases ?? [];
  const refCount = options.referencePackageCount ?? 0;

  const totalDays = dayPlans.length;
  const middlePlans = dayPlans.filter(
    p => p.day > 1 && p.day < totalDays,
  );
  const arrival = dayPlans.find(p => p.day === 1);
  const departure = dayPlans.find(p => p.day === totalDays);

  // ── structure (0–30)
  let structure = 0;
  if (totalDays >= 2) structure += 8;
  if (arrival && arrival.stops.length >= 2) structure += 8;
  if (departure && departure.stops.length >= 1) structure += 6;
  if (middlePlans.length > 0 && middlePlans.every(p => p.stops.length >= 2)) structure += 8;
  structure = Math.min(30, structure);

  // ── richness (0–25): 풀데이 스톱 수 + bookable
  let richness = 0;
  if (middlePlans.length > 0) {
    const avgStops =
      middlePlans.reduce((s, p) => s + p.stops.length, 0) / middlePlans.length;
    richness += Math.min(15, Math.round(avgStops * 4));
    const bookableCount = dayPlans.reduce(
      (n, p) => n + p.stops.filter(x => x.kind === 'bookable').length,
      0,
    );
    richness += Math.min(10, bookableCount * 3);
  }
  richness = Math.min(25, richness);

  // ── rhythm (0–20): 타임슬롯 다양성
  let rhythm = 0;
  for (const p of middlePlans) {
    const buckets = new Set(p.stops.map(s => bucketTime(s.timeHint)));
    buckets.delete('other');
    rhythm += Math.min(7, buckets.size * 2);
  }
  rhythm = Math.min(20, rhythm);

  // ── paceFit (0–15)
  let paceFit = 10;
  if (middlePlans.length > 0) {
    const maxStops = Math.max(...middlePlans.map(p => p.stops.length));
    const minStops = Math.min(...middlePlans.map(p => p.stops.length));
    if (pace === 'relaxed' && maxStops >= 5) paceFit -= 5;
    if (pace === 'relaxed' && maxStops <= 3) paceFit += 3;
    if (pace === 'fast' && minStops <= 1 && middlePlans.length >= 2) paceFit -= 5;
    if (pace === 'fast' && minStops >= 2) paceFit += 3;
  }
  paceFit = Math.max(0, Math.min(15, paceFit));

  // ── editorialEcho (0–10)
  const allMiddleLabels = middlePlans.flatMap(p => p.stops.map(s => s.label));
  const echo = editorialEchoScore(allMiddleLabels, refPhrases);

  const breakdown = {
    structure,
    richness,
    rhythm,
    paceFit,
    editorialEcho: echo,
  };

  const raw =
    breakdown.structure +
    breakdown.richness +
    breakdown.rhythm +
    breakdown.paceFit +
    breakdown.editorialEcho;

  const score = Math.max(0, Math.min(100, raw));

  const label =
    score >= 82 ? '매우 알찬' :
    score >= 68 ? '알차게 구성됨' :
    score >= 52 ? '무난한 밸런스' :
    score >= 38 ? '여유 위주·심플' : '일정 보강 추천';

  const summary =
    refCount > 0
      ? `목적지 승인 상품 ${refCount}개 일정·하이라이트를 참고해, 풀데이 코스 밀도·시간대 분산·예약형 연계를 반영한 구성 점수입니다.`
      : '승인 상품 일정 참조 샘플이 없어 내부 템플릿 기준으로만 채점했습니다. 목적지 상품이 쌓이면 같은 톤으로 가산됩니다.';

  return {
    score,
    label,
    summary,
    breakdown,
    referencePackagesUsed: refCount,
  };
}

export async function loadReferenceAndScore(
  destination: string,
  dayPlans: DayPlan[],
  travelPace?: string | null,
): Promise<ItineraryCompositionScore> {
  const ref = await loadReferenceItinerarySignals(destination);
  return computeItineraryCompositionScore(dayPlans, {
    travelPace,
    referencePhrases: ref.phrases,
    referencePackageCount: ref.packageCount,
  });
}
