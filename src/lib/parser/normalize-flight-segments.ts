/**
 * @file normalize-flight-segments.ts
 * @description schedule[type='flight'] 흩어진 항공편을 정규 flight_segments 로 박제.
 *
 * 박제 사유 (2026-05-13): 나트랑/달랏 등록 — DAY 4 "23:55 출발", DAY 5 "06:40 부산 도착"이
 * 같은 항공편(LJ 116)인데 schedule 두 day 에 쪼개져 transport=null/도착시간 누락으로 카드 깨짐.
 *
 * 출력 스키마 (itinerary_data.flight_segments):
 *   [{ leg, flight_no, dep_airport, dep_time, arr_airport, arr_time, arr_day_offset, day_pair }]
 *
 * - leg: 'outbound' | 'inbound'
 * - day_pair: [dep_day_index, arr_day_index] — 익일 도착이면 다름
 * - arr_day_offset: 0 (당일) | 1 (익일)
 *
 * DetailClient.tsx 의 flight card 렌더는 이 정규 필드 우선 소비 (점진 마이그레이션).
 * 기존 schedule[type='flight'] 은 텍스트 표기만 담당.
 */

export interface FlightSegment {
  leg:            'outbound' | 'inbound';
  flight_no:      string | null;
  dep_airport:    string | null;
  dep_time:       string | null;
  arr_airport:    string | null;
  arr_time:       string | null;
  arr_day_offset: 0 | 1;
  day_pair:       [number, number]; // [출발 day index (0-based), 도착 day index]
}

// 다른 필드 보존을 위해 [key: string]: unknown 허용 — TravelItinerary 와 호환
interface ScheduleItem {
  time?:      string | null;
  activity?:  string | null;
  transport?: string | null;
  type?:      string | null;
  note?:      string | null;
  [key: string]: unknown;
}

interface DayBlock {
  day?:      number;
  regions?:  string[];
  schedule?: ScheduleItem[];
  [key: string]: unknown;
}

interface ItineraryDataLike {
  days?: DayBlock[];
  meta?: { airline?: string | null; departure_airport?: string | null; destination?: string | null; [key: string]: unknown };
  flight_segments?: FlightSegment[];
  [key: string]: unknown;
}

/** activity 텍스트가 "출발" / "도착" 의미인지 판정 */
function classifyActivity(activity: string | null | undefined): 'depart' | 'arrive' | 'other' {
  if (!activity) return 'other';
  if (/출발/.test(activity)) return 'depart';
  if (/도착/.test(activity)) return 'arrive';
  return 'other';
}

/** activity 안의 도시명 추출 (e.g. "부산 국제공항 출발" → "부산") */
function extractCity(activity: string | null | undefined): string | null {
  if (!activity) return null;
  // "X 국제공항 출발/도착" 또는 "X 공항 출발/도착" 또는 "X 출발/도착"
  const m = activity.match(/^([\w가-힣]+?)\s*(?:국제)?\s*공항/);
  if (m) return m[1];
  const m2 = activity.match(/^([\w가-힣]+?)\s*(?:출발|도착)/);
  if (m2) return m2[1];
  return null;
}

/**
 * 두 flight schedule item을 (출발, 도착) 쌍으로 매칭.
 * 휴리스틱:
 *   - 같은 day 안에 depart + arrive 둘 다 있으면 매칭
 *   - 첫째 day 에 depart 만 있고 둘째 day 에 arrive 있으면 익일 도착 매칭
 *   - flight_no 가 같으면 우선
 */
export function normalizeFlightSegments(itin: ItineraryDataLike | null | undefined): ItineraryDataLike | null | undefined {
  if (!itin || !Array.isArray(itin.days) || itin.days.length === 0) return itin;

  // 모든 flight item을 (day_index, item) 으로 수집
  const flightItems: Array<{ dayIdx: number; item: ScheduleItem; kind: 'depart' | 'arrive' | 'other'; city: string | null }> = [];
  itin.days.forEach((day, di) => {
    (day.schedule ?? []).forEach(s => {
      if (s.type === 'flight') {
        flightItems.push({
          dayIdx: di,
          item: s,
          kind: classifyActivity(s.activity),
          city: extractCity(s.activity),
        });
      }
    });
  });

  if (flightItems.length === 0) return itin;

  // 페어링: 시간 순서로 depart→arrive 짝짓기
  const segments: FlightSegment[] = [];
  const used = new Set<number>();
  for (let i = 0; i < flightItems.length; i++) {
    if (used.has(i)) continue;
    const cur = flightItems[i];
    if (cur.kind !== 'depart') continue;

    // 다음 flight item 중 가장 가까운 arrive 찾기
    let pairIdx = -1;
    for (let j = i + 1; j < flightItems.length; j++) {
      if (used.has(j)) continue;
      if (flightItems[j].kind === 'arrive') { pairIdx = j; break; }
      // 다음 depart 가 먼저 오면 현재는 짝이 없음
      if (flightItems[j].kind === 'depart') break;
    }

    if (pairIdx === -1) {
      // 짝 없는 출발 — 단독 segment
      segments.push({
        leg:            segments.length === 0 ? 'outbound' : 'inbound',
        flight_no:      cur.item.transport ?? null,
        dep_airport:    cur.city,
        dep_time:       cur.item.time ?? null,
        arr_airport:    null,
        arr_time:       null,
        arr_day_offset: 0,
        day_pair:       [cur.dayIdx, cur.dayIdx],
      });
      used.add(i);
      continue;
    }

    const pair = flightItems[pairIdx];
    const dayDelta = pair.dayIdx - cur.dayIdx;
    segments.push({
      leg:            segments.length === 0 ? 'outbound' : 'inbound',
      flight_no:      cur.item.transport ?? pair.item.transport ?? null,
      dep_airport:    cur.city,
      dep_time:       cur.item.time ?? null,
      arr_airport:    pair.city,
      arr_time:       pair.item.time ?? null,
      arr_day_offset: dayDelta >= 1 ? 1 : 0,
      day_pair:       [cur.dayIdx, pair.dayIdx],
    });
    used.add(i);
    used.add(pairIdx);
  }

  // 짝 없이 남은 arrive 도 단독 segment 로
  for (let i = 0; i < flightItems.length; i++) {
    if (used.has(i)) continue;
    const cur = flightItems[i];
    if (cur.kind !== 'arrive') continue;
    segments.push({
      leg:            segments.length === 0 ? 'outbound' : 'inbound',
      flight_no:      cur.item.transport ?? null,
      dep_airport:    null,
      dep_time:       null,
      arr_airport:    cur.city,
      arr_time:       cur.item.time ?? null,
      arr_day_offset: 0,
      day_pair:       [cur.dayIdx, cur.dayIdx],
    });
    used.add(i);
  }

  // 두 번째 이후를 inbound 로 강제 라벨
  segments.forEach((seg, idx) => {
    if (idx === 0) seg.leg = 'outbound';
    else if (idx === segments.length - 1) seg.leg = 'inbound';
  });

  return { ...itin, flight_segments: segments };
}
