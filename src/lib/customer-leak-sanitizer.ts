/**
 * @file customer-leak-sanitizer.ts
 * @description 상품 등록 시 추출 데이터(ExtractedData) 전체를 통과시켜
 *              고객 노출 필드에서 운영/커미션/내부 메모 leak을 차단하는 단일 게이트.
 *
 * 트리거 사고: 2026-05-13 나트랑/달랏 등록 — `notices_parsed[INFO]` 에
 * "투어비 9%" (커미션) 그대로 노출. `maskSensitiveRawText` 는 raw_text 만 가렸음.
 *
 * 진입점:
 *   const { cleaned, incidents } = sanitizeForCustomer(extractedData);
 *
 * incidents 는 신뢰도 산식 V2 의 leak penalty 입력으로 사용.
 *
 * 박제 원칙: 정규식 set 만 확장 → 새 패턴은 한 줄로 추가. 필드별 정책은
 * fieldHandlers 테이블 하나로 통제.
 */

// ── Leak 패턴 set (확장 포인트) ────────────────────────────────────────────
// 새 패턴 발견 시 한 줄 추가 + Reflexion memory 박제

export const LEAK_PATTERNS: ReadonlyArray<{
  id: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}> = [
  // 커미션·마진 정보 (CRITICAL — 즉시 차단)
  { id: 'commission_pct',     pattern: /투어비\s*\d{1,2}\s*%/g,                  severity: 'critical', description: '투어비 N% (커미션)' },
  { id: 'comm_korean',        pattern: /(?:^|[^가-힣])컴\s*\d{1,2}\s*%/g,         severity: 'critical', description: '컴 N% (커미션)' },
  { id: 'commission_label',   pattern: /커미션\s*\d{1,2}\s*%/g,                  severity: 'critical', description: '커미션 N%' },
  { id: 'margin_label',       pattern: /마진\s*\d{1,2}\s*%/g,                   severity: 'critical', description: '마진 N%' },
  { id: 'net_price',          pattern: /원가\s*[:：]?\s*[\d,]+/g,                severity: 'critical', description: '원가 노출' },
  { id: 'cost_label',         pattern: /cost\s*[:：]?\s*[\d,]+/gi,               severity: 'critical', description: 'cost 노출' },

  // 랜드사↔여행사 거래 용어 (HIGH — 고객 표현으로 치환 필요)
  { id: 'final_condition',    pattern: /파이널\s*(조건|요청)?/g,                 severity: 'high',     description: '파이널 조건 (B2B 용어)' },
  { id: 'name_list_request',  pattern: /실명단\s*(요청|확정)?\s*(조건)?/g,        severity: 'high',     description: '실명단 요청 (B2B 용어)' },
  { id: 'penalty_b2b',        pattern: /파이널\s*패널티/g,                       severity: 'high',     description: '파이널 패널티 (B2B)' },
  { id: 'land_op_negotiation',pattern: /(?:랜드|랜드사|현지\s*수배)\s*(?:협의|조정)/g, severity: 'high', description: '랜드사 협의 (B2B)' },

  // 호텔 인벤토리·도매 정보 (MEDIUM — 운영자용 메모)
  { id: 'room_inventory',     pattern: /\d+\s*방까지\s*사용/g,                   severity: 'medium',   description: 'N방까지 사용 (도매 인벤토리)' },
  { id: 'room_pax_config',    pattern: /\d+\s*인\s*\d+\s*실/g,                  severity: 'medium',   description: 'N인 N실 (운영 객실 구성)' },
  { id: 'hotel_marker',       pattern: /^\s*HOTEL\s*:\s*해당숙소\s*$/gm,         severity: 'medium',   description: 'HOTEL : 해당숙소 (운영 마커)' },
  { id: 'allotment',          pattern: /allotment\s*\d+/gi,                     severity: 'medium',   description: 'allotment N (호텔 할당)' },
  { id: 'wholesale_rate',     pattern: /(?:net|넷)\s*(?:요금|레이트|rate)/gi,    severity: 'medium',   description: 'NET 요금 (도매가)' },

  // 결제·정산 내부 정보 (HIGH)
  { id: 'deposit_internal',   pattern: /선수금\s*[:：]?\s*[\d,]+/g,              severity: 'high',     description: '선수금 (내부 회계)' },
  { id: 'settlement_internal',pattern: /정산\s*(?:기준|예정)\s*[:：]/g,           severity: 'high',     description: '정산 기준 (내부)' },

  // 연락처 leak (CRITICAL)
  { id: 'internal_phone',     pattern: /(?:0[12]|02|031|032)-\d{3,4}-\d{4}/g,   severity: 'high',     description: '내부 연락처' },
  { id: 'land_op_email',      pattern: /[\w.-]+@(?!yeosonam|gmail|naver|daum|kakao|outlook)[\w.-]+\.(com|co\.kr|net)/g, severity: 'high', description: '외부(랜드사) 이메일' },
];

// ── 결과 타입 ──────────────────────────────────────────────────────────────

