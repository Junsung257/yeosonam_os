/**
 * 카탈로그형 원문을 일정표 헤더 기준으로 분할 (Lost-in-the-middle 완화).
 * 각 섹션 = 한 상품의 `[코드]…일정표`부터 다음 동일 헤더 직전까지.
 * 공통 가격표 등은 sharedPrefix.
 *
 * document-router.ts 와 동일한 헤더 규칙을 쓰도록 헬퍼를 export 한다.
 */

export interface CatalogSplitResult {
  /** 첫 `[XX]…일정표` 이전 전체(가격·공통 안내 등) */
  sharedPrefix: string;
  /** 각 일정표 블록(헤더 줄부터 다음 헤더 직전까지) — 길이 = 상품 수 */
  sections: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  2026-05-19 박제 (사장님 5 카탈로그 실측 사고 — 근본 박제):
//
//  기존 regex 두 개 모두 "일정 표" 키워드를 강제했음.
//  실측 결과 한국 여행사 카탈로그 80%+ 헤더에 "일정표" 키워드 없음:
//    - [BX] 대만 단수이 3박 4일                          ← "일정표" 없음
//    - 울란바토르, 테를지초원 3박 5일【금】              ← 대괄호 코드도 없음
//    - [VJ] 베트남 하노이/하롱/옌뜨 3박5일 ☑노팁노옵션  ← "일정표" 없음
//    - [VN] 베트남 하노이/하롱베이/옌뜨 3박5일           ← "일정표" 없음
//    - [부관훼리] 초특가 가성비 무박3일 PKG              ← 한글 코드 + "일정표" 없음
//
//  2달간 catalog-pre-split.ts 0회 수정 + 32개 PR 우회 (FACE Engine 도 안 만짐).
//  사장님이 paste-and-parse N번으로 우회해 사고가 인지 안 됨.
//  본질 박제: regex 확장 + 5 실제 케이스 fixture vitest 강제.
// ═══════════════════════════════════════════════════════════════════════════

/** [LEGACY] 대괄호 + 영숫자 코드 + "일정표" — 가장 보수적 (false positive 0) */
const ITIN_HEADER_LINE_RE =
  /(?:^|\n)((?:\d+[.)]\s*)?[\[【［][A-Z0-9]{2,4}[\]】］][^\n]*일정\s*표)/gi;

/** [LEGACY] 글머리(■◆ 등) + "일정표" */
const ITIN_HEADER_BULLET_RE =
  /(?:^|\n)((?:\d+[.)]\s*)?[■◆▶▪・●○◎◇□]\s*[^\n]{0,120}일정\s*표)/gi;

/**
 * [NEW] 대괄호 (반각/전각) + 코드 (영숫자 OR 한글) + "N박 M일" — 베트남/대만/부관훼리.
 * 매칭 예:
 *   - "[BX] 대만 단수이 3박 4일"
 *   - "[VJ] 베트남 하노이/하롱/옌뜨 3박5일 ☑노팁노옵션"
 *   - "[부관훼리] 초특가 가성비 무박3일 PKG"
 */
const HEADER_BRACKET_NIGHTS_RE =
  /(?:^|\n)((?:\d+[.)]\s*)?[\[【［][^\]】］\n]{1,12}[\]】］][^\n]{0,80}\d+박\s*\d+일[^\n]{0,40})/g;

/**
 * [NEW] 대괄호 없는 헤더 + "N박 M일" + 전각 요일【금】/【월】 — 몽골 LJ 패턴.
 * 매칭 예: "울란바토르, 테를지초원 3박 5일【금】"
 */
const HEADER_PLAIN_NIGHTS_DOW_RE =
  /(?:^|\n)([^\n\[【]{2,60}\d+박\s*\d+일\s*[\[【][월화수목금토일][\]】][^\n]{0,20})/g;

/**
 * [NEW] 대괄호 코드 + "무박N일" — 부관훼리 같은 페리 패키지.
 * 매칭 예: "[부관훼리] 초특가 가성비 무박3일 PKG"
 */
const HEADER_NOBAK_RE =
  /(?:^|\n)((?:\d+[.)]\s*)?[\[【［][^\]】］\n]{1,12}[\]】］][^\n]{0,80}무박\s*\d+일[^\n]{0,40})/g;

/** 두 패턴에서 헤더 시작 문자 인덱스 수집 → 근접 중복 제거 */
export function collectItineraryHeaderStarts(raw: string): number[] {
  const text = raw.replace(/\r\n/g, '\n');
  const starts = new Set<number>();

  const run = (pattern: RegExp) => {
    const r = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      const g1 = m[1];
      if (!g1) continue;
      const offsetInFull = m[0].indexOf(g1[0]);
      starts.add(m.index + offsetInFull);
    }
  };

  // 기존 보수적 패턴 (일정표 키워드)
  run(ITIN_HEADER_LINE_RE);
  run(ITIN_HEADER_BULLET_RE);
  // 신규 확장 패턴 (N박 M일 + 다양한 헤더 포맷)
  run(HEADER_BRACKET_NIGHTS_RE);
  run(HEADER_PLAIN_NIGHTS_DOW_RE);
  run(HEADER_NOBAK_RE);

  const sorted = [...starts].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted;

  // MIN_GAP 8 — 두 헤더 패턴이 같은 줄에서 중복 매칭되는 경우만 dedupe.
  // 본문 내 "3박 5일" false positive 는 별도 layer (consistency-judge, LLM validate)
  // 에서 잡는다. 여기서 강화하면 짧은 카탈로그 fixture 가 깨짐.
  const deduped: number[] = [sorted[0]];
  const MIN_GAP = 8;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - deduped[deduped.length - 1] >= MIN_GAP) deduped.push(sorted[i]);
  }
  return deduped;
}

export function countCatalogItineraryHeaders(raw: string): number {
  return collectItineraryHeaderStarts(raw).length;
}

/**
 * 첫 `[` 위치부터 균형 잡힌 `]` 까지 잘라 JSON 배열 후보 문자열 추출 (앞뒤 노이즈 제거용).
 */
export function extractBalancedJsonArraySubstring(s: string): string | null {
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 첫 `{` 부터 균형 잡힌 `}` 까지 (Phase 2 itinerary JSON 등) */
export function extractBalancedJsonObjectSubstring(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function splitCatalogByItineraryHeaders(raw: string): CatalogSplitResult {
  const text = raw.replace(/\r\n/g, '\n');
  const starts = collectItineraryHeaderStarts(text);

  if (starts.length <= 1) {
    return { sharedPrefix: '', sections: [text] };
  }

  const sharedPrefix = text.slice(0, starts[0]).trimEnd();
  const sections: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    sections.push(text.slice(starts[i], end).trim());
  }
  return { sharedPrefix, sections };
}
