const VARIANT_LABEL_RE =
  /^(?:\uC138\uC774\uBE0C(?:\s*\uC2E4\uC18D)?|\uC2E4\uC18D|\uC2A4\uD0E0\uB2E4\uB4DC|\uD488\uACA9(?:\s*\uB178\uB178)?|\uD504\uB9AC\uBBF8\uC5C4(?:\s*\uB178\uB178\uB178|\uB178\uB178\uB178)?|\uD06C\uB77C\uC6B4(?:\s*\uB178\uB178\uB178\+?)?)\s*$/;
const VARIANT_COMPACT_LABEL_RE =
  /^(?:\uD504\uB9AC\uBBF8\uC5C4\uB178\uB178\uB178|\uD06C\uB77C\uC6B4\uB178\uB178\uB178\+?|\uC138\uC774\uBE0C\uC2E4\uC18D|\uC2E4\uC18D|\uD488\uACA9\uB178\uB178|\uC2A4\uD0E0\uB2E4\uB4DC)$/;
const VARIANT_TITLE_RE = /\d+\s*\uBC15\s*\d+\s*\uC77C/;
const VARIANT_TITLE_GLOBAL_RE = /\d+\s*\uBC15\s*\d+\s*\uC77C/g;
const KOREAN_DURATION_TITLE_RE = /\d+\s*박\s*\d+\s*일/u;
const VARIANT_ITINERARY_RE = /(?:^|\n)\s*(?:\uC77C\s*\uC790|\uC81C\s*1\s*\uC77C)\s*(?:\n|$)/;
const READABLE_DURATION_RE = /\d+\s*박\s*\d+\s*일/u;
const READABLE_DAY_DURATION_RE = /(?:^|[^\d])\d{1,2}\s*일(?:\s*\/\s*\d{1,2}\s*일)?(?:$|[^\d])/u;
const MONEY_RE = /\d{1,3}(?:,\d{3})+\s*(?:원)?/;

function hasReadableDurationSignal(line: string): boolean {
  return READABLE_DURATION_RE.test(line) || KOREAN_DURATION_TITLE_RE.test(line);
}

function hasReadableTitleText(line: string): boolean {
  const withoutDuration = line
    .replace(READABLE_DURATION_RE, ' ')
    .replace(READABLE_DAY_DURATION_RE, ' ')
    .replace(/\b(?:PKG|PACKAGE)\b/gi, ' ')
    .trim();
  return (withoutDuration.match(/[\p{Script=Hangul}A-Za-z]/gu) ?? []).length >= 2;
}

function hasVariantProductTitleLine(lines: string[]): boolean {
  return lines.some(line => {
    const compact = line.trim().replace(/\s+/g, '');
    if (!VARIANT_TITLE_RE.test(compact)) return false;
    const withoutDuration = compact.replace(VARIANT_TITLE_GLOBAL_RE, '');
    return withoutDuration.length >= 4;
  });
}
export function collectVariantCatalogBlockStarts(raw: string): number[] {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].trim().replace(/\s+/g, ' ');
    if (!label) continue;
    const isVariantLabel = VARIANT_LABEL_RE.test(label) || VARIANT_COMPACT_LABEL_RE.test(label);
    if (!isVariantLabel) continue;

    const titleWindow = lines.slice(i, Math.min(lines.length, i + 7));
    if (!hasVariantProductTitleLine(titleWindow)) continue;

    const itineraryWindow = lines.slice(i, Math.min(lines.length, i + 120)).join('\n');
    if (!VARIANT_ITINERARY_RE.test(itineraryWindow)) continue;

    starts.push(offsets[i]);
  }

  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted;

  const deduped: number[] = [sorted[0]];
  const MIN_VARIANT_GAP = 80;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - deduped[deduped.length - 1] >= MIN_VARIANT_GAP) {
      deduped.push(sorted[i]);
    }
  }
  return deduped;
}

