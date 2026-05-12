/**
 * ══════════════════════════════════════════════════════════
 * Standard Terms — 4-level 약관 우선순위 시스템
 * ══════════════════════════════════════════════════════════
 *   Tier 1 (plat form) → Tier 2 (operator_common) → Tier 3 (operator_variant) → Tier 4 (product)
 *   같은 notice.type 이면 높은 tier 가 override. 새 type 은 append.
 *
 * 주요 진입점:
 *   - resolveTermsForPackage(pkg, surface)  : 상품별 약관 확정 머지 (비동기)
 *   - buildTermsSnapshot(pkg)               : 예약 시점 스냅샷 (법적 방어용)
 *   - formatCancellationDates(notices, dep) : 출발일 기준 취소일 자동 병기 (하나투어 방식)
 */

import { supabaseAdmin, isSupabaseConfigured } from './supabase';

// ── 타입 ─────────────────────────────────────────────────────
export type NoticeSurface = 'a4' | 'mobile' | 'booking_guide';
export type NoticeSeverity = 'critical' | 'standard' | 'info';

export interface NoticeBlock {
  type: string;
  title: string;
  text: string;
  surfaces?: NoticeSurface[];
  severity?: NoticeSeverity;
  /**
   * 이 블록이 명시적으로 대체하는 하위 tier 블록 type 목록.
   * 예: 특약 PAYMENT 블록이 플랫폼 RESERVATION 을 대체할 때 ['RESERVATION'].
   * 비워두면 동일 type 만 대체.
   */
  replaces?: string[];
  /** 런타임에 채워지는 출처 (UI 배지용). DB에는 저장 X */
  _source?: string;
  /** 런타임 tier 태그 (1~4). DB에는 저장 X */
  _tier?: 1 | 2 | 3 | 4;
}

export interface TermsTemplate {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  scope: {
    all?: boolean;
    land_operator_id?: string;
    product_type_keywords?: string[];
  };
  notices: NoticeBlock[];
  priority: number;
  version: number;
  is_current: boolean;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
}

export interface PackageForTerms {
  id?: string;
  product_type?: string | null;
  land_operator_id?: string | null;
  notices_parsed?: unknown;
  departure_date?: string | null;
  price?: number | null;
}

// ── 캐시 (policy-engine.ts 패턴 차용) ────────────────────────
let templateCache: TermsTemplate[] = [];
let cacheExpiry = 0;
const CACHE_TTL = 60_000;

async function loadTemplates(): Promise<TermsTemplate[]> {
  if (Date.now() < cacheExpiry && templateCache.length > 0) return templateCache;
  if (!isSupabaseConfigured) return [];

  try {
    const now = new Date().toISOString();
    const { data } = await supabaseAdmin
      .from('terms_templates')
      .select('*')
      .eq('is_active', true)
      .eq('is_current', true)
      .lte('starts_at', now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order('tier', { ascending: true })
      .order('priority', { ascending: true });

    templateCache = (data ?? []) as TermsTemplate[];
    cacheExpiry = Date.now() + CACHE_TTL;
  } catch {
    // DB 실패 시 기존 캐시 유지
  }
  return templateCache;
}

export function invalidateTermsCache(): void {
  cacheExpiry = 0;
  templateCache = [];
}

// ── Scope 매칭 ───────────────────────────────────────────────
function tokenizeProductType(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[|,/\s]+/).map(s => s.trim()).filter(Boolean);
}

function matchesScope(tpl: TermsTemplate, pkg: PackageForTerms): boolean {
  const scope = tpl.scope ?? {};

  if (tpl.tier === 1) return scope.all === true;

  if (!scope.land_operator_id || scope.land_operator_id !== pkg.land_operator_id) {
    return false;
  }

  if (tpl.tier === 2) return true;

  if (tpl.tier === 3) {
    const keywords = scope.product_type_keywords ?? [];
    if (keywords.length === 0) return false;
    const tokens = tokenizeProductType(pkg.product_type);
    return keywords.some(k => tokens.includes(k));
  }

  return false;
}

