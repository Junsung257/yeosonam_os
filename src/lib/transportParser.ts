/**
 * 통합 교통수단 파서
 *
 * - 항공/열차: 같은 day 내 look-ahead 2 → pair 병합
 * - 선박: 전체 days를 flat 순회하여 cross-day pair 병합
 * - 파서 오류 시 원본 유지 (폴백)
 */

// ── 타입 ─────────────────────────────────────────────────
export interface ScheduleItem {
  time?: string | null;
  activity: string;
  transport?: string | null;
  type?: string;
  note?: string | null;
  badge?: string | null;
}

export type TransportMode = 'air' | 'ship' | 'train';

export interface TransportSegment {
  type: 'transport';
  mode: TransportMode;
  isSingle: boolean;
  label: string;
  from: string | null;
  to: string | null;
  code: string | null;
  carrier: string | null;
  depTime: string | null;
  arrTime: string | null;
  nextDay: boolean;
  durationText: string | null;
}

export type ParsedScheduleItem = ScheduleItem | TransportSegment;

export interface DayLike {
  day: number;
  schedule?: ScheduleItem[];
  [key: string]: unknown;
}

// ── 항공사 코드 → 이름 맵 ────────────────────────────────
const AIRLINE_CODE_TO_NAME: Record<string, string> = {
  BX: '에어부산', LJ: '진에어', '7C': '제주항공', TW: '티웨이항공',
  VJ: '비엣젯', ZE: '이스타항공', KE: '대한항공', OZ: '아시아나항공',
  CZ: '중국남방항공', MU: '중국동방항공', SC: '산동항공', CA: '중국국제항공',
  QV: '라오항공', D7: '에어아시아', '5J': '세부퍼시픽', VN: '베트남항공',
  RS: '에어서울', JL: '일본항공', NH: '전일본공수',
};

// parser.ts의 normalizeAirlineCode 인라인 (pdf-parse 의존성 회피)
function normalizeAirlineCode(raw?: string): string | undefined {
  if (!raw || raw.trim() === '') return undefined;
  const s = raw.trim();
  if (/^[A-Z0-9]{2}$/.test(s)) return s;
  const flightMatch = s.match(/^([A-Z]{2}|\d[A-Z])\d{2,4}/);
  if (flightMatch) return flightMatch[1];
  return undefined;
}

// ── 타입 가드 ────────────────────────────────────────────
export function isTransportSegment(item: ParsedScheduleItem): item is TransportSegment {
  return (item as TransportSegment).type === 'transport';
}

// ── 패턴 ─────────────────────────────────────────────────
const FLIGHT_CODE_PATTERN = /^([A-Z]{2}|\d[A-Z])\d{2,4}$/;
const TRAIN_CODE_PATTERN = /^[CDGKTZ]\d+$/;
const TRAIN_ACTIVITY_PATTERN = /고속열차|KTX|기차/;

// air/train 공통 출발/도착
const DEP_PATTERN = /출발|향발/;
const ARR_PATTERN = /도착|입국/;

// ship 전용 (엄격) — "부두 도착"/"승선" 제외 (탑승 전 행위)
const SHIP_DEP_PATTERN = /출항|향발/;
const SHIP_ARR_PATTERN = /하선|입항|여객터미널\s*도착/;

const DURATION_PATTERN = /(약\s?\d+시간(\s?\d+분)?|약\s?\d+분)/;

// 교통 오감지 차단: "기차역으로 이동", "공항으로 이동" 같은 이동 설명만 차단.
// "기차역에서 출발" 같은 실제 교통 출발은 유지 (출발/도착 키워드와 결합된 경우는 dep/arr 로직이 처리).
const EXCLUDE_TRANSPORT_PATTERN = /(기차역|공항|부두|터미널)\s*으로\s*이동|집결|선내\s*휴식|^\s*대기/;
// 관광지 마커 패턴: ▶달랏기차역, ●공항 등 불릿 뒤 교통수단명 → 관광지로 간주
const POI_MARKER_TRANSPORT_PATTERN = /^[▶●◆※•★]\s*.*(기차역|공항|터미널|부두|항구|역)(\s|$|관광|방문|구경)/;

