/**
 * Client-safe standard-terms helpers (no Supabase / server imports).
 * DetailClient·PackageTermsBottomSheet 등 'use client' 번들에서 사용.
 */

export type NoticeSurface = 'a4' | 'mobile' | 'booking_guide';
export type NoticeSeverity = 'critical' | 'standard' | 'info';

export interface NoticeBlock {
  type: string;
  title: string;
  text: string;
  surfaces?: NoticeSurface[];
  severity?: NoticeSeverity;
  replaces?: string[];
  _source?: string;
  _tier?: 1 | 2 | 3 | 4;
}

/** tier 3+ · tier 4 상품 특약 — 취소/환불 맥락 (AUTO_TICKETING 제외) */
export function hasProductSpecialCancelPolicy(notices: readonly NoticeBlock[]): boolean {
  return notices.some(n => {
    const combined = `${n.title ?? ''} ${n.text ?? ''}`;
    if (/특별\s*약관|특약|파이널|취소\s*불가|환불\s*불가|실비.*청구|위약금.*100%|100%.*공제|100%.*청구/.test(combined)) {
      return true;
    }
    if (/취소\/환불|환불\/취소/.test(n.title ?? '')) return true;
    if ((n._tier ?? 0) >= 4 && /취소|환불|수수료|위약/.test(combined)) return true;
    if (n.type === 'PAYMENT' && /취소|환불|수수료|위약|공제|파이널/.test(combined)) return true;
    return false;
  });
}

/** 모바일/예약 UI — "특별약관" 경고 배너 노출 여부 */
export function hasSpecialTermsBanner(notices: readonly NoticeBlock[]): boolean {
  if (notices.some(n => (n._tier ?? 1) >= 3)) return true;
  return notices.some(n => {
    if ((n._tier ?? 0) < 4) return false;
    const combined = `${n.title ?? ''} ${n.text ?? ''}`;
    return /취소\/환불|환불\/취소|특별\s*약관|특약/.test(combined)
      || /취소|환불|수수료|위약/.test(combined);
  });
}

/** 표준 취소 일수표(RESERVATION) · CTA 요약 카드에서 숨김 여부 */
export function shouldSuppressStandardCancelTable(notices: readonly NoticeBlock[]): boolean {
  if (notices.some(n => n.type === 'AUTO_TICKETING')) return true;
  return hasProductSpecialCancelPolicy(notices);
}

export const NOTICE_DOT_COLOR: Record<string, string> = {
  RESERVATION: 'bg-purple-500',
  PAYMENT: 'bg-orange-500',
  PASSPORT: 'bg-amber-500',
  LIABILITY: 'bg-slate-500',
  COMPLAINT: 'bg-emerald-500',
  NOSHOW: 'bg-red-500',
  PANDEMIC: 'bg-blue-500',
  SURCHARGE: 'bg-rose-500',
  AUTO_TICKETING: 'bg-red-600',
  BUSINESS_HOURS: 'bg-orange-600',
  MIN_PARTICIPANTS: 'bg-gray-400',
  CRITICAL: 'bg-red-500',
  POLICY: 'bg-blue-500',
  INFO: 'bg-gray-400',
};

export const NOTICE_CARD_TONE: Record<string, { border: string; bg: string }> = {
  RESERVATION:      { border: 'border-l-purple-400', bg: 'bg-purple-50/40' },
  PAYMENT:          { border: 'border-l-orange-400', bg: 'bg-orange-50/40' },
  PASSPORT:         { border: 'border-l-amber-400',  bg: 'bg-amber-50/40' },
  LIABILITY:        { border: 'border-l-slate-400',  bg: 'bg-slate-50/60' },
  COMPLAINT:        { border: 'border-l-emerald-400',bg: 'bg-emerald-50/40' },
  NOSHOW:           { border: 'border-l-red-400',    bg: 'bg-red-50/40' },
  PANDEMIC:         { border: 'border-l-blue-400',   bg: 'bg-blue-50/40' },
  SURCHARGE:        { border: 'border-l-rose-400',   bg: 'bg-rose-50/40' },
  AUTO_TICKETING:   { border: 'border-l-red-500',    bg: 'bg-red-50/60' },
  BUSINESS_HOURS:   { border: 'border-l-orange-500', bg: 'bg-orange-50/50' },
  MIN_PARTICIPANTS: { border: 'border-l-gray-300',   bg: 'bg-gray-50/60' },
  CRITICAL:         { border: 'border-l-red-500',    bg: 'bg-red-50/60' },
  POLICY:           { border: 'border-l-blue-400',   bg: 'bg-blue-50/40' },
  INFO:             { border: 'border-l-gray-300',   bg: 'bg-white' },
};

export function getSourceBadgeColor(source?: string, tier?: number): string {
  if (!source || tier === 1) return 'text-gray-400';
  if (tier === 2) return 'text-blue-600';
  if (tier === 3) return 'text-purple-600';
  if (tier === 4 || source === '상품 특약') return 'text-red-600';
  return 'text-gray-400';
}
