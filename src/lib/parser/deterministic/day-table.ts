/**
 * @file day-table.ts — 일정표 (DAY1/DAY2/DAY3 표 형식) deterministic 파서
 *
 * 사장님 솔루션 (2026-05-16): "표 형식 텍스트 파싱이 약하면 나눠서 처리".
 *   LLM 일발 통과 대신 행/열 정규식으로 분리 추출 → LLM 의존 0~1회.
 *
 * 청도 사고 (2026-05-15): Phase 2 일정표 LLM 추출 실패 → itinerary_data=null → 모바일 일정 카드 0.
 *   본 파서로 deterministic 추출 보장.
 *
 * 인식 패턴:
 *   - 행 header: "제N일" (제1일/제2일/제3일 ...)
 *   - 시간: \d{1,2}:\d{2} (24h 또는 +1)
 *   - 항공편 코드: [A-Z]{2}\d{3,4} (SC4610 / LJ883 등)
 *   - 식사: "조:식사명" / "중:식사명" / "석:식사명"
 *   - 호텔: " 󰆹 호텔명 또는 동급" (특수 마커 또는 "호텔" 키워드 + 줄 끝 "또는 동급")
 *   - 활동: ▶ / ♣ / 일반 텍스트
 *
 * 출력: { meta: { airline, flight_out, flight_in, flight_out_time, flight_in_time }, days: [...] }
 */

export interface DayTableSchedule {
  time?: string;
  activity: string;
  type?: 'flight' | 'hotel' | 'shopping';
  transport?: string;
}

export interface DayTableDay {
  day: number;
  regions: string[];
  schedule: DayTableSchedule[];
  meals: {
    breakfast?: string;
    lunch?: string;
    dinner?: string;
  };
  hotel: {
    name: string | null;
    grade: string | null;
  };
}

export interface DayTableResult {
  meta: {
    airline: string | null;
    flight_out: string | null;
    flight_in: string | null;
    flight_out_time: string | null;
    flight_in_time: string | null;
  };
  days: DayTableDay[];
  /** 추출 신뢰도 0~1 — 행 인식 / 항공편 / 호텔 / 식사 모두 채워지면 높음 */
  confidence: number;
}

const DAY_HEADER_RE = /제\s*(\d+)\s*일/g;
const TIME_RE = /(\d{1,2}:\d{2})(\+\d)?/g;
const FLIGHT_CODE_RE = /\b([A-Z]{2})\s*(\d{3,4})\b/;
const MEAL_RE = /(조|중|석)\s*:\s*([^\n]+?)(?=$|\s{2,})/g;
const HOTEL_RE = /([가-힣A-Za-z0-9\s·]+?)\s*(?:호텔|리조트|레지던스)\s*(?:또는\s*동급)?(?:\s*\(([^)]+)\))?/;
const HOTEL_GRADE_RE = /\((\d성|준\d성)\)/;
const REGION_KEYWORDS = new Set([
  '인천','김포','부산','제주',
  '청도','칭다오','대만','타이베이','상해','북경','계림','양삭','서안','장가계',
  '도쿄','오사카','후쿠오카','삿포로','오키나와','교토','나라','벳부','사가',
  '방콕','치앙마이','푸켓','파타야',
  '하노이','다낭','호이안','나트랑','달랏','호치민','푸꾸옥',
  '세부','보홀','보라카이','마닐라',
  '발리','쿠알라룸푸르','싱가포르','홍콩','마카오',
]);

/** "제N일" 위치로 일정표 영역을 N개 블록으로 분할 */
function splitByDay(text: string): Array<{ day: number; body: string }> {
  const matches: Array<{ day: number; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  // RE 재시작 위해 stateful exec 사용
  const re = new RegExp(DAY_HEADER_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    matches.push({ day: Number(m[1]), start: m.index, end: -1 });
  }
  if (matches.length === 0) return [];
  for (let i = 0; i < matches.length; i++) {
    matches[i].end = i + 1 < matches.length ? matches[i + 1].start : text.length;
  }
  return matches.map(x => ({ day: x.day, body: text.slice(x.start, x.end) }));
}

function extractTimes(body: string): string[] {
  const out: string[] = [];
  const re = new RegExp(TIME_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = m[1] + (m[2] ?? '');
    out.push(t);
  }
  return out;
}

function extractFlightCode(body: string): string | null {
  const m = FLIGHT_CODE_RE.exec(body);
  return m ? `${m[1]}${m[2]}` : null;
}

function extractRegions(body: string): string[] {
  const lines = body.split('\n').slice(0, 8); // 상단 라인만 본다 (헤더 영역)
  const regions: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 2 || trimmed.length > 12) continue;
    // 정확 일치 키워드
    for (const kw of REGION_KEYWORDS) {
      if (trimmed === kw && !regions.includes(kw)) regions.push(kw);
    }
  }
  return regions;
}

function extractMeals(body: string): DayTableDay['meals'] {
  const meals: DayTableDay['meals'] = {};
  const re = new RegExp(MEAL_RE.source, 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const key = m[1] === '조' ? 'breakfast' : m[1] === '중' ? 'lunch' : 'dinner';
    const value = m[2].trim().split(/\s{2,}|\n/)[0]; // 첫 토큰만
    if (value.length > 0 && value.length < 30) {
      meals[key] = value;
    }
  }
  return meals;
}

