/**
 * @file terms-catalog.ts — 포함/불포함/추가요금/쇼핑 표준 카탈로그 (렌더 SSOT)
 *
 * 원칙:
 *   - DB/파서: 랜드사 원문 verbatim (Zero-Hallucination)
 *   - 렌더: 카탈로그 매칭분만 표준 라벨로, 나머지는 remainder로 옆에 표시
 *   - 쇼핑 환불 등 부정적/법적 안내 → shopping 섹션 X, termsMisc(기타 안내)로 분리
 */

import {
  formatExcludeDisplayLabel,
  isMealDayExcludeLine,
} from '@/lib/parser/deterministic/comma-split-safe';

// ─── 공통 타입 ─────────────────────────────────────────────────────────────

export interface CatalogEntryBase {
  slug: string;
  label: string;
  patterns: RegExp[];
  order: number;
}

export interface NormalizedTermLine {
  /** 카탈로그 표준 라벨 (또는 미매칭 시 원문) */
  text: string;
  slug: string | null;
  /** 카탈로그에 없는 나머지 원문 조각 */
  remainder: string | null;
  icon?: string;
}

export function formatTermLine(line: NormalizedTermLine): string {
  if (line.remainder?.trim()) {
    return `${line.text} · ${line.remainder.trim()}`;
  }
  return line.text;
}

/** 괄호 각주 추출 — "유류할증료(5월기준)" → { core, footnote } */
export function extractParentheticalFootnote(raw: string): { core: string; footnote: string | null } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.+?)\(([^)]+)\)\s*$/);
  if (!m) return { core: trimmed, footnote: null };
  return { core: m[1].trim(), footnote: m[2].trim() || null };
}

function extractRemainderAfterPattern(raw: string, pattern: RegExp): string | null {
  const { core } = extractParentheticalFootnote(raw);
  const m = core.match(pattern);
  if (!m || m.index == null) return null;
  const before = core.slice(0, m.index).trim();
  const after = core.slice(m.index + m[0].length).trim();
  const joined = [before, after].filter(Boolean).join(' ').replace(/^[,·/|\s]+|[,·/|\s]+$/g, '');
  return sanitizeCatalogRemainder(joined);
}

/** "숙박료"→"료" 같은 접두 패턴 매칭 찌꺼기 제거 */
export function sanitizeCatalogRemainder(remainder: string | null | undefined): string | null {
  if (!remainder?.trim()) return null;
  const r = remainder.trim();
  if (/^(료|비|요금?)$/.test(r)) return null;
  if (/^[-–—:,·\s]+$/.test(r)) return null;
  return r;
}

/** 표준 라벨 밖에 실질적으로 더 있는 원문만 remainder */
export function extractExtraRemainder(raw: string, standardText: string): string | null {
  const rawTrim = raw.trim();
  const stdTrim = standardText.trim();
  if (!rawTrim || rawTrim === stdTrim) return null;

  let extra = rawTrim;
  if (extra.includes(stdTrim)) {
    extra = extra.replace(stdTrim, '').trim();
  } else {
    const { core: rawCore } = extractParentheticalFootnote(rawTrim);
    const { core: stdCore } = extractParentheticalFootnote(stdTrim);
    if (rawCore.includes(stdCore)) {
      extra = rawCore.replace(stdCore, '').trim();
    } else {
      return null;
    }
  }

  extra = extra.replace(/^\([^)]*\)\s*/, '').replace(/^[,·\-–—:\s]+/, '').trim();
  return sanitizeCatalogRemainder(extra);
}

// ─── 포함 ─────────────────────────────────────────────────────────────────

export type InclusionSlug =
  | 'round_trip_airfare'
  | 'fuel_surcharge'
  | 'accommodation'
  | 'meals'
  | 'attraction_fees'
  | 'local_transport'
  | 'travel_insurance'
  | 'guide';

export interface InclusionCatalogEntry extends CatalogEntryBase {
  slug: InclusionSlug;
  icon: string;
  defaultFootnote?: string;
}