// ── 감지 함수 (air/train 전용) ───────────────────────────
function detectMode(item: ScheduleItem): Extract<TransportMode, 'air' | 'train'> | null {
  const activity = item.activity || '';
  // 오감지 차단: 이동행위/준비 키워드나 관광지 마커가 있으면 교통 감지 스킵
  if (EXCLUDE_TRANSPORT_PATTERN.test(activity)) return null;
  if (POI_MARKER_TRANSPORT_PATTERN.test(activity)) return null;

  const transport = (item.transport || '').trim();
  if (item.type === 'flight' || FLIGHT_CODE_PATTERN.test(transport)) return 'air';
  if (item.type === 'train' || TRAIN_CODE_PATTERN.test(transport) || TRAIN_ACTIVITY_PATTERN.test(activity)) {
    return 'train';
  }
  return null;
}

function isDeparture(item: ScheduleItem): boolean {
  return DEP_PATTERN.test(item.activity || '');
}

function isArrival(item: ScheduleItem): boolean {
  return ARR_PATTERN.test(item.activity || '');
}

function detectShipRole(item: ScheduleItem): 'dep' | 'arr' | null {
  const activity = item.activity || '';
  if (SHIP_DEP_PATTERN.test(activity)) return 'dep';
  if (SHIP_ARR_PATTERN.test(activity)) return 'arr';
  return null;
}

// ── 도시 추출 ────────────────────────────────────────────
function extractCity(activity: string, isDep: boolean): string | null {
  const pattern = isDep
    ? /^(.+?)\s*(국제)?공항?\s*(출발|향발)/
    : /^(.+?)\s*(국제)?공항?\s*(도착|입국)/;
  const m = activity.match(pattern);
  return m ? m[1].trim() : null;
}

function extractShipCity(activity: string, isDep: boolean): string | null {
  if (isDep) {
    // "부산항 출항" → 부산 / "시모노세키항 출항 / 부산 향발" → 시모노세키 (첫 번째 매칭)
    const m1 = activity.match(/^(.+?)(?:항|국제여객터미널|여객터미널|터미널)\s*출항/);
    if (m1) return m1[1].trim();
    const m2 = activity.match(/(.+?)\s*향발/);
    if (m2) return m2[1].trim();
    return null;
  }
  // 도착
  const m1 = activity.match(/^(.+?)(?:항|국제여객터미널|여객터미널|터미널)\s*(하선|입항|도착)/);
  if (m1) return m1[1].trim();
  return null;
}

// ── 유틸 ─────────────────────────────────────────────────
function extractDuration(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(DURATION_PATTERN);
    if (m) return m[1];
  }
  return null;
}

// ── segment 생성 ─────────────────────────────────────────
function makeSingleSegment(item: ScheduleItem, mode: TransportMode): TransportSegment {
  const isDep = isDeparture(item);
  const isArr = isArrival(item);
  const time = item.time ?? null;
  // 방어: isDep && isArr 동시 true → depTime만 사용 (arrTime null)
  let depTime: string | null = null;
  let arrTime: string | null = null;
  if (isDep && !isArr) depTime = time;
  else if (isArr && !isDep) arrTime = time;
  else if (isDep && isArr) depTime = time; // 중복 방지
  else depTime = time;

  return {
    type: 'transport',
    mode,
    isSingle: true,
    label: item.activity || '',
    from: null,
    to: null,
    code: item.transport ?? null,
    carrier: null,
    depTime,
    arrTime,
    nextDay: false,
    durationText: extractDuration(item.activity, item.note),
  };
}