export function collectTransportVariantDetailBlockStarts(raw: string): number[] {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index]?.trim() ?? '';
    const next = lines[index + 1]?.trim() ?? '';
    const label = `${current}${next}`.replace(/\s+/g, '');
    const isTransportBlock =
      label === '\uB9AC\uBB34\uC9C4\uBC84\uC2A4\uC774\uB3D9' ||
      label === '\uACE0\uC18D\uCCA0\uC774\uB3D9' ||
      label === '\uACE0\uC18D\uC5F4\uCC28\uC774\uB3D9';
    if (!isTransportBlock) continue;

    const window = lines.slice(index, Math.min(lines.length, index + 90)).join('\n');
    const hasTitle = /[\p{Script=Hangul}A-Za-z][^\n]{0,80}\d{1,2}\s*\uC77C/u.test(window);
    const hasProductFacts =
      /\uCD5C\uC18C\uCD9C\uBC1C/u.test(window) &&
      /\uD3EC\s*\uD568\s*\uB0B4\s*\uC5ED/u.test(window) &&
      /\uBD88\uD3EC\uD568\s*\uB0B4\uC5ED/u.test(window);
    const hasItineraryTable =
      /\uC77C\s*\uC790/u.test(window) &&
      /\uC81C\s*1\s*\uC77C/u.test(window);

    if (hasTitle && hasProductFacts && hasItineraryTable) {
      starts.push(offsets[index]);
    }
  }

  return [...new Set(starts)].sort((a, b) => a - b);
}

function collectSpecialPriceBlockStarts(raw: string): number[] {
  const text = raw.replace(/\r\n/g, '\n');
  const starts: number[] = [];
  const lines = text.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!/SPECIAL\s+PRICE/i.test(lines[i])) continue;
    const window = lines.slice(i, Math.min(lines.length, i + 40)).join('\n');
    const hasPrice = /(?:\d{1,3}(?:,\d{3})+|\d+\s*만원|\d+\s*만)/.test(window);
    const hasDuration = /\d+\s*박\s*\d+\s*일|여유로운\s*\d+\s*일|완전정복\s*\d+\s*일/.test(window);
    const hasTransport = /\b(?:BX|ZE|7C|LJ|KE|OZ|TW|RS)\s*\d{2,4}\b|항공|출발|도착/.test(window);
    if (hasPrice && hasDuration && hasTransport) starts.push(offsets[i]);
  }

  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted;

  const deduped: number[] = [sorted[0]];
  const MIN_SPECIAL_PRICE_GAP = 200;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - deduped[deduped.length - 1] >= MIN_SPECIAL_PRICE_GAP) {
      deduped.push(sorted[i]);
    }
  }
  return deduped;
}

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
  collectReadableDurationHeaderStarts(text).forEach(start => starts.add(start));

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

function collectReadableDurationHeaderStarts(raw: string): number[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 140) continue;
    if (!hasReadableDurationSignal(line)) continue;
    if (!hasReadableTitleText(line)) continue;
    if (MONEY_RE.test(line)) continue;
    if (/^(?:출발|출발일|출발날짜|상품가|요금|요금표|행사일자|패턴|비고)\b/u.test(line)) continue;

    const context = lines.slice(i + 1, Math.min(lines.length, i + 80)).join('\n');
    const hasItineraryEvidence = /\b[A-Z]{2}\d{2,4}\b/.test(context)
      || /^\s*(?:제\s*)?1\s*(?:일|일차)\b/mu.test(context)
      || /^\s*DAY\s*1\b/im.test(context)
      || /^\s*1\s+\d{1,2}:\d{2}\b/m.test(context);
    if (!hasItineraryEvidence) continue;
    starts.push(offsets[i] + lines[i].indexOf(line));
  }

  return starts;
}