export const INCLUSION_CATALOG: InclusionCatalogEntry[] = [
  {
    slug: 'round_trip_airfare',
    label: '왕복항공료',
    icon: '✈️',
    defaultFootnote: '현지공항세포함',
    patterns: [/왕복\s*항공|항공료|항공권|국제선\s*항공|왕복\s*비행/i],
    order: 10,
  },
  {
    slug: 'fuel_surcharge',
    label: '유류할증료',
    icon: '✈️',
    patterns: [/유류\s*할증|유류세|유류\s*추가/i],
    order: 20,
  },
  {
    slug: 'accommodation',
    label: '숙박료',
    icon: '🏨',
    patterns: [/숙박|호텔\s*비?|리조트\s*비?|숙소/i],
    order: 30,
  },
  {
    slug: 'meals',
    label: '식사',
    icon: '🍽️',
    defaultFootnote: '일정표',
    patterns: [/식사|전\s*일정\s*식/i],
    order: 40,
  },
  {
    slug: 'attraction_fees',
    label: '관광지입장료',
    icon: '🎫',
    patterns: [/관광지\s*입장|입장료|입장권|티켓\s*포함/i],
    order: 50,
  },
  {
    slug: 'local_transport',
    label: '현지차량',
    icon: '🚌',
    patterns: [/현지\s*차량|전용\s*차량|관광\s*버스|현지\s*버스|차량\s*비?|리무진/i],
    order: 60,
  },
  {
    slug: 'travel_insurance',
    label: '여행자보험',
    icon: '🛡️',
    patterns: [/여행자\s*보험|여행\s*보험|travel\s*insurance/i],
    order: 70,
  },
  {
    slug: 'guide',
    label: '현지가이드',
    icon: '👤',
    patterns: [/현지\s*가이드|한국어\s*가이드|인솔자/i],
    order: 80,
  },
];

const INCLUSION_BY_ORDER = [...INCLUSION_CATALOG].sort((a, b) => a.order - b.order);

export interface CatalogMatch {
  slug: InclusionSlug;
  entry: InclusionCatalogEntry;
  footnote: string | null;
}

export function matchInclusionCatalog(raw: string): CatalogMatch | null {
  const { core, footnote } = extractParentheticalFootnote(raw);
  const probe = core.replace(/\s+/g, '');
  for (const entry of INCLUSION_CATALOG) {
    if (entry.patterns.some(re => re.test(core) || re.test(probe))) {
      return { slug: entry.slug, entry, footnote };
    }
  }
  return null;
}

export function formatInclusionDisplay(entry: InclusionCatalogEntry, footnote: string | null): string {
  const note = footnote?.trim() || entry.defaultFootnote;
  return note ? `${entry.label}(${note})` : entry.label;
}

export function normalizeCatalogInclusions(rawItems: string[]): NormalizedTermLine[] {
  const bySlug = new Map<InclusionSlug, { footnote: string | null; remainder: string | null }>();

  for (const raw of rawItems) {
    const hit = matchInclusionCatalog(raw);
    if (!hit) continue;
    const prev = bySlug.get(hit.slug);
    const footnote = hit.footnote ?? prev?.footnote ?? null;
    const standard = formatInclusionDisplay(hit.entry, footnote);
    const extra = extractExtraRemainder(raw, standard);
    bySlug.set(hit.slug, {
      footnote,
      remainder: extra ?? prev?.remainder ?? null,
    });
  }

  const result: NormalizedTermLine[] = [];
  for (const entry of INCLUSION_BY_ORDER) {
    const slot = bySlug.get(entry.slug);
    if (!slot) continue;
    result.push({
      text: formatInclusionDisplay(entry, slot.footnote),
      slug: entry.slug,
      remainder: slot.remainder,
      icon: entry.icon,
    });
  }

  for (const raw of rawItems) {
    if (matchInclusionCatalog(raw)) continue;
    result.push({ text: raw.trim(), slug: null, remainder: null, icon: '✅' });
  }

  return result;
}

// ─── 불포함 ─────────────────────────────────────────────────────────────────

export type ExclusionSlug =
  | 'personal_expense'
  | 'manner_tip'
  | 'visa_fee'
  | 'airport_tax'
  | 'travel_insurance_upgrade'
  | 'optional_tour_fee';

export interface ExclusionCatalogEntry extends CatalogEntryBase {
  slug: ExclusionSlug;
}

export const EXCLUSION_CATALOG: ExclusionCatalogEntry[] = [
  {
    slug: 'personal_expense',
    label: '개인경비',
    patterns: [/개인\s*경비|자유\s*경비|개인\s*비용/i],
    order: 10,
  },
  {
    slug: 'manner_tip',
    label: '매너팁',
    patterns: [/매너\s*팁|매너팁/i],
    order: 20,
  },
  {
    slug: 'visa_fee',
    label: '비자발급비',
    patterns: [/비자\s*(?:발급)?\s*비|VISA\s*FEE/i],
    order: 30,
  },
  {
    slug: 'airport_tax',
    label: '공항세',
    patterns: [/공항\s*세|공항이용료/i],
    order: 40,
  },
  {
    slug: 'travel_insurance_upgrade',
    label: '여행자보험(선택)',
    patterns: [/여행\s*보험\s*(?:미포함|별도|선택)|보험\s*가입\s*비/i],
    order: 50,
  },
  {
    slug: 'optional_tour_fee',
    label: '선택관광',
    patterns: [/선택\s*관광\s*(?:비|요금)?/i],
    order: 60,
  },
];

