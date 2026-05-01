/**
 * 입출금 채팅식 매칭 — 명령 → 후보 → 분기 결정 (Phase 1)
 *
 * payment-command-parser 결과(ParsedCommand)를 받아
 * bookings / customers / land_operators 후보를 조회하고
 * 분기 A/B/C/D 라벨을 결정한다.
 *
 * 정책 (project_payment_command_matching.md):
 *   - 출금 자동매칭 절대 금지. resolver 는 "후보 제시"만 담당.
 *   - 매칭 확정/룰 학습은 별도 API + 사장님 1-click 으로만.
 */

import type { ParsedCommand } from './payment-command-parser';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

export type MatchBranch = 'A' | 'B' | 'C' | 'D';

export interface BookingHit {
  id: string;
  booking_no: string;
  customer_name: string | null;
  departure_date: string | null;
  land_operator_id: string | null;
  land_operator_name: string | null;
  total_price: number;
  paid_amount: number;
  total_paid_out: number;
  status: string;
  payment_status: string | null;
  score: number;
  reasons: string[];
}

export interface OperatorHit {
  id: string;
  name: string;
  aliases: string[];
  score: number;
}

export interface LearnedRule {
  id: string;
  pattern_signature: string;
  parsed_operator_alias: string | null;
  resolved_operator_id: string | null;
  learn_count: number;
}

export interface ResolveResult {
  parsed: ParsedCommand;
  branch: MatchBranch;
  bookings: BookingHit[];
  operators: OperatorHit[];
  similarCustomers: string[];
  warnings: string[];
  learnedRulesApplied: number;
}

export function buildPatternSignature(parsed: ParsedCommand): string {
  const parts: string[] = [];
  if (parsed.bookingId) parts.push('BK');
  if (parsed.date) parts.push('DATE');
  if (parsed.customerName) parts.push('NAME');
  if (parsed.operatorAlias) parts.push('OP');
  return parts.join('_') || 'EMPTY';
}

/**
 * 학습 룰 기반 점수 가산.
 * 같은 (pattern_signature, alias, operator_id) 가 3회+ 누적된 패턴이면
 * 해당 booking 후보 점수에 부스트 (최대 +0.10, log 스케일).
 */
export function applyLearnedRuleBoost(
  baseScore: number,
  rule: LearnedRule | undefined,
): { score: number; reason: string | null } {
  if (!rule) return { score: baseScore, reason: null };
  const boost = Math.min(0.1, 0.04 + Math.log10(rule.learn_count + 1) * 0.03);
  const newScore = Math.min(1.0, baseScore + boost);
  return {
    score: newScore,
    reason: `학습된 패턴 ${rule.learn_count}회 (+${boost.toFixed(2)})`,
  };
}

// ── 순수 함수 ─────────────────────────────────────────────────────────

export function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
}

export function nameScore(query: string | null | undefined, target: string | null | undefined): number {
  if (!query || !target) return 0;
  const q = query.trim();
  const t = target.trim();
  if (!q || !t) return 0;
  if (q === t) return 1.0;
  if (t.includes(q) || q.includes(t)) return 0.85;
  if (q[0] === t[0]) return 0.4;
  return 0;
}

export function dateScore(query: string | null | undefined, target: string | null | undefined): number {
  if (!query || !target) return 0;
  const diff = Math.abs(diffDays(query, target));
  if (diff === 0) return 1.0;
  if (diff <= 1) return 0.85;
  if (diff <= 3) return 0.6;
  if (diff <= 7) return 0.3;
  return 0;
}

export function operatorScore(
  query: string | null | undefined,
  aliases: string[] | null | undefined,
): number {
  if (!query || !aliases || aliases.length === 0) return 0;
  const q = query.trim();
  if (!q) return 0;
  let best = 0;
  for (const a of aliases) {
    if (!a) continue;
    if (a === q) return 1.0;
    if (a.includes(q) || q.includes(a)) best = Math.max(best, 0.7);
  }
  return best;
}

export interface BookingForScoring {
  booking_no?: string | null;
  customer_name?: string | null;
  departure_date?: string | null;
  land_operator_aliases?: string[] | null;
}