export function countCatalogItineraryHeaders(raw: string): number {
  return Math.max(
    collectItineraryHeaderStarts(raw).length,
    collectVariantCatalogBlockStarts(raw).length,
    collectTransportVariantDetailBlockStarts(raw).length,
    collectSpecialPriceBlockStarts(raw).length,
    collectPkgBlockStarts(raw).length,
  );
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

/** 랜드사 카탈로그 "PKG\\n상품명 N박M일" 블록 시작 위치 (2026-05-22 보홀 슬림팩 사고) */
export function collectPkgBlockStarts(raw: string): number[] {
  const text = raw.replace(/\r\n/g, '\n');
  const starts: number[] = [];
  const lines = text.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const looksLikeDurationTitle = (value: string) =>
    /\d+\s*박\s*\d+\s*일/.test(value) ||
    // OCR/encoding-damaged supplier raws often preserve only the night marker as mojibake.
    /\d+\s*諛/.test(value);

  for (let i = 0; i < lines.length; i++) {
    const pkgMatch = /\bPKG\b/i.exec(lines[i]);
    if (!pkgMatch) continue;
    if (looksLikeDurationTitle(lines[i])) {
      starts.push(offsets[i] + lines[i].search(/\S/));
      continue;
    }
    const nextMeaningfulIndex = lines.findIndex((line, lineIndex) => {
      if (lineIndex <= i || lineIndex >= Math.min(lines.length, i + 5)) return false;
      const trimmed = line.trim();
      return Boolean(trimmed) && !/^---+$/.test(trimmed);
    });
    const nextMeaningful = nextMeaningfulIndex >= 0 ? lines[nextMeaningfulIndex].trim() : '';
    if (!nextMeaningful || !looksLikeDurationTitle(nextMeaningful)) continue;
    starts.push(offsets[nextMeaningfulIndex] + lines[nextMeaningfulIndex].search(/\S/));
  }

  const patterns = [
    /\b(PKG\s*\n[^\n]{4,160}\d+\s*박\s*\d+\s*일[^\n]{0,80})/g,
    /(?:^|\n)([^\n]{2,120}?\d+\s*박\s*\d+\s*일[^\n]{0,80}?\bPKG\b[^\n]{0,60})/g,
    /(?:^|\n)([^\n]{2,120}?\bPKG\b[^\n]{0,80}?\d+\s*박\s*\d+\s*일[^\n]{0,60})/g,
    /(?:^|\n)(PKG\s*\n[^\n]{4,100}\d+박\s*\d+일[^\n]{0,40})/g,
    /(?:^|\n)([^\n]{2,80}出\s*[^\n]{2,80}PKG\s*\d+\s*박\s*\d+\s*일[^\n]{0,60})/g,
    /([가-힣A-Za-z\[][^\n.。]{0,60}?(?:[-/]|出)[^\n.。]{2,80}?\d+\s*박\s*\d+\s*일\s*PKG[^\n]{0,40})/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const g1 = m[1];
      if (!g1) continue;
      const titleOffset = g1.search(/(?:부산|김해|서울|인천|대구|청주|무안|광주)[^\n]{0,120}?\d+\s*박\s*\d+\s*일[^\n]{0,80}?\bPKG\b/);
      const offsetInFull = m[0].indexOf(g1[0]) + Math.max(0, titleOffset);
      starts.push(m.index + offsetInFull);
    }
  }
  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const start of sorted) {
    const last = deduped[deduped.length - 1];
    if (last != null && start - last <= 24) {
      deduped[deduped.length - 1] = Math.min(last, start);
    } else {
      deduped.push(start);
    }
  }
  return deduped;
}

/**
 * 복수 상품 카탈로그에서 한 상품에 해당하는 raw_text 구간만 반환.
 * INSERT·C1 대조·hero backfill 이 전체 원문을 공유하면 2번째 상품 일차가 1번째 감사를 오염시킴.
 */
