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

import { createHash } from 'node:crypto';

import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { withPublicQueryFallback } from './public-query-timeout';
import type {
  NoticeBlock,
  NoticeSurface,
  NoticeSeverity,
  RegistrationTermsPolicySnapshot,
  RegistrationTermsTemplateRef,
} from './standard-terms-client';
import {
  hasProductSpecialCancelPolicy,
  hasSpecialTermsBanner,
  sanitizeNoticeForCustomerSurface,
  shouldSuppressStandardCancelTable,
} from './standard-terms-client';

export type { NoticeBlock, NoticeSurface, NoticeSeverity } from './standard-terms-client';
export type { RegistrationTermsPolicySnapshot, RegistrationTermsTemplateRef } from './standard-terms-client';
export {
  hasProductSpecialCancelPolicy,
  hasSpecialTermsBanner,
  shouldSuppressStandardCancelTable,
  getSourceBadgeColor,
  NOTICE_DOT_COLOR,
  NOTICE_CARD_TONE,
} from './standard-terms-client';

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
const TERMS_TEMPLATE_QUERY_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.TERMS_TEMPLATE_QUERY_TIMEOUT_MS || '900') || 900,
);

async function loadTemplates(): Promise<TermsTemplate[]> {
  if (Date.now() < cacheExpiry && templateCache.length > 0) return templateCache;
  if (!isSupabaseConfigured) return [];

  try {
    const now = new Date().toISOString();
    const { data } = await withPublicQueryFallback(
      supabaseAdmin
        .from('terms_templates')
        .select('*')
        .eq('is_active', true)
        .eq('is_current', true)
        .lte('starts_at', now)
        .or(`ends_at.is.null,ends_at.gt.${now}`)
        .order('tier', { ascending: true })
        .order('priority', { ascending: true }),
      { data: templateCache },
      TERMS_TEMPLATE_QUERY_TIMEOUT_MS,
    );

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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function hashTermsValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function calculateRegistrationTermsPolicyHash(
  snapshot: Omit<RegistrationTermsPolicySnapshot, 'policy_hash'>,
): string {
  return hashTermsValue(snapshot);
}

export function hasValidRegistrationTermsPolicyHash(
  snapshot: RegistrationTermsPolicySnapshot,
): boolean {
  const { policy_hash: policyHash, ...content } = snapshot;
  return /^[0-9a-f]{64}$/iu.test(policyHash)
    && calculateRegistrationTermsPolicyHash(content) === policyHash;
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

function rewriteCustomerFacingB2BTerms(text: string): string {
  return text
    .replace(/파이널\s*\(\s*Final\s*\)\s*확정/g, '최종 확정')
    .replace(/파이널\s*확정/g, '최종 확정')
    .replace(/파이널\s*조건/g, '최종 확정 조건')
    .replace(/파이널\s*패널티/g, '확정 후 취소 위약금')
    .replace(/\bFinal\b/g, '최종')
    .replace(/파이널/g, '최종')
    .replace(/실명단/g, '여행자 정보')
    .replace(/투어비/g, '여행 요금');
}

function sanitizeNoticeForCustomer(notice: NoticeBlock): NoticeBlock {
  const tier = notice._tier ?? 4;
  const text = (notice.text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => tier >= 4 || !/(?:의무 쇼핑센터|랜드사 규정|페널티\s*\(\s*\$?100|\$100\s*~\s*\$150|항공권을 발권|실비 전액|No-Show\s*100%)/i.test(line))
    .join('\n');
  return {
    ...notice,
    title: rewriteCustomerFacingB2BTerms(notice.title ?? ''),
    text: rewriteCustomerFacingB2BTerms(text),
  };
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

    // ERR-FUK: tier 3+ · tier 4 상품 특약이 취소 맥락이면 하위 RESERVATION 제외
    if (tier >= 3 && hasProductSpecialCancelPolicy(tierBlocks)) {
      tierTypes.add('RESERVATION');
    }

    for (const t of tierTypes) excludedTypes.add(t);
  }

  // 결과 순서: tier 4(특약) 먼저, tier 1(표준) 마지막 — 기존 mergeNotices 동작 보존.
  //   push 순서가 이미 tier 4 → 3 → 2 → 1 이므로 추가 sort 불필요.

  return filterNoticesForSurface(result, surface);
}

/** surface 태그 + P0 표준 일수표 억제 규칙 (테스트·프리뷰 공용) */
export function filterNoticesForSurface(
  notices: readonly NoticeBlock[],
  surface: NoticeSurface,
): NoticeBlock[] {
  let filtered = notices.filter(n => {
    const surfaces = n.surfaces ?? ['mobile', 'booking_guide'];
    return surfaces.includes(surface);
  });

  // mobile/booking_guide: AUTO_TICKETING·특약과 표준 일수표 동시 노출 금지 (A4·예약 스냅샷 전문은 유지)
  if (surface !== 'a4' && shouldSuppressStandardCancelTable(filtered)) {
    filtered = filtered.filter(n => n.type !== 'RESERVATION');
  }

  return filtered
    .map(sanitizeNoticeForCustomer)
    .filter(notice => notice.title.trim().length > 0 || notice.text.trim().length > 0);
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
  const hasSpecialTerms = hasSpecialTermsBanner(notices);
  return {
    resolved_at: new Date().toISOString(),
    surface,
    notices,
    template_ids: templateIds,
    has_special_terms: hasSpecialTerms,
  };
}

export function buildRegistrationTermsPolicySnapshot(input: {
  notices: NoticeBlock[];
  templateRefs: RegistrationTermsTemplateRef[];
  productNotices?: NoticeBlock[];
  surface?: NoticeSurface;
}): RegistrationTermsPolicySnapshot {
  const surface = input.surface ?? 'mobile';
  const productNotices = input.productNotices ?? [];
  const sourceHasCancellationPolicy = input.notices.some(notice => {
    const combined = `${notice.type} ${notice.title ?? ''} ${notice.text ?? ''}`;
    return ['RESERVATION', 'AUTO_TICKETING'].includes(notice.type)
      || /(?:취소|취소료|해약|여행약관|특별약관|위약금|패널티|cancel|cancellation)/iu.test(combined);
  });
  const customerNotices = input.notices
    .map(sanitizeNoticeForCustomerSurface)
    .filter((notice): notice is NoticeBlock => Boolean(notice));
  const customerHasCancellationPolicy = customerNotices.some(notice =>
    ['RESERVATION', 'AUTO_TICKETING'].includes(notice.type)
      || /(?:취소|취소료|해약|여행약관|특별약관|위약금|cancel|cancellation)/iu
        .test(`${notice.type} ${notice.title ?? ''} ${notice.text ?? ''}`));
  const sourceCancellationNotice = input.notices.find(notice => {
    if ((notice._tier ?? 0) < 4) return false;
    const combined = `${notice.type} ${notice.title ?? ''} ${notice.text ?? ''}`;
    return ['RESERVATION', 'AUTO_TICKETING'].includes(notice.type)
      || /(?:취소|취소료|해약|여행약관|특별약관|위약금|패널티|cancel|cancellation)/iu.test(combined);
  });
  const standardCancellationNotice = input.notices.find(notice => {
    if ((notice._tier ?? 4) >= 4) return false;
    const combined = `${notice.type} ${notice.title ?? ''} ${notice.text ?? ''}`;
    return ['RESERVATION', 'AUTO_TICKETING'].includes(notice.type)
      || /(?:취소|취소료|해약|여행약관|특별약관|위약금|패널티|cancel|cancellation)/iu.test(combined);
  });
  const sourceCancellationLines = input.notices
    .filter(notice => (notice._tier ?? 0) >= 4)
    .flatMap(notice => `${notice.title ?? ''}\n${notice.text ?? ''}`.split(/\r?\n/u))
    .map(line => line.trim())
    .filter(line => /(?:취소|환불|위약|수수료|패널티)/u.test(line));
  const penaltyRatesByDay = new Map<number, Set<number>>();
  for (const line of sourceCancellationLines) {
    for (const match of line.matchAll(/(\d{1,3})\s*일\s*전[^\n%]{0,80}?(\d{1,3})\s*%/gu)) {
      const day = Number(match[1]);
      const rate = Number(match[2]);
      if (!Number.isInteger(day) || !Number.isInteger(rate) || rate > 100) continue;
      const rates = penaltyRatesByDay.get(day) ?? new Set<number>();
      rates.add(rate);
      penaltyRatesByDay.set(day, rates);
    }
  }
  const cancellationConflictReasons = [...penaltyRatesByDay.entries()]
    .filter(([, rates]) => rates.size > 1)
    .map(([day, rates]) => `SOURCE_CANCELLATION_RATE_CONFLICT:${day}D:${[...rates].sort((a, b) => a - b).join(',')}`);
  const cancellationConflict = cancellationConflictReasons.length > 0;
  const cancellationAuthority = sourceCancellationNotice
    ? 'source' as const
    : standardCancellationNotice
      ? 'approved_standard' as const
      : 'missing' as const;
  const cancellationTemplateRef = cancellationAuthority === 'approved_standard'
    ? input.templateRefs.find(ref => ref.name === standardCancellationNotice?._source) ?? null
    : null;
  const content = {
    policy_version: 'registration-terms-policy-v1' as const,
    surface,
    notices: customerNotices,
    template_refs: input.templateRefs,
    source_notices_hash: hashTermsValue(input.notices),
    product_notice_hash: productNotices.length > 0 ? hashTermsValue(productNotices) : null,
    has_cancellation_policy: sourceHasCancellationPolicy && customerHasCancellationPolicy
      && cancellationAuthority !== 'missing' && !cancellationConflict,
    has_special_terms: hasSpecialTermsBanner(customerNotices),
    cancellation_authority: cancellationAuthority,
    cancellation_template_ref: cancellationTemplateRef,
    cancellation_conflict: cancellationConflict,
    cancellation_conflict_reasons: cancellationConflictReasons,
  };
  return { ...content, policy_hash: calculateRegistrationTermsPolicyHash(content) };
}

/** Resolves the exact legal/commercial policy that V6 validates and freezes
 * into its immutable customer snapshot. This removes runtime template drift. */
export async function resolveRegistrationTermsPolicy(
  pkg: PackageForTerms,
  surface: NoticeSurface = 'mobile',
): Promise<RegistrationTermsPolicySnapshot> {
  const templates = await loadTemplates();
  const notices = await resolveTermsForPackage(pkg, surface);
  const usedSources = new Set(notices.map(notice => notice._source).filter(Boolean));
  const templateRefs = templates
    .filter(template => matchesScope(template, pkg) && usedSources.has(template.name))
    .map(template => ({
      id: template.id,
      name: template.name,
      tier: template.tier,
      version: template.version,
      starts_at: template.starts_at,
    }));
  return buildRegistrationTermsPolicySnapshot({
    notices,
    templateRefs,
    productNotices: normalizeProductNotices(pkg.notices_parsed),
    surface,
  });
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
    const withRangeDates = n.text.replace(/(?<!출발\s?)(?<!\d)(\d+)일\s*~\s*(\d+)일\s*전(\s*\(([^)]*)\))?/g, (match, fromDaysStr, toDaysStr, bracket, inner) => {
      const fromDays = parseInt(fromDaysStr, 10);
      const toDays = parseInt(toDaysStr, 10);
      if (
        !Number.isFinite(fromDays) ||
        !Number.isFinite(toDays) ||
        fromDays < 0 ||
        toDays < 0 ||
        fromDays > 365 ||
        toDays > 365
      ) {
        return match;
      }

      const fromTarget = new Date(dep);
      fromTarget.setDate(fromTarget.getDate() - fromDays);
      const toTarget = new Date(dep);
      toTarget.setDate(toTarget.getDate() - toDays);
      const fromYmd = toYMD(fromTarget);
      const toYmd = toYMD(toTarget);
      const toText = bracket
        ? `${toDaysStr}일전(${inner}, ${toYmd}까지)`
        : `${toDaysStr}일전(${toYmd}까지)`;
      return `${fromDaysStr}일(${fromYmd}까지) ~ ${toText}`;
    });

    const enriched = withRangeDates.replace(/(?<!출발\s?)(?<!\d)(\d+)일\s*전(\s*\(([^)]*)\))?/g, (match, daysStr, bracket, inner) => {
      if (inner && /\d{4}\.\d{2}\.\d{2}까지/.test(inner)) return match;
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