const EXCLUSION_BY_ORDER = [...EXCLUSION_CATALOG].sort((a, b) => a.order - b.order);

export function matchExclusionCatalog(raw: string): { slug: ExclusionSlug; entry: ExclusionCatalogEntry } | null {
  const { core } = extractParentheticalFootnote(raw);
  for (const entry of EXCLUSION_CATALOG) {
    if (entry.patterns.some(re => re.test(core))) {
      return { slug: entry.slug, entry };
    }
  }
  return null;
}

/** 일차별 식사 불포함 등 — 카탈로그 강제 X, 원문 포맷만 */
export function normalizeCatalogExcludes(rawItems: string[]): NormalizedTermLine[] {
  const bySlug = new Map<ExclusionSlug, string | null>();
  const custom: NormalizedTermLine[] = [];

  for (const raw of rawItems) {
    if (isMealDayExcludeLine(raw)) {
      custom.push({
        text: formatExcludeDisplayLabel(raw),
        slug: null,
        remainder: null,
      });
      continue;
    }

    const hit = matchExclusionCatalog(raw);
    if (hit) {
      const extra = extractExtraRemainder(raw, hit.entry.label);
      if (!bySlug.has(hit.slug)) {
        bySlug.set(hit.slug, extra);
      } else if (extra) {
        bySlug.set(hit.slug, extra);
      }
      continue;
    }

    custom.push({ text: raw.trim(), slug: null, remainder: null });
  }

  const result: NormalizedTermLine[] = [];
  for (const entry of EXCLUSION_BY_ORDER) {
    if (!bySlug.has(entry.slug)) continue;
    result.push({
      text: entry.label,
      slug: entry.slug,
      remainder: bySlug.get(entry.slug) ?? null,
    });
  }

  return [...result, ...custom];
}

// ─── 추가 요금 ─────────────────────────────────────────────────────────────

export type SurchargeSlug =
  | 'guide_driver_tip'
  | 'single_charge'
  | 'holiday_surcharge'
  | 'peak_season';

export interface SurchargeCatalogEntry extends CatalogEntryBase {
  slug: SurchargeSlug;
}

export const SURCHARGE_CATALOG: SurchargeCatalogEntry[] = [
  {
    slug: 'guide_driver_tip',
    label: '기사/가이드팁',
    patterns: [/기사\s*[/·]\s*가이드\s*팁|가이드\s*[/·]?\s*팁|기사\s*팁|드라이버\s*팁|기사\s*및\s*가이드/i],
    order: 10,
  },
  {
    slug: 'single_charge',
    label: '싱글차지',
    patterns: [/싱글\s*차지|1인\s*1실|싱글\s*룸/i],
    order: 20,
  },
  {
    slug: 'holiday_surcharge',
    label: '연휴 추가요금',
    patterns: [/연휴\s*(?:써?차지|추가)|공휴일\s*(?:써?차지|추가)/i],
    order: 30,
  },
  {
    slug: 'peak_season',
    label: '성수기 추가요금',
    patterns: [/성수기\s*(?:써?차지|추가)|피크\s*시즌/i],
    order: 40,
  },
];

export function matchSurchargeCatalog(raw: string): { slug: SurchargeSlug; entry: SurchargeCatalogEntry } | null {
  for (const entry of SURCHARGE_CATALOG) {
    if (entry.patterns.some(re => re.test(raw))) {
      return { slug: entry.slug, entry };
    }
  }
  return null;
}

/** "$60", "60불", "60달러" 등 */
export function parseSurchargeAmount(raw: string): string | null {
  const m = raw.match(/(\$[\d,]+(?:\.\d+)?|\d[\d,]*\s*(?:불|달러|USD|usd|원))/i);
  if (!m) return null;
  const v = m[1].trim();
  if (/^\d/.test(v) && !/원|불|달러|USD/i.test(v)) return `$${v.replace(/,/g, '')}`;
  return v.replace(/\s+/g, '');
}