function mergeAirTrainPair(dep: ScheduleItem, arr: ScheduleItem, mode: 'air' | 'train'): TransportSegment {
  const depCity = extractCity(dep.activity || '', true);
  const arrCity = extractCity(arr.activity || '', false);
  const code = dep.transport ?? null;

  let carrier: string | null = null;
  if (mode === 'air' && code) {
    const airlineCode = normalizeAirlineCode(code);
    if (airlineCode && AIRLINE_CODE_TO_NAME[airlineCode]) {
      carrier = AIRLINE_CODE_TO_NAME[airlineCode];
    }
  }

  const depTime = dep.time ?? null;
  const arrTime = arr.time ?? null;
  const nextDay = !!(depTime && arrTime && arrTime < depTime);
  const durationText = extractDuration(dep.activity, dep.note, arr.activity, arr.note);

  return {
    type: 'transport',
    mode,
    isSingle: false,
    label: dep.activity || '',
    from: depCity,
    to: arrCity,
    code,
    carrier,
    depTime,
    arrTime,
    nextDay,
    durationText,
  };
}

function mergeShipPair(dep: ScheduleItem, arr: ScheduleItem): TransportSegment {
  const depCity = extractShipCity(dep.activity || '', true);
  const arrCity = extractShipCity(arr.activity || '', false);

  const depTime = dep.time ?? null;
  const arrTime = arr.time ?? null;
  const nextDay = !!(depTime && arrTime && arrTime < depTime);
  const durationText = extractDuration(dep.activity, dep.note, arr.activity, arr.note);

  return {
    type: 'transport',
    mode: 'ship',
    isSingle: false,
    label: dep.activity || '',
    from: depCity,
    to: arrCity,
    code: dep.transport ?? null,
    carrier: null,
    depTime,
    arrTime,
    nextDay,
    durationText,
  };
}

// ══════════════════════════════════════════════════════════
// 메인 API: parseDaysWithTransport
// ══════════════════════════════════════════════════════════

export interface ParsedDay extends DayLike {
  parsedSchedule: ParsedScheduleItem[];
}

export function parseDaysWithTransport(days: DayLike[]): ParsedDay[] {
  try {
    if (!Array.isArray(days) || days.length === 0) return [];

    // Step 1: flat 배열 생성 — 각 항목에 dayIdx, itemIdx 추적
    interface FlatItem { dayIdx: number; itemIdx: number; item: ScheduleItem; }
    const flat: FlatItem[] = [];
    days.forEach((d, dayIdx) => {
      (d.schedule || []).forEach((item, itemIdx) => {
        flat.push({ dayIdx, itemIdx, item });
      });
    });

    // Step 2: ship cross-day pair 병합
    // consumedDep: "dayIdx:itemIdx" — dep 항목은 Ship Bar로 치환되어 원본 제거
    // (arr 항목은 유지 — 도착 day의 일반 일정으로 남겨 "08:00 부산 국제여객터미널 도착" 표시)
    // shipInserts: dayIdx → { insertAfter: itemIdx; segment } 삽입 예약
    const consumedDep = new Set<string>();
    const pairedArrKeys = new Set<string>(); // 중복 pair 방지용
    const shipInserts = new Map<number, Array<{ insertAfterItemIdx: number; segment: TransportSegment }>>();

    for (let i = 0; i < flat.length; i++) {
      const depEntry = flat[i];
      const depKey = `${depEntry.dayIdx}:${depEntry.itemIdx}`;
      if (consumedDep.has(depKey)) continue;
      if (detectShipRole(depEntry.item) !== 'dep') continue;

      // 다음 ship arr 탐색
      for (let j = i + 1; j < flat.length; j++) {
        const arrEntry = flat[j];
        const arrKey = `${arrEntry.dayIdx}:${arrEntry.itemIdx}`;
        if (pairedArrKeys.has(arrKey)) continue;
        if (detectShipRole(arrEntry.item) === 'arr') {
          // pair 성공 → 병합
          const segment = mergeShipPair(depEntry.item, arrEntry.item);
          consumedDep.add(depKey);
          pairedArrKeys.add(arrKey); // 다른 dep와 중복 매칭 방지
          if (!shipInserts.has(depEntry.dayIdx)) shipInserts.set(depEntry.dayIdx, []);
          shipInserts.get(depEntry.dayIdx)!.push({
            insertAfterItemIdx: depEntry.itemIdx,
            segment,
          });
          break;
        }
      }
    }

    // Step 3: 각 day 재구성
    //   - consumed 항목 제거
    //   - ship segment 삽입 (dep 위치에)
    //   - 나머지 잔여 항목에 대해 air/train 파서 실행
    return days.map((d, dayIdx) => {
      const origSchedule = d.schedule || [];
      const inserts = shipInserts.get(dayIdx) || [];
      const insertMap = new Map<number, TransportSegment>();
      inserts.forEach(ins => insertMap.set(ins.insertAfterItemIdx, ins.segment));

      // dep 항목만 ship segment로 치환 (arr 항목은 일반 일정으로 유지)
      const stage1: ParsedScheduleItem[] = [];
      origSchedule.forEach((item, itemIdx) => {
        const key = `${dayIdx}:${itemIdx}`;
        if (insertMap.has(itemIdx)) {
          // ship dep였던 위치 → segment로 교체
          stage1.push(insertMap.get(itemIdx)!);
        } else if (!consumedDep.has(key)) {
          // dep가 아닌 모든 항목 (arr 포함) → 일반 렌더링 유지
          stage1.push(item);
        }
      });

      // Step 4: 잔여 ScheduleItem들에 대해 air/train 파서 실행
      //   - ship segment는 이미 있으므로 건너뜀
      const parsedSchedule = parseAirTrainSegments(stage1);

      return { ...d, parsedSchedule };
    });
  } catch (err) {
    console.warn('[transportParser] parseDaysWithTransport 실패, 원본 반환:', err);
    return days.map(d => ({ ...d, parsedSchedule: (d.schedule || []) as ParsedScheduleItem[] }));
  }
}