// ── 상품별 특약 정규화 ────────────────────────────────────────
function normalizeProductNotices(raw: unknown): NoticeBlock[] {
  if (!Array.isArray(raw)) return [];
  const result: NoticeBlock[] = [];
  for (const n of raw) {
    if (!n || typeof n !== 'object') continue;
    const notice = n as Partial<NoticeBlock> & Record<string, unknown>;
    if (typeof notice.type !== 'string' || typeof notice.text !== 'string') continue;
    result.push({
      type: notice.type,
      title: typeof notice.title === 'string' ? notice.title : notice.type,
      text: notice.text,
      surfaces: Array.isArray(notice.surfaces)
        ? (notice.surfaces as NoticeSurface[])
        : ['mobile', 'booking_guide'],
      severity: (notice.severity as NoticeSeverity) ?? 'standard',
      replaces: Array.isArray(notice.replaces) ? (notice.replaces as string[]) : undefined,
    });
  }
  return result;
}

// ── 특약 탐지: 상위 tier(3+)의 블록 중 취소/환불/수수료/파이널 관련 PAYMENT
//    또는 "특약" 시그니처가 있으면 하위 tier 의 RESERVATION(예약 및 취소 규정) 자동 제외.
//    Why: 특약 취소 규정(예: "파이널 후 100%")과 표준약관("30일 전 전액 환불")이
//    동시 노출되면 약관규제법 §6(2) 에 의해 소비자에게 유리하게 해석 → 여행사 패소.
//    ERR-FUK-clause-duplication(2026-04-19) 재발 방지.
//    False positive 방지: 단순 싱글차지 PAYMENT 는 취소 문맥 아니므로 제외.
function hasSpecialCancelPolicy(notices: readonly NoticeBlock[]): boolean {
  return notices.some(n => {
    const combined = `${n.title ?? ''} ${n.text ?? ''}`;
    if (/특별\s*약관|특약|파이널\s*후|취소\s*불가/.test(combined)) return true;
    if (n.type === 'PAYMENT' && /취소|환불|수수료|위약|공제|파이널/.test(combined)) return true;
    return false;
  });
}

// ── 메인: 4-level 머지 ───────────────────────────────────────
export async function resolveTermsForPackage(
  pkg: PackageForTerms,
  surface: NoticeSurface,
): Promise<NoticeBlock[]> {
  const templates = await loadTemplates();

  // Tier 별 블록 수집 (내림차순: 4 → 3 → 2 → 1)
  const byTier: Record<1 | 2 | 3 | 4, NoticeBlock[]> = { 1: [], 2: [], 3: [], 4: [] };

  for (const tier of [1, 2, 3] as const) {
    const matches = templates
      .filter(t => t.tier === tier && matchesScope(t, pkg))
      .sort((a, b) => a.priority - b.priority);
    for (const tpl of matches) {
      for (const n of tpl.notices) {
        byTier[tier].push({ ...n, _source: tpl.name, _tier: tier });
      }
    }
  }

  for (const n of normalizeProductNotices(pkg.notices_parsed)) {
    byTier[4].push({ ...n, _source: '상품 특약', _tier: 4 });
  }

  // ── Exclusion 규칙 ────────────────────────────────────────
  //   1. 상위 tier 의 type 이 존재하면 하위 tier 의 같은 type 전체 제외 (tier-level override)
  //      Within-tier 다건은 모두 보존 (예: 상품의 PAYMENT 2개 "취소수수료" + "결제안내" 둘 다 노출)
  //   2. 상위 tier 에 '특약'이 있으면 하위 tier 의 RESERVATION 도 제외 (cross-type, ERR-FUK 대응)
  //   3. notice.replaces 필드로 명시적 대체 선언 가능

  const excludedTypes = new Set<string>();
  const result: NoticeBlock[] = [];

  for (const tier of [4, 3, 2, 1] as const) {
    const tierBlocks = byTier[tier];
    if (tierBlocks.length === 0) continue;

    // 이 tier 의 block 중 이미 상위가 claim 한 type 은 skip
    for (const n of tierBlocks) {
      if (excludedTypes.has(n.type)) continue;
      result.push(n);
    }

    // 이 tier 가 노출한 type + 명시적 replaces + 암묵적 cross-type 규칙을 excludedTypes 에 기록
    const tierTypes = new Set<string>();
    for (const n of tierBlocks) {
      if (excludedTypes.has(n.type)) continue;
      tierTypes.add(n.type);
      for (const replaced of (n.replaces ?? [])) tierTypes.add(replaced);
    }

    // ERR-FUK 암묵 규칙: tier>=3 에 특약 시그니처가 있으면 하위의 RESERVATION 제외
    if (tier >= 3 && hasSpecialCancelPolicy(tierBlocks)) {
      tierTypes.add('RESERVATION');
    }

    for (const t of tierTypes) excludedTypes.add(t);
  }

  // 결과 순서: tier 4(특약) 먼저, tier 1(표준) 마지막 — 기존 mergeNotices 동작 보존.
  //   push 순서가 이미 tier 4 → 3 → 2 → 1 이므로 추가 sort 불필요.

  // surface 필터
  return result.filter(n => {
    const surfaces = n.surfaces ?? ['mobile', 'booking_guide'];
    return surfaces.includes(surface);
  });
}

