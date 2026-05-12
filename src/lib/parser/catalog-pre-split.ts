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

/** 헤더 줄: 대괄호(반각/전각) + 랜드코드 + 일정표 (앞에 선택적 번호·개행) */
const ITIN_HEADER_LINE_RE =
  /(?:^|\n)((?:\d+[.)]\s*)?[\[【［][A-Z0-9]{2,4}[\]】］][^\n]*일정\s*표)/gi;

/**
 * 글머리(■◆ 등) + 일정표 — 대괄호 없는 랜드 PDF 에서 간헐적.
 * 같은 줄에 "일정"과 "표"가 있어야 함 (과분할 방지).
 */
const ITIN_HEADER_BULLET_RE =
  /(?:^|\n)((?:\d+[.)]\s*)?[■◆▶▪・●○◎◇□]\s*[^\n]{0,120}일정\s*표)/gi;

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

  run(ITIN_HEADER_LINE_RE);
  run(ITIN_HEADER_BULLET_RE);

  const sorted = [...starts].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted;

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
