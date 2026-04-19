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
    });
  }
  return result;
}

// ── 메인: 4-level 머지 ───────────────────────────────────────
export async function resolveTermsForPackage(
  pkg: PackageForTerms,
  surface: NoticeSurface,
): Promise<NoticeBlock[]> {
  const templates = await loadTemplates();

  // Tier 1 → 2 → 3 순차 수집
  const ordered: Array<{ tpl: TermsTemplate; tier: 1 | 2 | 3 }> = [];
  for (const tier of [1, 2, 3] as const) {
    const matches = templates
      .filter(t => t.tier === tier && matchesScope(t, pkg))
      .sort((a, b) => a.priority - b.priority);
    for (const tpl of matches) ordered.push({ tpl, tier });
  }

  // type 기준 override (낮은 tier 먼저 → 높은 tier 덮어씀)
  const byType = new Map<string, NoticeBlock>();
  for (const { tpl, tier } of ordered) {
    for (const n of tpl.notices) {
      byType.set(n.type, { ...n, _source: tpl.name, _tier: tier });
    }
  }

  // Tier 4: 상품별 특약 (최우선)
  for (const n of normalizeProductNotices(pkg.notices_parsed)) {
    byType.set(n.type, { ...n, _source: '상품 특약', _tier: 4 });
  }

  // surface 필터
  return Array.from(byType.values()).filter(n => {
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
    const enriched = n.text.replace(/(\d+)일\s*전/g, (match, daysStr) => {
      const days = parseInt(daysStr, 10);
      if (!Number.isFinite(days) || days < 0 || days > 365) return match;
      const target = new Date(dep);
      target.setDate(target.getDate() - days);
      return `${match}(${toYMD(target)})`;
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
  CRITICAL: 'bg-red-500',
  POLICY: 'bg-blue-500',
  INFO: 'bg-gray-400',
};

export function getSourceBadgeColor(source?: string, tier?: number): string {
  if (!source || tier === 1) return 'text-gray-400';
  if (tier === 2) return 'text-blue-600';
  if (tier === 3) return 'text-purple-600';
  if (tier === 4 || source === '상품 특약') return 'text-red-600';
  return 'text-gray-400';
}
