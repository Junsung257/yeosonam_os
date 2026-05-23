/**
 * @file product-policy.ts — 카탈로그 표준 어휘 기반 상품 정책 (LLM 0)
 *
 * 노팁·노옵션·노쇼핑 등 제목/원문 키워드 → notices·excludes·product_type 동기화.
 * 프롬프트/렌더 분산 대신 등록·로드 공통 후처리 SSOT.
 */

import type { NoticeItem } from './notices';
import { TITLE_BY_TYPE } from './notices';

export interface CatalogProductFlags {
  noTip: boolean;
  noOption: boolean;
  noShopping: boolean;
}

const NO_TIP_RE = /노\s*팁|no\s*tip/i;
const NO_OPTION_RE = /노\s*옵션|no\s*option/i;
const NO_SHOPPING_RE = /노\s*쇼핑|no\s*shop/i;

export function detectCatalogProductFlags(
  title: string | null | undefined,
  rawText: string | null | undefined,
  productType?: string | null,
): CatalogProductFlags {
  const combined = `${title ?? ''}\n${rawText ?? ''}`;
  const pt = (productType ?? '').trim();
  return {
    noTip: NO_TIP_RE.test(combined) || pt === '노팁',
    noOption: NO_OPTION_RE.test(combined) || pt === '노옵션',
    noShopping: NO_SHOPPING_RE.test(combined) || pt === '노쇼핑',
  };
}

/** 제목에서 product_type 힌트 — LLM 미추출 시 보완 */
export function inferProductTypeFromTitle(
  title: string | null | undefined,
  current?: string | null,
): string | null {
  if (current && current !== 'package' && current.trim()) return current.trim();
  const t = (title ?? '').trim();
  if (!t) return current ?? null;
  if (NO_TIP_RE.test(t) && NO_OPTION_RE.test(t)) return '노팁';
  if (NO_SHOPPING_RE.test(t)) return '노쇼핑';
  if (NO_OPTION_RE.test(t)) return '노옵션';
  if (NO_TIP_RE.test(t)) return '노팁';
  return current ?? null;
}

const NO_TIP_POLICY_LINE =
  '가이드·기사·선장·말 안장 팁 등은 상품가에 포함되지 않으며 현지에서 별도 지불됩니다.';

function upsertNoticeLine(notices: NoticeItem[], type: NoticeItem['type'], line: string): NoticeItem[] {
  const idx = notices.findIndex(n => n.type === type);
  if (idx < 0) {
    return [
      ...notices,
      { type, title: TITLE_BY_TYPE[type], text: `• ${line}` },
    ];
  }
  const existing = notices[idx];
  if (existing.text.includes(line.slice(0, 20))) return notices;
  const updated = {
    ...existing,
    text: `${existing.text}\n• ${line}`,
  };
  return notices.map((n, i) => (i === idx ? updated : n));
}

/** 노팁 상품 — POLICY 유의사항 + excludes에 팁 불포함 명시 */
export function applyNoTipPolicy(
  notices: NoticeItem[],
  excludes: string[],
  flags: CatalogProductFlags,
): { notices: NoticeItem[]; excludes: string[] } {
  if (!flags.noTip) return { notices, excludes };

  const nextNotices = upsertNoticeLine(notices, 'POLICY', NO_TIP_POLICY_LINE);
  const nextExcludes = [...excludes];

  const tipExcludeLine = '가이드·기사·선장·말 안장 팁 등';
  const hasTipExclude = nextExcludes.some(x => /팁|tip/i.test(x));
  if (!hasTipExclude) {
    nextExcludes.push(tipExcludeLine);
  }

  // inclusions 에 "팁 포함" 환각 제거
  return { notices: nextNotices, excludes: nextExcludes };
}

/** inclusions 에 팁 포함 환각 제거 (노팁 상품) */
export function stripFalseTipInclusions(
  inclusions: string[],
  flags: CatalogProductFlags,
): string[] {
  if (!flags.noTip) return inclusions;
  return inclusions.filter(
    line => !/(?:가이드|기사|선장|말\s*안장).*팁.*포함|팁\s*포함|매너\s*팁\s*포함/i.test(line),
  );
}