export function scoreBooking(
  parsed: ParsedCommand,
  booking: BookingForScoring,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (parsed.bookingId && booking.booking_no === parsed.bookingId) {
    return { score: 1.0, reasons: [`BK-ID 정확 매칭 (${parsed.bookingId})`] };
  }

  let weight = 0;
  let raw = 0;

  if (parsed.customerName) {
    const s = nameScore(parsed.customerName, booking.customer_name);
    raw += 0.5 * s;
    weight += 0.5;
    if (s >= 1.0) reasons.push(`고객명 정확 (${booking.customer_name})`);
    else if (s >= 0.85) reasons.push(`고객명 부분 (${parsed.customerName} ≈ ${booking.customer_name})`);
    else if (s > 0) reasons.push(`고객명 약함 (성만 일치)`);
    else if (booking.customer_name) reasons.push(`고객명 불일치 (${booking.customer_name})`);
  }

  if (parsed.date) {
    const s = dateScore(parsed.date, booking.departure_date);
    raw += 0.3 * s;
    weight += 0.3;
    if (s >= 1.0) reasons.push(`출발일 정확`);
    else if (s >= 0.85) reasons.push(`출발일 ±1일`);
    else if (s > 0 && booking.departure_date) {
      reasons.push(`출발일 ±${Math.abs(diffDays(parsed.date, booking.departure_date))}일`);
    }
  }

  if (parsed.operatorAlias) {
    const s = operatorScore(parsed.operatorAlias, booking.land_operator_aliases);
    raw += 0.2 * s;
    weight += 0.2;
    if (s >= 1.0) reasons.push(`랜드사 정확 (${parsed.operatorAlias})`);
    else if (s > 0) reasons.push(`랜드사 부분 매치`);
  }

  if (weight === 0) return { score: 0, reasons };
  return { score: raw / weight, reasons };
}

export function decideBranch(
  parsed: ParsedCommand,
  bookings: { score: number }[],
  similarCustomerCount: number,
): MatchBranch {
  const top = bookings[0];
  const second = bookings[1];

  if (top && top.score >= 0.85 && (!second || second.score < 0.6)) {
    return 'A';
  }

  if (top && top.score >= 0.6) {
    return 'B';
  }

  if ((!top || top.score < 0.3) && parsed.customerName && similarCustomerCount === 0) {
    return 'C';
  }

  return 'D';
}

// ── I/O 함수 ──────────────────────────────────────────────────────────

