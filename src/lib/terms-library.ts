/**
 * @file terms-library.ts — Phase 1.5 자동 약관 조립 resolver
 *
 * IR meta 기반으로 필수 약관을 자동 조립한다.
 *   - 룰 매칭: 하드코딩 (여기 파일) + DB terms_templates 동적
 *   - 텍스트 본문: DB 우선, 하드코딩은 fallback
 *
 * 관련:
 *   - project_terms_system (4-level 우선순위 + 예약 시점 스냅샷)
 *   - standard-terms.ts (formatCancellationDates 등)
 *   - IR notices.manual (원문 특약) 과 병합 시 manual 우선
 */

import type { IntakeNoticeBlock } from './intake-normalizer';
import type { SupabaseClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════════════════
//  Resolver 입력
// ═══════════════════════════════════════════════════════════════════════════

export interface TermsContext {
  country?: string | null;             // "중국", "일본", "베트남"
  region?: string | null;              // "황산", "후쿠오카"
  productType?: string | null;         // "노쇼핑", "골프", "실속"...
  airline?: string | null;             // "BX(에어부산)", "7C(제주항공)"
  flightCodes?: string[] | null;       // ["BX3615", "BX3625"] — 전세기 패턴 감지
  departureDate?: string | null;       // 가장 빠른 출발일 (ISO)
  ticketingDeadline?: string | null;
  tags?: string[] | null;              // ["무제한라운드", "노팁", ...]
}

// ═══════════════════════════════════════════════════════════════════════════
//  하드코딩 기본 룰 (DB 비어있어도 작동하는 fallback 세트)
// ═══════════════════════════════════════════════════════════════════════════

interface RuleFn {
  id: string;
  match: (ctx: TermsContext) => boolean;
  block: (ctx: TermsContext) => IntakeNoticeBlock | null;
}

const STATIC_RULES: RuleFn[] = [
  // ── 공통 (여권) ──────────────────────────────────────────────────────
  {
    id: 'passport-6month',
    match: () => true,
    block: () => ({
      type: 'POLICY',
      title: '여권 유효기간',
      text: '여권 유효기간은 출발일 기준 6개월 이상 남아 있어야 출국이 가능합니다.',
    }),
  },

  // ── 중국 무비자 (2026.12.31 까지) ────────────────────────────────────
  {
    id: 'china-visa-free-15',
    match: (ctx) => /중국|China/i.test(ctx.country || ''),
    block: (ctx) => {
      const deadlineOk = !ctx.departureDate || ctx.departureDate <= '2026-12-31';
      if (!deadlineOk) return null;
      return {
        type: 'POLICY',
        title: '무비자 정책',
        text: '2026년 12월 31일까지 일반여권 소지자를 대상으로 비자면제 정책 시행중입니다. (여행/관광/비즈니스 등 중국 입국 시 15일까지 무비자 체류 가능)',
      };
    },
  },
  {
    id: 'china-visa-exceptions',
    match: (ctx) => /중국/.test(ctx.country || ''),
    block: () => ({
      type: 'POLICY',
      title: '무비자 예외 여권',
      text: '단수여권, 급행여권, 관용여권은 무비자 불가할 수 있습니다. 담당자에게 꼭 알려주세요. ※ 여권 재발급 시 사전에 반드시 알려주셔야 합니다.',
    }),
  },

  // ── 노쇼핑 ────────────────────────────────────────────────────────────
  {
    id: 'no-shopping-guarantee',
    match: (ctx) => /노쇼핑/.test(ctx.productType || ''),
    block: () => ({
      type: 'INFO',
      title: '노쇼핑 보증',
      text: '본 상품은 쇼핑 일정이 포함되어 있지 않습니다. 쇼핑 불참으로 인한 패널티 없이 자유롭게 여행하실 수 있습니다.',
    }),
  },

  // ── 골프 ──────────────────────────────────────────────────────────────
  {
    id: 'golf-18hole-condition',
    match: (ctx) =>
      /골프/.test(ctx.productType || '') ||
      (ctx.tags || []).some((t) => /골프|라운드|CC/.test(t)),
    block: () => ({
      type: 'INFO',
      title: '골프 라운드 조건',
      text: '무제한 라운드 조건은 자율 라운드이며, 18홀 이상 라운드를 권장드립니다. 2인 라운드 시 현지인/한국인 조인 플레이가 될 수 있습니다.',
    }),
  },

  // ── 전세기 (BX + 4자리 항공편 코드 3xxx 패턴 감지) ───────────────────
  {
    id: 'charter-flight-special',
    match: (ctx) =>
      (ctx.flightCodes || []).some((c) => /^(BX|LJ|7C|TW)\s?[3-9]\d{3}$/.test(c)),
    block: () => ({
      type: 'PAYMENT',
      title: '전세기 특별약관',
      text: '전세기 특별약관 적용 상품으로, 예약 시 일인 20만원 데파짓 입금 시 예약확정됩니다. 항공 발권 후 (출발21일전) 취소 시 항공료 전액 환불 불가이므로 신중한 예약을 부탁드립니다.',
    }),
  },

  // ── 취소/클레임 기본 안내 (standard-terms 에도 있지만 보강) ─────────
  {
    id: 'claim-30day-window',
    match: () => true,
    block: () => ({
      type: 'POLICY',
      title: '클레임 접수 기간',
      text: '여행 중 불만사항은 현지 가이드에게 즉시 고지 부탁드립니다. 사후 클레임은 귀국일 기준 30일 이내 접수 건만 처리됩니다.',
    }),
  },

  // ── 감염병/특별여행주의보 ──────────────────────────────────────────
  {
    id: 'pandemic-cancel',
    match: () => true,
    block: () => ({
      type: 'POLICY',
      title: '감염병/여행경보 시 계약 해제',
      text: '외국정부의 입국금지·격리조치 또는 외교부 여행경보 3단계(철수권고)·4단계(여행금지) 발령 시 손해배상 없이 계약해제 가능. WHO 감염병 경보 5·6단계 시 손해배상액 50% 감경.',
    }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  DB `terms_templates` 조회 + scope 매칭
// ═══════════════════════════════════════════════════════════════════════════

interface TermsTemplateRow {
  id: string;
  name: string;
  tier: number;           // 1=platform, 2=operator, 3=variant, 4=product
  scope: Record<string, unknown> | null;
  notices: IntakeNoticeBlock[] | null;
  priority: number | null;
  is_active: boolean;
  is_current: boolean;
}

function matchScope(scope: Record<string, unknown> | null, ctx: TermsContext): boolean {
  if (!scope || Object.keys(scope).length === 0) return true; // 전역 적용
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  // country / region / productType / airline 4가지 축 매칭
  if (scope.country && !str(scope.country).split(/[,|]/).some((c) => (ctx.country || '').includes(c.trim()))) return false;
  if (scope.region && !str(scope.region).split(/[,|]/).some((r) => (ctx.region || '').includes(r.trim()))) return false;
  if (scope.productType && !str(scope.productType).split(/[,|]/).some((p) => (ctx.productType || '').includes(p.trim()))) return false;
  if (scope.airline && !str(scope.airline).split(/[,|]/).some((a) => (ctx.airline || '').includes(a.trim()))) return false;

  return true;
}

async function loadDbTemplates(
  sb: SupabaseClient | null,
  ctx: TermsContext,
): Promise<IntakeNoticeBlock[]> {
  if (!sb) return [];
  const { data, error } = await sb
    .from('terms_templates')
    .select('id, name, tier, scope, notices, priority, is_active, is_current')
    .eq('is_active', true)
    .eq('is_current', true);

  if (error || !Array.isArray(data)) return [];

  const matched: Array<{ row: TermsTemplateRow; notices: IntakeNoticeBlock[] }> = [];
  for (const row of data as TermsTemplateRow[]) {
    if (!matchScope(row.scope, ctx)) continue;
    if (!Array.isArray(row.notices) || row.notices.length === 0) continue;
    matched.push({ row, notices: row.notices });
  }
  // tier 낮은 순서 (platform=1 가장 먼저) · priority 높은 순서
  matched.sort((a, b) =>
    a.row.tier - b.row.tier || (b.row.priority || 0) - (a.row.priority || 0),
  );
  return matched.flatMap((m) => m.notices);
}

// ═══════════════════════════════════════════════════════════════════════════
//  퍼블릭 entry
// ═══════════════════════════════════════════════════════════════════════════

function dedupeByTitle(blocks: IntakeNoticeBlock[]): IntakeNoticeBlock[] {
  const seen = new Set<string>();
  const out: IntakeNoticeBlock[] = [];
  for (const b of blocks) {
    const key = b.title.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/**
 * 자동 약관 조립.
 *
 * @param ctx   IR meta 기반 context
 * @param sb    Supabase 클라이언트 (null 이면 하드코딩 룰만 사용)
 * @returns 자동 생성된 NoticeBlock 배열 (manual 과 병합 전)
 */
export async function resolveRequiredTerms(
  ctx: TermsContext,
  sb: SupabaseClient | null = null,
): Promise<IntakeNoticeBlock[]> {
  // 1) 하드코딩 룰 실행
  const staticBlocks = STATIC_RULES
    .filter((r) => r.match(ctx))
    .map((r) => r.block(ctx))
    .filter((b): b is IntakeNoticeBlock => b !== null);

  // 2) DB 템플릿 조회 (Platform → Operator → Variant → Product 우선순위)
  const dbBlocks = await loadDbTemplates(sb, ctx);

  // 3) 병합 + 제목 기준 중복 제거 (DB 가 우선 — 운영자가 최신화 가능)
  return dedupeByTitle([...dbBlocks, ...staticBlocks]);
}

/** manual + auto 병합. manual 우선 (원문 특약이 우선). */
export function mergeNotices(
  manual: IntakeNoticeBlock[],
  auto: IntakeNoticeBlock[],
): IntakeNoticeBlock[] {
  return dedupeByTitle([...manual, ...auto]);
}