export interface LeakIncident {
  patternId: string;
  severity: 'critical' | 'high' | 'medium';
  field: string;          // "notices_parsed[3].text" 같은 JSON path
  matched: string;        // 실제 매치된 문자열 (감사 로그용)
  description: string;
}

export interface SanitizerResult<T> {
  cleaned: T;
  incidents: LeakIncident[];
  /** 모든 incident severity 가중 합산 — 신뢰도 V2 input (0~1) */
  leakScore: number;
}

// ── 코어: 단일 문자열 sanitize ──────────────────────────────────────────────

function sanitizeString(
  input: string,
  fieldPath: string,
  incidents: LeakIncident[],
): string {
  if (!input) return input;
  let out = input;
  for (const rule of LEAK_PATTERNS) {
    const matches = out.match(rule.pattern);
    if (matches) {
      for (const m of matches) {
        incidents.push({
          patternId: rule.id,
          severity: rule.severity,
          field: fieldPath,
          matched: m,
          description: rule.description,
        });
      }
      out = out.replace(rule.pattern, '').replace(/\s{2,}/g, ' ').trim();
      // 줄 단위에서 빈 줄 정리 (• 라인이 비면 라인 자체 제거)
      out = out
        .split('\n')
        .filter(line => !/^[\s•▶\-]*$/.test(line))
        .join('\n');
    }
  }
  return out;
}

// ── 호텔 note 정책: 운영 메모 제거 ─────────────────────────────────────────
// "또는 동급 (매일 40방까지 사용가능, 이후 동급 사용)" → "또는 동급"
function sanitizeHotelNote(input: string | null | undefined, fieldPath: string, incidents: LeakIncident[]): string | null {
  if (!input) return input ?? null;
  // 1차: 일반 leak 통과
  let cleaned = sanitizeString(input, fieldPath, incidents);
  // 2차: 괄호 안에 인벤토리/운영 메모가 들어간 경우 괄호 통째로 제거
  const parenInventory = /\s*\(\s*매일\s*\d+\s*방.*?\)\s*/g;
  if (parenInventory.test(cleaned)) {
    incidents.push({
      patternId: 'hotel_note_inventory',
      severity: 'medium',
      field: fieldPath,
      matched: cleaned.match(parenInventory)?.[0] ?? '',
      description: '호텔 note 괄호 내 인벤토리 메모',
    });
    cleaned = cleaned.replace(parenInventory, '').trim();
  }
  return cleaned || null;
}

// ── 진입점: ExtractedData 전체 통과 ─────────────────────────────────────────

interface NoticeItem { type: string; title: string; text: string }
interface DayHotel { name?: string | null; note?: string | null; grade?: string | null }
interface DaySchedule { activity?: string; note?: string | null }
interface DayBlock { hotel?: DayHotel; schedule?: DaySchedule[] }
interface HighlightsBlock { remarks?: string[]; inclusions?: string[]; excludes?: string[]; shopping?: string | null }
interface ItineraryDataBlock { days?: DayBlock[]; highlights?: HighlightsBlock }

interface SurchargeItem { note?: string | null; period?: string | null; amount_usd?: number | null; amount_krw?: number | null }

export interface CustomerExposedFields {
  title?: string | null;
  destination?: string | null;
  product_summary?: string | null;
  product_highlights?: string[];
  selling_points?: unknown; // ExtractedData 는 객체, 일부 경로는 string. 정책상 sanitize 안 함.
  special_notes?: string | null;
  notices_parsed?: Array<string | NoticeItem>; // legacy 호환 (일부 경로는 string[])
  inclusions?: string[];
  excludes?: string[];
  surcharges?: SurchargeItem[];                // P-2 박제 2026-05-13 (투어비 9% leak 재발 차단)
  itinerary_data?: ItineraryDataBlock;
}