export function extractProductRawTextSection(
  fullRaw: string,
  productTitle: string | null | undefined,
  productIndex: number,
  totalProducts: number,
): string {
  if (!fullRaw || totalProducts <= 1) return fullRaw;
  const text = fullRaw.replace(/\r\n/g, '\n');
  const idx = Math.max(0, Math.min(productIndex, totalProducts - 1));

  const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(text);
  if (sections.length >= totalProducts && sections.length >= 2) {
    const section = sections[idx] ?? sections[sections.length - 1];
    return ((sharedPrefix ? `${sharedPrefix}\n\n---\n\n` : '') + section).trim();
  }

  const specialPriceStarts = collectSpecialPriceBlockStarts(text);
  if (specialPriceStarts.length >= totalProducts && specialPriceStarts.length >= 2) {
    const start = specialPriceStarts[idx] ?? specialPriceStarts[specialPriceStarts.length - 1];
    const end = idx + 1 < specialPriceStarts.length ? specialPriceStarts[idx + 1] : text.length;
    return text.slice(start, end).trim();
  }

  const transportStarts = collectTransportVariantDetailBlockStarts(text);
  if (transportStarts.length >= totalProducts && transportStarts.length >= 2) {
    const start = transportStarts[idx] ?? transportStarts[transportStarts.length - 1];
    const end = idx + 1 < transportStarts.length ? transportStarts[idx + 1] : text.length;
    return text.slice(start, end).trim();
  }

  const pkgStarts = collectPkgBlockStarts(text);
  if (pkgStarts.length >= totalProducts && pkgStarts.length >= 2) {
    const start = pkgStarts[idx] ?? pkgStarts[pkgStarts.length - 1];
    const end = idx + 1 < pkgStarts.length ? pkgStarts[idx + 1] : text.length;
    return text.slice(start, end).trim();
  }

  const title = (productTitle ?? '').trim();
  if (title.length >= 4) {
    const positions: number[] = [];
    let from = 0;
    while (from < text.length) {
      const pos = text.indexOf(title, from);
      if (pos < 0) break;
      positions.push(pos);
      from = pos + title.length;
    }
    if (positions.length >= totalProducts) {
      const start = positions[idx] ?? positions[positions.length - 1];
      const nextStart = idx + 1 < positions.length ? positions[idx + 1] : text.length;
      return text.slice(start, nextStart).trim();
    }
    if (positions.length === 1) {
      const start = positions[0];
      const tail = text.slice(start);
      const nextTitle = tail.slice(title.length).search(/\n(?:PKG\s*\n|[^\n]{4,80}\d+박\s*\d+일)/);
      const end = nextTitle >= 0 ? start + title.length + nextTitle : text.length;
      return text.slice(start, end).trim();
    }
  }

  return fullRaw;
}

export function stripSharedCatalogPrefixForProductDetail(rawText: string | null | undefined): string {
  const text = rawText?.replace(/\r\n/g, '\n').trim() ?? '';
  if (!text.includes('---')) return text;

  const parts = text.split(/\n\s*---\s*\n/);
  if (parts.length < 2) return text;

  const detail = parts.at(-1)?.trim() ?? '';
  if (detail.length < 100) return text;

  const hasItineraryEvidence =
    /\uC77C\s*\uC790/u.test(detail) ||
    /\uC81C\s*1\s*\uC77C/u.test(detail) ||
    /\bDAY\s*1\b/i.test(detail);
  const hasProductFacts =
    /\uCD5C\uC18C\uCD9C\uBC1C/u.test(detail) ||
    /\uD3EC\s*\uD568\s*\uB0B4\s*\uC5ED/u.test(detail) ||
    /\uBD88\uD3EC\uD568\s*\uB0B4\uC5ED/u.test(detail);

  return hasItineraryEvidence || hasProductFacts ? detail : text;
}