function extractHotel(body: string): DayTableDay['hotel'] {
  // " 󰆹 " 마커 또는 "호텔 또는 동급" 패턴 라인
  const lines = body.split('\n');
  for (const line of lines) {
    if (!/(호텔|리조트|레지던스).*(또는\s*동급)?/.test(line)) continue;
    const cleaned = line.replace(/[\s󰆹·]+/g, ' ').trim();
    const m = HOTEL_RE.exec(cleaned);
    if (m) {
      const name = `${m[1].trim()} ${cleaned.match(/(호텔|리조트|레지던스)/)?.[1] ?? '호텔'}`;
      const gradeMatch = HOTEL_GRADE_RE.exec(line);
      return { name: name.trim() || null, grade: gradeMatch ? gradeMatch[1] : null };
    }
  }
  return { name: null, grade: null };
}

function extractSchedule(body: string, dayFlightCode: string | null, dayTimes: string[]): DayTableSchedule[] {
  const out: DayTableSchedule[] = [];
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length >= 2);

  let flightIdx = 0;
  for (const line of lines) {
    if (/^제\s*\d+\s*일/.test(line)) continue; // 헤더 자체 skip
    if (HOTEL_RE.test(line) && /또는\s*동급/.test(line)) continue; // 호텔 라인은 별도 처리
    if (/^[가-힣]{2,3}$/.test(line) && REGION_KEYWORDS.has(line)) continue; // 지역명 단독
    if (/^[A-Z]{2}\d{3,4}$/.test(line)) continue; // 항공편 코드 단독 라인
    if (/^\d{1,2}:\d{2}(\+\d)?$/.test(line)) continue; // 시간 단독 라인
    if (/^전\s*일$/.test(line)) continue; // "전일" 단독
    if (/^전용\s*차량$/.test(line)) continue;
    if (/^(조|중|석)\s*:/.test(line)) continue; // 식사 라인 (별도 처리)

    // 출발/도착 라인 + 시간 매핑
    if (/(출발|도착|출국|입국|미팅|투숙|체크\s*[인아])/.test(line)) {
      const t = dayTimes[flightIdx];
      flightIdx++;
      out.push({
        time: t,
        activity: line,
        ...(dayFlightCode && /(출발|도착)/.test(line) ? { type: 'flight' as const, transport: dayFlightCode } : {}),
      });
      continue;
    }

    // 일반 활동 (▶ / ♣ / 그냥 텍스트)
    out.push({ activity: line });
  }

  return out;
}

/**
 * Public: raw text 일정표 영역 → deterministic 파싱
 */
export function parseDayTable(rawText: string): DayTableResult {
  const blocks = splitByDay(rawText);
  if (blocks.length === 0) {
    return {
      meta: { airline: null, flight_out: null, flight_in: null, flight_out_time: null, flight_in_time: null },
      days: [],
      confidence: 0,
    };
  }

  const days: DayTableDay[] = blocks.map(({ day, body }) => {
    const code = extractFlightCode(body);
    const times = extractTimes(body);
    return {
      day,
      regions: extractRegions(body),
      schedule: extractSchedule(body, code, times),
      meals: extractMeals(body),
      hotel: extractHotel(body),
    };
  });

  // 첫 블록의 항공편 = flight_out, 마지막 블록 = flight_in
  const firstCode = extractFlightCode(blocks[0].body);
  const lastCode = blocks.length > 1 ? extractFlightCode(blocks[blocks.length - 1].body) : null;
  const firstTimes = extractTimes(blocks[0].body);
  const lastTimes = blocks.length > 1 ? extractTimes(blocks[blocks.length - 1].body) : [];

  // 항공사 추론 (코드 prefix 매핑)
  const AIRLINE_MAP: Record<string, string> = {
    SC: '산동항공',
    LJ: '진에어',
    BX: '에어부산',
    KE: '대한항공',
    OZ: '아시아나',
    '7C': '제주항공',
    TW: '티웨이',
    RS: '에어서울',
    VJ: '베트젯',
    VN: '베트남항공',
    JL: '일본항공',
    NH: '전일본공수',
    CZ: '중국남방',
    MU: '중국동방',
    CA: '중국국제',
    CI: '중화항공',
    BR: '에바항공',
  };
  const prefix = firstCode?.slice(0, 2);
  const airline = prefix && AIRLINE_MAP[prefix] ? AIRLINE_MAP[prefix] : null;

  // 신뢰도: 블록 수 + 호텔 + 식사 + 항공편 각 0.25
  const hotelOk = days.some(d => d.hotel.name);
  const mealsOk = days.some(d => Object.keys(d.meals).length >= 1);
  const flightOk = !!firstCode;
  const blocksOk = blocks.length >= 2;
  const confidence = Number(blocksOk) * 0.4 + Number(hotelOk) * 0.2 + Number(mealsOk) * 0.2 + Number(flightOk) * 0.2;

  return {
    meta: {
      airline,
      flight_out: firstCode,
      flight_in: lastCode,
      flight_out_time: firstTimes[0] ?? null,
      flight_in_time: lastTimes[0] ?? null,
    },
    days,
    confidence,
  };
}
