import type { NoticeBlock } from './standard-terms-client';

export type TermsPresentationGroupId = 'cancel' | 'surcharge' | 'liability' | 'customer';

export interface TermsPresentationGroup {
  id: TermsPresentationGroupId;
  icon: string;
  title: string;
  notices: NoticeBlock[];
}

export const TERMS_PRESENTATION_GROUPS: readonly {
  id: TermsPresentationGroupId;
  icon: string;
  title: string;
}[] = [
  { id: 'cancel', icon: '✈️', title: '취소 및 위약금 규정' },
  { id: 'surcharge', icon: '💰', title: '추가 요금 및 환율/유류 변동' },
  { id: 'liability', icon: '⚖️', title: '천재지변 및 면책 조항' },
  { id: 'customer', icon: '🛂', title: '고객 필수 의무 사항' },
] as const;

const TYPE_TO_GROUP: Partial<Record<string, TermsPresentationGroupId>> = {
  AUTO_TICKETING: 'cancel',
  BUSINESS_HOURS: 'cancel',
  NOSHOW: 'cancel',
  MIN_PARTICIPANTS: 'cancel',
  RESERVATION: 'cancel',
  SURCHARGE: 'surcharge',
  LIABILITY: 'liability',
  PANDEMIC: 'liability',
  PASSPORT: 'customer',
  PAYMENT: 'surcharge',
};

/** 모바일 바텀시트 — 4대 카테고리 분류 (DB 원문 유지, 표시만 묶음) */
export function classifyNoticeGroup(notice: NoticeBlock): TermsPresentationGroupId {
  const title = notice.title ?? '';
  const combined = `${title} ${notice.text ?? ''}`;

  if (/취소[·\/]환불|환불[·\/]취소|발권|영업시간|No-Show|노쇼|위약/.test(title)) return 'cancel';
  if (/추가요금|할증|유류|환율|써차지|Surcharge|결제/.test(title)) return 'surcharge';
  if (/천재|면책|감염병|불가항력|체재/.test(title)) return 'liability';
  if (/여권|비자|쇼핑|현장|이동\/안내|필수|의무/.test(title)) return 'customer';

  if (notice.type === 'PAYMENT' && /취소|환불|수수료|위약|공제|파이널/.test(combined)) {
    return 'cancel';
  }

  const byType = TYPE_TO_GROUP[notice.type];
  if (byType) return byType;

  if ((notice._tier ?? 0) >= 4) {
    if (/취소|환불|수수료|위약|발권/.test(combined)) return 'cancel';
    if (/추가|할증|만원|비용|유류|환율/.test(combined)) return 'surcharge';
    if (/여권|비자|쇼핑|eTravel|이트래블|입국/.test(combined)) return 'customer';
  }

  if (/취소|환불|위약|발권/.test(combined)) return 'cancel';
  if (/유류|환율|써차지|할증/.test(combined)) return 'surcharge';
  if (/면책|천재|감염|체재/.test(combined)) return 'liability';

  return 'customer';
}

/** 바텀시트 소제목 — 선행 이모지 클러스터 제거 (U+FE0F 잔여·깨짐 방지) */
export function stripNoticeTitleEmoji(title: string): string {
  return title
    .replace(/^[\p{Extended_Pictographic}\p{Emoji}\uFE0F\u200D\s]+/u, '')
    .replace(/^\uFFFD+/u, '')
    .trim();
}

/**
 * 표시에서 제외 — 구체 한도 없이 외부 문서·안내서만 가리키는 취소 문구.
 * tier1 AUTO_TICKETING 등 명시 조항이 별도 노출될 때 대체.
 */
export function isVagueExternalCancelReference(line: string): boolean {
  const t = line.replace(/^[•·▪\-]\s*/, '').replace(/\s+/g, '');
  if (!/안내서|별첨|참고하|별도\s*문서|규정\s*안내/.test(t)) return false;
  if (/100%|최대|실비|파이널|발권|위약금|공제/.test(t)) return false;
  return /취소|환불|수수료|위약/.test(t);
}