// ── air/train 전용 파서 (ship은 이미 처리됨) ──────────────
function parseAirTrainSegments(items: ParsedScheduleItem[]): ParsedScheduleItem[] {
  const result: ParsedScheduleItem[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (consumed.has(i)) continue;

    const item = items[i];
    if (isTransportSegment(item)) {
      result.push(item);
      continue;
    }

    const mode = detectMode(item);
    if (!mode) {
      result.push(item);
      continue;
    }

    // 출발이면 look-ahead 2 pair 시도
    if (isDeparture(item)) {
      let paired = false;
      const maxJ = Math.min(i + 2, items.length - 1);
      for (let j = i + 1; j <= maxJ; j++) {
        if (consumed.has(j)) continue;
        const next = items[j];
        if (isTransportSegment(next)) continue;
        // arr 후보는 mode 감지 생략 — isArrival()만 체크
        // (dep가 이미 mode 결정. arr 항목의 type이 'normal'이어도 병합 허용)
        // 단, arr 후보가 오감지 차단 키워드를 포함하면 제외
        const nextActivity = (next as ScheduleItem).activity || '';
        if (EXCLUDE_TRANSPORT_PATTERN.test(nextActivity)) continue;
        if (POI_MARKER_TRANSPORT_PATTERN.test(nextActivity)) continue;
        if (isArrival(next)) {
          result.push(mergeAirTrainPair(item, next as ScheduleItem, mode));
          consumed.add(j);
          paired = true;
          break;
        }
      }
      // pair 실패 → TransportBar 생성 안 함, 원본 유지 (일반 불릿으로 렌더)
      if (!paired) result.push(item);
      continue;
    }

    // 단독 도착 항목 → 원본 유지
    if (isArrival(item)) {
      result.push(item);
      continue;
    }

    // 교통 모드지만 출발/도착 키워드 없음 → 원본 유지
    result.push(item);
  }

  return result;
}

// ── 기존 API 호환용 (schedule 단일 배열) ─────────────────
// air/train 전용으로만 동작. 외부 호출자가 있을 경우 그대로 사용 가능.
export function parseTransportSegments(schedule: ScheduleItem[]): ParsedScheduleItem[] {
  try {
    if (!Array.isArray(schedule) || schedule.length === 0) return [];
    return parseAirTrainSegments(schedule as ParsedScheduleItem[]);
  } catch (err) {
    console.warn('[transportParser] parseTransportSegments 실패, 원본 반환:', err);
    return schedule as ParsedScheduleItem[];
  }
}