export function sanitizeForCustomer<T extends CustomerExposedFields>(
  ed: T,
): SanitizerResult<T> {
  const incidents: LeakIncident[] = [];
  // shallow clone 후 mutate (원본 보존)
  const cleaned = JSON.parse(JSON.stringify(ed)) as T;

  // 1) 평문 필드
  if (typeof cleaned.title === 'string')           cleaned.title           = sanitizeString(cleaned.title,           'title',           incidents);
  if (typeof cleaned.destination === 'string')     cleaned.destination     = sanitizeString(cleaned.destination,     'destination',     incidents);
  if (typeof cleaned.product_summary === 'string') cleaned.product_summary = sanitizeString(cleaned.product_summary, 'product_summary', incidents);
  if (typeof cleaned.special_notes === 'string')   cleaned.special_notes   = sanitizeString(cleaned.special_notes,   'special_notes',   incidents);
  // selling_points 는 객체 타입(hotel/airline/unique) — 별도 핸들링 안 함

  // 2) 배열 평문
  if (Array.isArray(cleaned.product_highlights)) {
    cleaned.product_highlights = cleaned.product_highlights.map((s, i) => sanitizeString(s, `product_highlights[${i}]`, incidents));
  }
  if (Array.isArray(cleaned.inclusions)) {
    cleaned.inclusions = cleaned.inclusions.map((s, i) => sanitizeString(s, `inclusions[${i}]`, incidents));
  }
  if (Array.isArray(cleaned.excludes)) {
    cleaned.excludes = cleaned.excludes.map((s, i) => sanitizeString(s, `excludes[${i}]`, incidents));
  }

  // 3) notices_parsed[].text (B2B 거래 용어 → 고객 표현 치환)
  if (Array.isArray(cleaned.notices_parsed)) {
    cleaned.notices_parsed = cleaned.notices_parsed.map((n, i) => {
      if (typeof n === 'string') {
        return sanitizeString(n, `notices_parsed[${i}]`, incidents);
      }
      return {
        ...n,
        text: rewriteB2BTerms(sanitizeString(n.text, `notices_parsed[${i}].text`, incidents)),
      };
    });
    // PAYMENT 가 sanitize 후 비었으면 일반화된 안내로 대체
    cleaned.notices_parsed = cleaned.notices_parsed.map(n => {
      if (typeof n === 'string') return n;
      if (n.type === 'PAYMENT' && (!n.text || n.text.trim() === '' || /^[\s•▶]*$/.test(n.text))) {
        return { ...n, text: '• 예약 확정 시 결제 안내를 드립니다.' };
      }
      return n;
    });
  }

  // 3.5) surcharges — leak이 박힐 수 있는 추가 필드 (2026-05-13 박제 — 푸꾸옥 "투어비 9%" 사고)
  if (Array.isArray(cleaned.surcharges)) {
    cleaned.surcharges = cleaned.surcharges.map((s, i) => ({
      ...s,
      note: s.note ? sanitizeString(s.note, `surcharges[${i}].note`, incidents) : s.note,
    }));
    // sanitize 후 note 가 빈 문자열이면 항목 통째로 제거 (의미 없는 surcharge)
    cleaned.surcharges = cleaned.surcharges.filter(s =>
      (s.note && s.note.trim().length > 0) || s.amount_usd || s.amount_krw
    );
  }

  // 4) itinerary_data — 호텔 note + schedule activity/note
  if (cleaned.itinerary_data && typeof cleaned.itinerary_data === 'object') {
    const itin = cleaned.itinerary_data;
    if (Array.isArray(itin.days)) {
      itin.days = itin.days.map((day, di) => {
        const nextDay: DayBlock = { ...day };
        if (nextDay.hotel) {
          nextDay.hotel = {
            ...nextDay.hotel,
            note: sanitizeHotelNote(nextDay.hotel.note, `itinerary_data.days[${di}].hotel.note`, incidents),
          };
        }
        if (Array.isArray(nextDay.schedule)) {
          nextDay.schedule = nextDay.schedule.map((s, si) => ({
            ...s,
            activity: s.activity ? sanitizeString(s.activity, `itinerary_data.days[${di}].schedule[${si}].activity`, incidents) : s.activity,
            note:     s.note     ? sanitizeString(s.note,     `itinerary_data.days[${di}].schedule[${si}].note`,     incidents) : s.note,
          }));
        }
        return nextDay;
      });
    }
    if (itin.highlights) {
      const h = itin.highlights;
      if (Array.isArray(h.remarks))     h.remarks     = h.remarks.map((s, i)     => sanitizeString(s, `itinerary_data.highlights.remarks[${i}]`,     incidents));
      if (Array.isArray(h.inclusions))  h.inclusions  = h.inclusions.map((s, i)  => sanitizeString(s, `itinerary_data.highlights.inclusions[${i}]`,  incidents));
      if (Array.isArray(h.excludes))    h.excludes    = h.excludes.map((s, i)    => sanitizeString(s, `itinerary_data.highlights.excludes[${i}]`,    incidents));
      if (h.shopping)                   h.shopping    = sanitizeString(h.shopping, 'itinerary_data.highlights.shopping', incidents);
    }
  }

  return { cleaned, incidents, leakScore: computeLeakScore(incidents) };
}

// ── B2B 용어 → 고객 표현 치환 (sanitize 단계에서 제거된 자리에 채움) ──────
// 단순 삭제 시 PAYMENT 가 빈 칸이 되므로, 의미 동등한 고객 표현을 미리 매핑.
function rewriteB2BTerms(text: string): string {
  return text
    .replace(/예약시\s*완납\s*(?:및\s*)?(?:파이널)?(?:\s*조건)?/g, '예약 확정 시 전액 결제가 필요한 상품')
    .replace(/(?:LJ|VN|VJ|7C|TW|BX)\s*항공\s*예약시?/g, '예약 시')
    .replace(/조인행사\s*(?:진행될\s*수\s*있으며\s*현지에서\s*옵션\s*안내\s*같이\s*드립니다\.?)/g,
             '다른 출발자와 합류하여 진행될 수 있으며 현지에서 일정 안내드립니다.')
    .replace(/^\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

// ── leak score (0=clean, 1=catastrophic) ───────────────────────────────────
function computeLeakScore(incidents: LeakIncident[]): number {
  if (incidents.length === 0) return 0;
  const weight = { critical: 0.4, high: 0.2, medium: 0.05 };
  let score = 0;
  for (const inc of incidents) score += weight[inc.severity];
  return Math.min(1, score);
}