export function filterNoticeTextForDisplay(text: string): string {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !isVagueExternalCancelReference(l))
    .join('\n');
}

export function splitNoticeLines(text: string): string[] {
  return filterNoticeTextForDisplay(text)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => (l.startsWith('•') ? l : `• ${l}`));
}

/**
 * tier 4 랜드 원문 «취소/환불/여권/쇼핑» 같은 복합 제목 블록을
 * 표시용으로만 취소 vs 고객의무로 분리 (DB 원문은 유지).
 */
export function expandCompositeNotice(notice: NoticeBlock): NoticeBlock[] {
  const title = notice.title ?? '';
  if (!/취소\/환불.*(?:여권|쇼핑)|환불\/취소.*(?:여권|쇼핑)/.test(title)) {
    return [notice];
  }

  const cancelLines: string[] = [];
  const customerLines: string[] = [];

  for (const raw of notice.text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const body = line.replace(/^[•·▪\-]\s*/, '');
    if (isVagueExternalCancelReference(body)) continue;
    if (/취소|환불|수수료|위약|발권|파이널/.test(body)) {
      cancelLines.push(body);
    } else {
      customerLines.push(body);
    }
  }

  const out: NoticeBlock[] = [];
  if (cancelLines.length > 0) {
    out.push({ ...notice, title: '취소·환불', text: cancelLines.join('\n') });
  }
  if (customerLines.length > 0) {
    out.push({ ...notice, title: '여권·쇼핑·현장', text: customerLines.join('\n') });
  }
  return out.length > 0 ? out : [notice];
}

/** 표시용 — 그룹 내 유사 문장(여권 6개월·쇼핑 환불 등) 중복 제거 */
function semanticLineKey(line: string): string {
  const t = line.replace(/^[•·▪\-]\s*/, '').replace(/\s+/g, '');
  if (/여권.*6개월|만료일.*6개월|6개월.*여권/.test(t)) return 'passport-validity';
  if (/14세.*아동|가족증명|공증/.test(t)) return 'passport-minor';
  if (/쇼핑\s*2회|쇼핑2회/.test(t)) return 'shopping-count';
  if (/교환.*환불|환불.*한\s*달|한달.*환불/.test(t)) return 'shopping-refund';
  return t.slice(0, 80);
}

function dedupeSimilarLinesInGroup(notices: NoticeBlock[]): NoticeBlock[] {
  const seen = new Set<string>();
  const out: NoticeBlock[] = [];

  for (const notice of notices) {
    const kept: string[] = [];
    for (const raw of notice.text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (isVagueExternalCancelReference(line)) continue;
      const key = semanticLineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(line.replace(/^[•·▪\-]\s*/, ''));
    }
    const filteredText = filterNoticeTextForDisplay(kept.join('\n'));
    if (filteredText) {
      out.push({ ...notice, text: filteredText });
    }
  }
  return out;
}

/** 동일 type·title·text 중복 블록 제거 (tier 4 랜드 원문 3회 반복 등 — SSOT 유지, 표시만 dedupe) */
export function dedupeNoticesForDisplay(notices: readonly NoticeBlock[]): NoticeBlock[] {
  const seen = new Set<string>();
  const out: NoticeBlock[] = [];
  for (const notice of notices) {
    const key = `${notice.type}\0${notice.title ?? ''}\0${notice.text ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(notice);
  }
  return out;
}

export function groupNoticesForPresentation(notices: readonly NoticeBlock[]): TermsPresentationGroup[] {
  const buckets = new Map<TermsPresentationGroupId, NoticeBlock[]>(
    TERMS_PRESENTATION_GROUPS.map(g => [g.id, []]),
  );

  for (const notice of dedupeNoticesForDisplay(notices)) {
    for (const part of expandCompositeNotice(notice)) {
      buckets.get(classifyNoticeGroup(part))!.push(part);
    }
  }

  return TERMS_PRESENTATION_GROUPS
    .map(meta => ({
      ...meta,
      notices: dedupeSimilarLinesInGroup(buckets.get(meta.id) ?? []),
    }))
    .filter(g => g.notices.length > 0);
}
