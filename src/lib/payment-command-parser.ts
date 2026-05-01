/**
 * 입출금 채팅식 매칭 — 명령 입력 파서 (Phase 0)
 *
 * 사장님이 어드민 ⌘K에서 `260505_남영선_베스트아시아` 같은 한 줄 입력을
 * 구조화된 토큰(`{ date, customerName, operatorAlias, bookingId }`)으로 분해.
 *
 * 메모 표준 포맷: `출발일_고객명_랜드사약칭` (예: 260505_남영선_베스트아시아)
 * 허용 변형: 공백/슬래시/하이픈 구분, BK-ID 직타, M/D 단축 표기.
 *
 * 정책 (project_payment_command_matching.md):
 *   - 출금은 자동매칭 절대 금지. 이 파서는 사장님 의도 추출만 담당.
 *   - 매칭 분기(A/B/C/D)는 호출자(/api/payments/match-intent)가 결정.
 */

export interface ParsedCommand {
  bookingId?: string;          // "BK-0042" 정규화
  date?: string;               // "YYYY-MM-DD" KST 기준
  dateAmbiguous?: boolean;     // 년도 없는 M/D는 가장 가까운 미래로 추정 → true
  customerName?: string;       // 한글 2~4자 추정 고객명
  operatorAlias?: string;      // 한글 5자+ 또는 두 번째 토큰 = 랜드사 약칭
  rawInput: string;
  hasAnyToken: boolean;
  warnings: string[];
}

const BK_RE = /\bBK-?(\d{3,5})\b/i;
const YYYYMMDD_COMPACT_RE = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/;
const YYMMDD_COMPACT_RE = /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/;
const YYYY_SEP_RE = /(?<!\d)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
const YY_SEP_RE = /(?<!\d)(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
const KR_DATE_RE = /(\d{1,2})월\s*(\d{1,2})일/;
const SHORT_MD_RE = /(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/;
const HANGUL_TOKEN_RE = /[가-힣]{2,8}/g;
const LATIN_TOKEN_RE = /[A-Za-z]{2,30}/g;

const RESERVED_WORDS = new Set([
  '환불', '취소', '예약금', '잔금', '입금', '출금', '수수료',
  '계약금', '결제', '정산', '송금', '이체', '부분환불', '부분',
]);

const RESERVED_LATIN = new Set([
  'REFUND', 'CANCEL', 'FEE', 'TAX', 'VAT', 'PAYMENT',
  'DEPOSIT', 'WITHDRAW', 'TRANSFER', 'PARTIAL', 'PAID',
]);

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function buildIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function resolveAmbiguousDate(month: number, day: number, today: Date = new Date()): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const baseYear = today.getUTCFullYear();
  let candidate = Date.UTC(baseYear, month - 1, day);
  if (candidate < todayUtc) {
    candidate = Date.UTC(baseYear + 1, month - 1, day);
  }
  return buildIsoDate(new Date(candidate).getUTCFullYear(), month, day);
}

function tryExtractDate(remaining: string): { iso?: string; matchedText?: string; ambiguous?: boolean } {
  const yyyy8 = remaining.match(YYYYMMDD_COMPACT_RE);
  if (yyyy8) {
    const iso = buildIsoDate(parseInt(yyyy8[1], 10), parseInt(yyyy8[2], 10), parseInt(yyyy8[3], 10));
    if (iso) return { iso, matchedText: yyyy8[0] };
  }
  const yyyySep = remaining.match(YYYY_SEP_RE);
  if (yyyySep) {
    const iso = buildIsoDate(parseInt(yyyySep[1], 10), parseInt(yyyySep[2], 10), parseInt(yyyySep[3], 10));
    if (iso) return { iso, matchedText: yyyySep[0] };
  }
  const yymmdd = remaining.match(YYMMDD_COMPACT_RE);
  if (yymmdd) {
    const iso = buildIsoDate(2000 + parseInt(yymmdd[1], 10), parseInt(yymmdd[2], 10), parseInt(yymmdd[3], 10));
    if (iso) return { iso, matchedText: yymmdd[0] };
  }
  const yySep = remaining.match(YY_SEP_RE);
  if (yySep) {
    const iso = buildIsoDate(2000 + parseInt(yySep[1], 10), parseInt(yySep[2], 10), parseInt(yySep[3], 10));
    if (iso) return { iso, matchedText: yySep[0] };
  }
  const krDate = remaining.match(KR_DATE_RE);
  if (krDate) {
    const iso = resolveAmbiguousDate(parseInt(krDate[1], 10), parseInt(krDate[2], 10));
    if (iso) return { iso, matchedText: krDate[0], ambiguous: true };
  }
  const shortMd = remaining.match(SHORT_MD_RE);
  if (shortMd) {
    const iso = resolveAmbiguousDate(parseInt(shortMd[1], 10), parseInt(shortMd[2], 10));
    if (iso) return { iso, matchedText: shortMd[0], ambiguous: true };
  }
  return {};
}

export function parseCommandInput(input: string): ParsedCommand {
  // NFKC 정규화 — full-width 숫자(２６０５０５), 일부 호환 한글 → ASCII/일반 형태로 통일.
  // clobe.ai 메모 복붙 시 Unicode 변형 흔함.
  const raw = (input ?? '').normalize('NFKC').trim();
  const result: ParsedCommand = {
    rawInput: raw,
    hasAnyToken: false,
    warnings: [],
  };
  if (!raw) return result;

  let remaining = raw;

  const bkMatch = remaining.match(BK_RE);
  if (bkMatch) {
    result.bookingId = `BK-${bkMatch[1]}`;
    remaining = remaining.replace(bkMatch[0], ' ');
    result.hasAnyToken = true;
  }

  const dateExtraction = tryExtractDate(remaining);
  if (dateExtraction.iso && dateExtraction.matchedText) {
    result.date = dateExtraction.iso;
    if (dateExtraction.ambiguous) result.dateAmbiguous = true;
    remaining = remaining.replace(dateExtraction.matchedText, ' ');
    result.hasAnyToken = true;
  }

  // 한글 + 영문 토큰 수집 (외국인 이름·영문 약칭 land_operator 지원)
  const tokens: string[] = [];
  for (const tok of remaining.match(HANGUL_TOKEN_RE) ?? []) {
    if (!RESERVED_WORDS.has(tok)) tokens.push(tok);
  }
  for (const tok of remaining.match(LATIN_TOKEN_RE) ?? []) {
    if (!RESERVED_LATIN.has(tok.toUpperCase())) tokens.push(tok);
  }

  if (tokens.length === 1) {
    const t = tokens[0];
    // 한글 2~4자 또는 영문 2~6자 = 고객명, 그 외 = 랜드사
    const isShort = /^[가-힣]+$/.test(t) ? t.length <= 4 : t.length <= 6;
    if (isShort) {
      result.customerName = t;
    } else {
      result.operatorAlias = t;
    }
    result.hasAnyToken = true;
  } else if (tokens.length >= 2) {
    result.customerName = tokens[0];
    result.operatorAlias = tokens[tokens.length - 1];
    result.hasAnyToken = true;
    if (tokens.length > 2) {
      result.warnings.push(
        `토큰 ${tokens.length}개 — 첫째(${tokens[0]})를 고객명, 마지막(${tokens[tokens.length - 1]})을 랜드사로 가정`,
      );
    }
  }

  return result;
}