/** "아동,성인동일", "성인/아동" 등 */
export function parseSurchargeTarget(raw: string): string | null {
  const dash = raw.match(
    /(?:기사\s*[/·]\s*가이드\s*팁|가이드\s*팁|기사\s*팁)\s*[-–—:：]?\s*([^($]+?)(?:\(|$)/i,
  );
  if (dash?.[1]) {
    const t = dash[1].trim().replace(/,/g, '·');
    if (t.length > 0) return t;
  }
  const paren = raw.match(/\(([^)$]+(?:동일|성인|아동)[^)$]*)\)/i);
  if (paren?.[1] && !/^\$|\d+불/i.test(paren[1])) {
    return paren[1].trim().replace(/,/g, '·');
  }
  return null;
}

export function formatSurchargeCatalogLine(
  entry: SurchargeCatalogEntry,
  raw: string,
): NormalizedTermLine {
  const target = parseSurchargeTarget(raw);
  const amount = parseSurchargeAmount(raw);
  let text = entry.label;
  if (target) text += ` — ${target}`;
  if (amount) text += ` (${amount})`;

  // target/amount를 이미 본문에 녹였으면 패턴 remainder(예: "-아동,성인동일") 중복 금지
  if (target || amount) {
    return { text, slug: entry.slug, remainder: extractExtraRemainder(raw, text) };
  }

  const remainder = entry.patterns
    .map(re => extractRemainderAfterPattern(raw, re))
    .find(r => r) ?? null;

  return { text, slug: entry.slug, remainder };
}

export function normalizeCatalogSurchargeLine(raw: string): NormalizedTermLine {
  const hit = matchSurchargeCatalog(raw);
  if (hit) return formatSurchargeCatalogLine(hit.entry, raw);
  return { text: raw.trim(), slug: null, remainder: null };
}

// ─── 쇼핑 ─────────────────────────────────────────────────────────────────

/** 쇼핑 환불 정책 — 쇼핑 섹션이 아닌 기타 안내에만 노출 */
export const SHOPPING_POLICY_NOTE =
  '교환이나 환불은 구매 후 한 달 이내에만 가능합니다. (수수료 발생)';

const SHOPPING_DISCLAIMER_RE =
  /\*?\s*교환(?:이)?(?:나| 또는)\s*환불(?:은)?[\s\S]*?\(\s*수수료\s*발생\s*\)\s*/gi;

export interface ParsedShopping {
  count: number | null;
  items: string[];
  /** 쇼핑 섹션 본문 — "2회 — 잡화, 토속품 등" */
  displayLine: string;
  /** 원문에서 분리된 정책 문구 → termsMisc */
  policyNote: string | null;
  /** 카탈로그 형식에 안 맞는 나머지 */
  remainder: string | null;
}

export function stripShoppingPolicy(text: string): { body: string; policyNote: string | null } {
  let body = text.trim();
  let policyNote: string | null = null;
  const m = body.match(SHOPPING_DISCLAIMER_RE);
  if (m?.[0]) {
    policyNote = m[0].replace(/^\*\s*/, '').replace(/\s+/g, ' ').trim();
    body = body.replace(SHOPPING_DISCLAIMER_RE, '').trim();
  }
  if (/교환.*환불.*한\s*달/i.test(text) && !policyNote) {
    policyNote = SHOPPING_POLICY_NOTE;
  }
  return { body, policyNote };
}

export function formatShoppingDisplay(count: number | null, items: string[]): string {
  if (count == null) return '';
  if (items.length === 0) return `${count}회`;
  return `${count}회 — ${items.join(', ')} 등`;
}

export function parseShoppingText(text: string): ParsedShopping {
  const { body, policyNote } = stripShoppingPolicy(text);
  const trimmed = body.trim();

  const countMatch = trimmed.match(/(\d+)\s*회/);
  const count = countMatch ? parseInt(countMatch[1], 10) : null;

  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  let items: string[] = [];
  if (parenMatch) {
    const inner = parenMatch[1].replace(/\s*중\s*$/, '').trim();
    items = inner.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  }

  if (count != null) {
    const displayLine = formatShoppingDisplay(count, items);
    const remainder = trimmed
      .replace(/\d+\s*회/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[,，、\s]+/g, ' ')
      .trim();
    return {
      count,
      items,
      displayLine,
      policyNote,
      remainder: remainder.length >= 2 ? remainder : null,
    };
  }

  return {
    count,
    items,
    displayLine: trimmed,
    policyNote,
    remainder: null,
  };
}
