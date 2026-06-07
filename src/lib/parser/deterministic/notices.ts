/**
 * @file deterministic/notices.ts — notices_parsed 4-type 결정적 분류 (2026-05-14 박제)
 *
 * 박제 사유:
 *   Cross-validation 룰 C3 (CRITICAL/PAYMENT/POLICY/INFO 4-type 모두 필요) 가 매번 실패하던 사고.
 *   LLM 이 4 타입 분류를 자주 빼먹는데, 카탈로그 REMARK/비고/특이사항/주의사항 영역의 키워드만
 *   봐도 결정적으로 분류 가능. 한국 여행사 카탈로그 표준 어휘.
 *
 * 분류:
 *   - CRITICAL: 취소/환불/여권/쇼핑/연령제한 — 고객에게 가장 중요한 제약
 *   - PAYMENT: 추가요금/할증/싱글차지/유류세/공항이용료 — 돈
 *   - POLICY:  현장규정/팁/매너/지각/단독행동/주류반입 — 현지 규칙
 *   - INFO:    출입국/이동시간/시차/통화/날씨/유심 — 안내 정보
 *
 * 빈 카테고리는 standard-terms fallback 으로 자동 채워짐 (C39).
 */

export interface NoticeItem {
  type: 'CRITICAL' | 'PAYMENT' | 'POLICY' | 'INFO';
  title: string;
  text: string;
}

const KEYWORD_TO_TYPE: Array<{ kw: RegExp; type: NoticeItem['type'] }> = [
  // CRITICAL — 고객 의무·계약 핵심
  { kw: /취소|환불|위약|벌금|패널티|탑승\s*거부/, type: 'CRITICAL' },
  { kw: /여권|비자|만료|6개월|입국\s*불가|반입\s*금지/, type: 'CRITICAL' },
  { kw: /쇼핑(센터)?(\s*\d+회)?|쇼핑\s*없음|면세점/, type: 'CRITICAL' },
  { kw: /연령\s*제한|미성년|만\s*\d+세\s*이상|가족관계증명/, type: 'CRITICAL' },
  { kw: /GV2|GV\s*깨|전자담배|아이코스|히츠/, type: 'CRITICAL' },
  { kw: /패키지\s*행사.*환불/, type: 'CRITICAL' },
  // PAYMENT — 돈
  { kw: /추가\s*요금|할증|써차지|surcharge|싱글\s*차지|발권/, type: 'PAYMENT' },
  { kw: /유류세|공항\s*이용료|관광세|시(\s)?티택스|호텔세/, type: 'PAYMENT' },
  { kw: /기사\s*팁|가이드\s*팁|매너\s*팁|선장\s*팁|기내식\s*비용/, type: 'PAYMENT' },
  // POLICY — 현지 규정·매너
  { kw: /지각|단독\s*행동|개별\s*행동|이탈|불참|미참여/, type: 'POLICY' },
  { kw: /흡연|음주|주류|반입|복장|드레스\s*코드/, type: 'POLICY' },
  { kw: /가이드\s*지시|일정\s*변경|차량\s*통제/, type: 'POLICY' },
  { kw: /한국인\s*가이드|현지인\s*가이드|현지\s*가이드/, type: 'POLICY' },
  // INFO — 일반 안내
  { kw: /출입국|입국\s*수속|세관|면세\s*한도/, type: 'INFO' },
  { kw: /\d+\s*명\s*이하|\d+명이하/, type: 'INFO' },
  { kw: /시차|통화|환전|날씨|기후|기온/, type: 'INFO' },
  { kw: /유심|와이파이|로밍|콘센트|전압/, type: 'INFO' },
  { kw: /이동\s*시간|소요\s*시간|차량|버스/, type: 'INFO' },
];

export const TITLE_BY_TYPE: Record<NoticeItem['type'], string> = {
  CRITICAL: '필수 확인 사항',
  PAYMENT: '추가 비용 안내',
  POLICY: '현지 규정 및 매너',
  INFO: '여행 준비 안내',
};

const SECTION_START_RE = /^[\s*]*(?:주\s*의\s*사\s*항|주의사항|비\s*고|비고|특\s*이\s*사\s*항|특이사항)\s*$/i;
const SECTION_STOP_RE = /^(?:일\s*자|지\s*역|교통편|제\s*\d+\s*일|DAY\s*\d+|일정표|PKG|포\s*함|불포함)/i;

/** 주의사항·비고 섹션 본문 라인만 추출 (일정표 직전까지) */
function extractRemarkSectionLines(rawText: string): string[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_START_RE.test(line.replace(/\s+/g, ' ')) || SECTION_START_RE.test(line.replace(/\s+/g, ''))) {
      inSection = true;
      continue;
    }
    if (inSection && (
      SECTION_STOP_RE.test(line.replace(/\s+/g, ' '))
      || SECTION_STOP_RE.test(line.replace(/\s+/g, ''))
    )) break;
    if (!inSection) continue;
    const cleaned = line.replace(/^[\s*•·\-]+/, '').trim();
    if (/마지막페이지|잔금\s*입금|완납\s*기준|꼭\s*안내\s*부탁/.test(cleaned)) continue;
    if (cleaned.length >= 8 && cleaned.length <= 400) out.push(cleaned);
  }
  return out;
}