export async function resolvePaymentCommand(parsed: ParsedCommand): Promise<ResolveResult> {
  const result: ResolveResult = {
    parsed,
    branch: 'D',
    bookings: [],
    operators: [],
    similarCustomers: [],
    warnings: parsed.warnings.slice(),
    learnedRulesApplied: 0,
  };

  if (!parsed.hasAnyToken) {
    result.warnings.push('입력에서 토큰을 찾지 못했습니다');
    return result;
  }

  if (!isSupabaseConfigured) {
    result.warnings.push('Supabase 미설정 — 후보 조회 스킵');
    return result;
  }

  const operatorIdToAliases = new Map<string, string[]>();

  if (parsed.operatorAlias) {
    const { data: opRows } = await supabaseAdmin
      .from('land_operators')
      .select('id, name, aliases')
      .eq('is_active', true);

    for (const row of opRows ?? []) {
      const aliases = (row.aliases as string[] | null) ?? [];
      const score = operatorScore(parsed.operatorAlias, aliases);
      if (score > 0) {
        result.operators.push({ id: row.id, name: row.name, aliases, score });
      }
      operatorIdToAliases.set(row.id, aliases);
    }
    result.operators.sort((a, b) => b.score - a.score);
  }

  let candidateCustomerIds: string[] | null = null;
  if (parsed.customerName && !parsed.bookingId) {
    // pg_trgm fuzzy + ilike 합집합 — 오타("남영선" → "남영순") 케이스 커버.
    // search_similar_customers RPC 가 threshold 0.3 + ilike OR 를 한 쿼리로 처리.
    type CustomerRow = { id: string; name: string; score: number };
    const { data: custRows, error: custErr } = await supabaseAdmin.rpc('search_similar_customers', {
      p_query: parsed.customerName,
      p_limit: 50,
      p_threshold: 0.3,
    });

    if (custErr) {
      // RPC 실패 시 fallback: ilike escape 검색
      const escaped = parsed.customerName.replace(/[\\%_]/g, m => `\\${m}`);
      const { data: fallback } = await supabaseAdmin
        .from('customers')
        .select('id, name')
        .ilike('name', `%${escaped}%`)
        .is('deleted_at', null)
        .limit(50);
      const list = (fallback ?? []) as Array<{ id: string; name: string }>;
      candidateCustomerIds = list.map(r => r.id);
      result.similarCustomers = Array.from(new Set(list.map(r => r.name).filter(Boolean))).slice(0, 5);
      result.warnings.push('fuzzy 검색 실패 → ilike fallback');
    } else {
      const list = (custRows ?? []) as CustomerRow[];
      candidateCustomerIds = list.map(r => r.id);
      result.similarCustomers = Array.from(new Set(list.map(r => r.name).filter(Boolean))).slice(0, 5);
    }
  }

  let bookingsQuery = supabaseAdmin
    .from('bookings')
    .select(
      'id, booking_no, lead_customer_id, departure_date, land_operator_id, total_price, paid_amount, total_paid_out, status, payment_status, customers!lead_customer_id(name), land_operators!land_operator_id(name)',
    )
    .eq('is_deleted', false)
    .order('departure_date', { ascending: false })
    .limit(50);

  if (parsed.bookingId) {
    bookingsQuery = bookingsQuery.eq('booking_no', parsed.bookingId);
  } else {
    if (parsed.date) {
      const d = new Date(`${parsed.date}T00:00:00Z`);
      const start = new Date(d.getTime() - 7 * 86400 * 1000).toISOString().slice(0, 10);
      const end = new Date(d.getTime() + 7 * 86400 * 1000).toISOString().slice(0, 10);
      bookingsQuery = bookingsQuery.gte('departure_date', start).lte('departure_date', end);
    }
    if (candidateCustomerIds !== null) {
      if (candidateCustomerIds.length === 0) {
        result.bookings = [];
        result.branch = decideBranch(parsed, [], result.similarCustomers.length);
        return result;
      }
      bookingsQuery = bookingsQuery.in('lead_customer_id', candidateCustomerIds);
    }
    if (result.operators.length > 0 && !parsed.customerName && !parsed.date) {
      bookingsQuery = bookingsQuery.in(
        'land_operator_id',
        result.operators.map(o => o.id),
      );
    }
  }

  const { data: bookingRows, error } = await bookingsQuery;
  if (error) {
    result.warnings.push(`bookings 조회 실패: ${error.message}`);
    return result;
  }

  // Supabase 임베드 select 는 1:1 FK 라도 객체/배열 둘 다 올 수 있어 normalize
  type EmbedField = { name?: string | null } | { name?: string | null }[] | null | undefined;
  const pickName = (v: EmbedField): string | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0]?.name ?? null;
    return v.name ?? null;
  };

  type BookingRow = {
    id: string;
    booking_no: string;
    lead_customer_id: string | null;
    departure_date: string | null;
    land_operator_id: string | null;
    total_price: number | null;
    paid_amount: number | null;
    total_paid_out: number | null;
    status: string | null;
    payment_status: string | null;
    customers: EmbedField;
    land_operators: EmbedField;
  };

  // 학습 룰 fetch (P5) — 같은 pattern_signature 패턴
  const signature = buildPatternSignature(parsed);
  let learnedRules: LearnedRule[] = [];
  if (parsed.hasAnyToken && signature !== 'EMPTY') {
    const { data: ruleRows } = await supabaseAdmin
      .from('payment_command_rules')
      .select('id, pattern_signature, parsed_operator_alias, resolved_operator_id, learn_count')
      .eq('pattern_signature', signature)
      .gte('learn_count', 3);
    learnedRules = (ruleRows ?? []) as LearnedRule[];
  }

  const scored: BookingHit[] = ((bookingRows ?? []) as BookingRow[]).map(row => {
    const customerName = pickName(row.customers);
    const operatorName = pickName(row.land_operators);
    const aliases = operatorIdToAliases.get(row.land_operator_id ?? '') ?? [];

    const { score, reasons } = scoreBooking(parsed, {
      booking_no: row.booking_no,
      customer_name: customerName,
      departure_date: row.departure_date,
      land_operator_aliases: aliases,
    });

    // 룰 가산 — 같은 (operator_id, alias) 학습 패턴 매치
    const matchingRule = learnedRules.find(r =>
      r.resolved_operator_id === row.land_operator_id &&
      (r.parsed_operator_alias ?? null) === (parsed.operatorAlias ?? null),
    );
    const boosted = applyLearnedRuleBoost(score, matchingRule);
    const finalScore = boosted.score;
    const finalReasons = boosted.reason ? [...reasons, boosted.reason] : reasons;
    if (boosted.reason) result.learnedRulesApplied += 1;

    return {
      id: row.id,
      booking_no: row.booking_no,
      customer_name: customerName,
      departure_date: row.departure_date,
      land_operator_id: row.land_operator_id,
      land_operator_name: operatorName,
      total_price: row.total_price ?? 0,
      paid_amount: row.paid_amount ?? 0,
      total_paid_out: row.total_paid_out ?? 0,
      status: row.status ?? '',
      payment_status: row.payment_status ?? null,
      score: finalScore,
      reasons: finalReasons,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  result.bookings = scored.slice(0, 10);
  result.branch = decideBranch(parsed, result.bookings, result.similarCustomers.length);

  return result;
}