export function splitCatalogByItineraryHeaders(raw: string): CatalogSplitResult {
  const text = raw.replace(/\r\n/g, '\n');
  const variantStarts = collectVariantCatalogBlockStarts(text);
  const specialPriceStarts = collectSpecialPriceBlockStarts(text);
  const transportStarts = collectTransportVariantDetailBlockStarts(text);
  const itineraryStarts = collectItineraryHeaderStarts(text);
  const pkgStarts = collectPkgBlockStarts(text);
  const starts = pkgStarts.length >= 2
    ? pkgStarts
    : specialPriceStarts.length >= 2
      ? specialPriceStarts
      : transportStarts.length >= 2 && transportStarts.length > Math.max(variantStarts.length, itineraryStarts.length)
        ? transportStarts
        : variantStarts.length >= 2
          ? variantStarts
          : itineraryStarts;

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

// ═══════════════════════════════════════════════════════════════════════════
//  2026-05-19 박제 (P1-B): LLM split fallback
//
//  regex 가 새로운 헤더 포맷을 못 잡을 때 LLM 이 character offset 으로 boundary 결정.
//  비용 ~$0.0001/카탈로그 (Gemini Flash). 신규 랜드사 포맷에 자동 적응.
//
//  사용 패턴 (parser.ts 또는 upload/route.ts):
//    const regexSplit = splitCatalogByItineraryHeaders(raw);
//    if (regexSplit.sections.length <= 1 && raw.length > 2000) {
//      const llmSplit = await detectCatalogBoundariesWithLLM(raw);
//      if (llmSplit && llmSplit.products.length >= 2) {
//        return applyLLMSplit(raw, llmSplit);
//      }
//    }
//    return regexSplit;
// ═══════════════════════════════════════════════════════════════════════════

export interface LLMSplitProduct {
  start_char: number;
  name_hint: string;
}

export interface LLMSplitResult {
  products: LLMSplitProduct[];
  reason?: string;
  skipped?: boolean;
}

/**
 * regex 가 0/1개만 잡으면 LLM 이 진짜 별개 상품 개수 + 시작 char offset 결정.
 *
 * 학습 SSOT (사장님 5 실제 카탈로그 기준):
 * - [BX] 대만 / 단수이/베이토우/우라이 3 상품 → 같은 카탈로그 N 상품
 * - [LJ] 몽골 3박5일【금】 + 4박6일【월】 → 같은 카탈로그 2 상품 (출발 요일 다름)
 * - [VJ]/[VN] 베트남 같은 일정 다른 항공사 → 2 상품
 * - [부관훼리] 요금표 카드 + 일정 카드 → 1 상품 (카드 분산)
 */
export async function detectCatalogBoundariesWithLLM(
  rawText: string,
  options: { maxChars?: number; minLengthForLLM?: number } = {},
): Promise<LLMSplitResult> {
  const { maxChars = 8000, minLengthForLLM = 2000 } = options;
  if (!rawText || rawText.length < minLengthForLLM) {
    return { products: [], skipped: true, reason: 'too-short' };
  }
  if (process.env.UPLOAD_CATALOG_LLM_SPLIT === '0') {
    return { products: [], skipped: true, reason: 'env-disabled' };
  }

  // 동적 import — 직렬 dependency 안 만듦. Vercel cold start 0 영향.
  type SecretMod = typeof import('@/lib/secret-registry');
  type GenAIMod = typeof import('@google/generative-ai');
  type TracerMod = typeof import('@/lib/telemetry/llm-tracer');
  let secretMod: SecretMod;
  let genAIMod: GenAIMod;
  let tracerMod: TracerMod;
  try {
    secretMod = await import('@/lib/secret-registry');
    genAIMod = await import('@google/generative-ai');
    tracerMod = await import('@/lib/telemetry/llm-tracer');
  } catch {
    return { products: [], skipped: true, reason: 'import-failed' };
  }

  const apiKey = secretMod.getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey) return { products: [], skipped: true, reason: 'no-api-key' };
  const { GoogleGenerativeAI, SchemaType } = genAIMod;
  const { traceLlmCall, recordLlmUsage } = tracerMod;

  // 토큰 절약: 첫 8000자만 (대부분 카탈로그는 헤더+요금표가 앞에 옴)
  const snippet = rawText.slice(0, maxChars);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          products: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                start_char: { type: SchemaType.INTEGER, description: '상품 시작 character offset (0-based)' },
                name_hint: { type: SchemaType.STRING, description: '상품명 힌트 (헤더 첫 줄)' },
              },
              required: ['start_char', 'name_hint'],
            },
          },
        },
        required: ['products'],
      },
    },
  });

  const prompt = `한국 여행상품 카탈로그 원문에서 별개 상품의 시작 위치를 char offset 으로 알려줘.

판단 기준 (랜드사마다 헤더 포맷 다름):
- "[XX] 도시명 N박 M일" — 대괄호 + 코드(영숫자/한글) + 박일
- "도시명 N박 M일【요일】" — 대괄호 없고 전각 요일
- "[XX] ... 무박N일" — 페리 패키지
- "일정표" 키워드가 있는 줄

같은 상품을 여러 카드로 나눠 적은 경우(요금표 카드 + 일정 카드)는 1개로 묶어:
- 항공편이 다르면 별도 상품 (BX vs LJ vs VJ vs VN)
- 일정 차이가 Day 1개 이상이면 별도 상품
- 같은 일정인데 요금표만 따로면 같은 상품

각 product 의 start_char 는 원문에서 그 상품 헤더 줄이 시작하는 정확한 byte/char offset.
1개 상품만 있으면 products: [{start_char: 0, name_hint: "..."}].

원문 (${snippet.length} chars):
---
${snippet}
---

JSON: {"products": [{"start_char": 0, "name_hint": "[BX] 대만 단수이 3박 4일"}, ...]}`;

  const start = Date.now();
  try {
    const result = await traceLlmCall(
      { task: 'judge', provider: 'gemini', model: 'gemini-2.5-flash', phase: 'executor' },
      async (span) => {
        const res = await model.generateContent(prompt);
        const usage = res.response.usageMetadata;
        recordLlmUsage(span, {
          input: usage?.promptTokenCount,
          output: usage?.candidatesTokenCount,
          latency_ms: Date.now() - start,
        });
        const txt = res.response.text();
        const parsed = JSON.parse(txt) as { products?: LLMSplitProduct[] };
        const products = Array.isArray(parsed.products) ? parsed.products : [];
        // start_char 범위 검증 (0 ~ rawText.length)
        const valid = products.filter(p =>
          typeof p.start_char === 'number' &&
          p.start_char >= 0 &&
          p.start_char < rawText.length &&
          typeof p.name_hint === 'string' &&
          p.name_hint.length > 0
        );
        // start_char 오름차순 정렬
        valid.sort((a, b) => a.start_char - b.start_char);
        return { products: valid };
      },
    );
    return result;
  } catch (e) {
    return {
      products: [],
      skipped: true,
      reason: `LLM split 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * LLM split 결과를 CatalogSplitResult 로 변환.
 */
export function applyLLMSplit(rawText: string, llm: LLMSplitResult): CatalogSplitResult {
  if (llm.products.length === 0) {
    return { sharedPrefix: '', sections: [rawText] };
  }
  const sortedStarts = [...llm.products].sort((a, b) => a.start_char - b.start_char);
  const firstStart = sortedStarts[0].start_char;
  const sharedPrefix = rawText.slice(0, firstStart).trimEnd();
  const sections: string[] = [];
  for (let i = 0; i < sortedStarts.length; i++) {
    const end = i + 1 < sortedStarts.length ? sortedStarts[i + 1].start_char : rawText.length;
    sections.push(rawText.slice(sortedStarts[i].start_char, end).trim());
  }
  return { sharedPrefix, sections };
}

/**
 * Smart split: regex 우선, miss 시 LLM fallback.
 */
export async function splitCatalogSmart(rawText: string): Promise<CatalogSplitResult & {
  source: 'regex' | 'llm-fallback' | 'single';
}> {
  const regexResult = splitCatalogByItineraryHeaders(rawText);
  if (regexResult.sections.length >= 2) {
    return { ...regexResult, source: 'regex' };
  }
  // regex miss → LLM fallback (rawText 충분히 길고 env 활성 시)
  if (rawText.length >= 2000) {
    const llm = await detectCatalogBoundariesWithLLM(rawText);
    if (!llm.skipped && llm.products.length >= 2) {
      const llmSplit = applyLLMSplit(rawText, llm);
      return { ...llmSplit, source: 'llm-fallback' };
    }
  }
  return { ...regexResult, source: 'single' };
}