function classifyLine(cleaned: string, buckets: Record<NoticeItem['type'], string[]>): void {
  for (const { kw, type } of KEYWORD_TO_TYPE) {
    if (kw.test(cleaned)) {
      if (!buckets[type].some(x => x.includes(cleaned.slice(0, 30)))) {
        buckets[type].push(cleaned);
      }
      break;
    }
  }
}

function bucketsToNotices(buckets: Record<NoticeItem['type'], string[]>): NoticeItem[] {
  const out: NoticeItem[] = [];
  (['CRITICAL', 'PAYMENT', 'POLICY', 'INFO'] as const).forEach(type => {
    const items = buckets[type];
    if (items.length > 0) {
      out.push({
        type,
        title: TITLE_BY_TYPE[type],
        text: items.map(x => `• ${x}`).join('\n'),
      });
    }
  });
  return out;
}

function parseBulletLines(text: string): string[] {
  return text
    .split(/\n/)
    .map(l => l.replace(/^[\s*•·\-]+/, '').trim())
    .filter(l => l.length >= 8);
}

/** LLM notices + 결정적 notices type별 bullet 병합 (동일 type skip 금지) */
export function mergeNoticesParsed(
  llmNotices: unknown[],
  detNotices: NoticeItem[],
): NoticeItem[] {
  const byType = new Map<NoticeItem['type'], { title: string; lines: string[] }>();

  for (const raw of llmNotices) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) continue;
    const n = raw as { type?: string; title?: string; text?: string };
    const type = n.type as NoticeItem['type'];
    if (!['CRITICAL', 'PAYMENT', 'POLICY', 'INFO'].includes(type)) continue;
    const entry = byType.get(type) ?? { title: n.title ?? TITLE_BY_TYPE[type], lines: [] };
    for (const line of parseBulletLines(String(n.text ?? ''))) {
      if (!entry.lines.some(x => x.includes(line.slice(0, 30)))) entry.lines.push(line);
    }
    byType.set(type, entry);
  }

  for (const dn of detNotices) {
    const entry = byType.get(dn.type) ?? { title: dn.title, lines: [] };
    for (const line of parseBulletLines(dn.text)) {
      if (!entry.lines.some(x => x.includes(line.slice(0, 30)))) entry.lines.push(line);
    }
    byType.set(dn.type, entry);
  }

  return (['CRITICAL', 'PAYMENT', 'POLICY', 'INFO'] as const)
    .map(type => {
      const entry = byType.get(type);
      if (!entry || entry.lines.length === 0) return null;
      return {
        type,
        title: entry.title,
        text: entry.lines.map(x => `• ${x}`).join('\n'),
      } satisfies NoticeItem;
    })
    .filter((x): x is NoticeItem => x != null);
}

/** 비고·주의사항에서 $ 금액이 있는 추가요금 라인 → excludes 보완 */
export function enrichExcludesFromRemarks(
  excludes: string[] | null | undefined,
  ...textSources: (string | null | undefined)[]
): string[] {
  const base = Array.isArray(excludes) ? [...excludes] : [];
  const combined = textSources.filter(Boolean).join('\n');
  if (!combined) return base;

  for (const line of extractRemarkSectionLines(combined)) {
    // 쇼핑 불참 패널티 등 — CRITICAL(주의사항) 전용, 추가요금·불포함 아님
    if (/패널티|쇼핑\s*샵|쇼핑샵|쇼핑.*불참|참여\s*하지\s*않/.test(line)) continue;
    if (!/\$\d+|싱글\s*차지|써차지|할증|추가\s*요금/i.test(line)) continue;
    if (base.some(x => x.includes(line.slice(0, 25)))) continue;
    base.push(line);
  }
  return base;
}

/** notices_parsed + 원문/메모 필드 결합 enrichment (기등록 상품 런타임 보완) */
export function enrichNoticesForPackage(input: {
  notices_parsed?: unknown;
  customer_notes?: string | null;
  internal_notes?: string | null;
  raw_text?: string | null;
}): NoticeItem[] {
  const corpus = [input.raw_text, input.customer_notes, input.internal_notes].filter(Boolean).join('\n\n');
  const det = extractNotices(corpus);
  const llm = Array.isArray(input.notices_parsed) ? input.notices_parsed : [];
  return mergeNoticesParsed(llm, det);
}

/**
 * 본문에서 REMARK/비고/특이사항/주의사항 섹션의 문장을 추출해 4-type 으로 분류.
 * 섹션 우선 스캔 후 전문 키워드 스캔으로 누락 보완.
 */
export function extractNotices(rawText: string): NoticeItem[] {
  if (!rawText) return [];

  const buckets: Record<NoticeItem['type'], string[]> = {
    CRITICAL: [],
    PAYMENT: [],
    POLICY: [],
    INFO: [],
  };

  const remarkLines = extractRemarkSectionLines(rawText);
  for (const line of remarkLines) {
    classifyLine(line, buckets);
  }
  if (remarkLines.length > 0) return bucketsToNotices(buckets);

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.length < 8 || line.length > 300) continue;
    const cleaned = line.replace(/^[▶●•·◆◇■□★☆+\-○•▪●◦*]+\s*/, '').trim();
    if (cleaned.length < 8) continue;
    classifyLine(cleaned, buckets);
  }

  return bucketsToNotices(buckets);
}