// ── 스냅샷: 예약 시점 약관 freeze ────────────────────────────
export interface TermsSnapshot {
  resolved_at: string;
  surface: NoticeSurface;
  notices: NoticeBlock[];
  template_ids: string[];
  has_special_terms: boolean;
}

export async function buildTermsSnapshot(
  pkg: PackageForTerms,
  surface: NoticeSurface = 'booking_guide',
): Promise<TermsSnapshot> {
  const notices = await resolveTermsForPackage(pkg, surface);
  const templateIds = Array.from(
    new Set(
      notices
        .map(n => n._source)
        .filter((s): s is string => !!s && s !== '상품 특약'),
    ),
  );
  const hasSpecialTerms = notices.some(
    n => (n._tier ?? 1) >= 3 || n.type === 'PAYMENT' || n.severity === 'critical',
  );
  return {
    resolved_at: new Date().toISOString(),
    surface,
    notices,
    template_ids: templateIds,
    has_special_terms: hasSpecialTerms,
  };
}

// ── 출발일 기준 취소일 자동 병기 (하나투어 방식) ──────────────
/**
 * RESERVATION 블록 내 "N일 전" 표현에 실제 날짜를 병기.
 *   "30일 전까지 취소" → "30일 전(2026.05.20)까지 취소"
 */
export function formatCancellationDates(
  notices: NoticeBlock[],
  departureDate: string | null | undefined,
): NoticeBlock[] {
  if (!departureDate) return notices;
  const dep = new Date(departureDate);
  if (Number.isNaN(dep.getTime())) return notices;

  const toYMD = (d: Date) =>
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

  return notices.map(n => {
    if (!['RESERVATION', 'PAYMENT'].includes(n.type)) return n;
    // ERR-HSN-cancel-date-pollution@2026-04-21: "출발21일전" 같이 "출발" 접두사가 붙은
    // 복합 표현은 취소수수료가 아니라 발권 기한 안내이므로 날짜 자동 주입 금지.
    // negative lookbehind 로 바로 앞이 "출발" 이면 스킵.
    //
    // ERR-HET-cancel-date-pollution-double-paren@2026-04-22: "45일전(~45)까지 통보시" 처럼
    // 바로 뒤에 기존 괄호가 있으면 `(YYYY.MM.DD)(~45)` 처럼 괄호가 두 개 연속 붙어 어색.
    // 기존 괄호 안쪽 끝에 `, YYYY.MM.DD까지` 를 병합해 자연스러운 형태로 변환.
    // (rebuild-trigger 2026-04-22-02)
    // (?<!\d) 추가 이유 — 기존 (?<!출발\s?) 만으로는 \d+ 의 greedy 가
    //   "출발 30일전" 에서 lookbehind 차단을 회피해 "0일전" 부분 매칭으로 우회됨.
    //   숫자 중간 매칭 차단을 추가해 의도된 동작 회복.
    const enriched = n.text.replace(/(?<!출발\s?)(?<!\d)(\d+)일\s*전(\s*\(([^)]*)\))?/g, (match, daysStr, bracket, inner) => {
      const days = parseInt(daysStr, 10);
      if (!Number.isFinite(days) || days < 0 || days > 365) return match;
      const target = new Date(dep);
      target.setDate(target.getDate() - days);
      const ymd = toYMD(target);
      if (bracket) {
        // 기존 괄호 안에 날짜 병합: `(~45)` → `(~45, 2026.05.24까지)`
        return `${daysStr}일전(${inner}, ${ymd}까지)`;
      }
      // 괄호 없으면 단독 괄호로 날짜만 추가
      return `${daysStr}일전(${ymd}까지)`;
    });
    return enriched === n.text ? n : { ...n, text: enriched };
  });
}

// ── UI 헬퍼 ──────────────────────────────────────────────────
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

// P2 #2 (2026-04-27): 유의사항 카드 type 별 좌측 보더 + 배경 톤.
// 아코디언이 닫혀 있어도 한눈에 type 구분 가능. 모든 항목이 동일한 "[상품 특약]" 라벨이어도
// CRITICAL(빨강) / PAYMENT(주황) / POLICY(파랑) / INFO(회색) 차별화로 우선순위 시각화.
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
