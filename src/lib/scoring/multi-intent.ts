/**
 * Multi-Intent 추천 합성 (자비스 복합 쿼리용).
 *
 * 사장님 시나리오:
 *   "다낭 5/5 베스트 + 5월말 가성비 추천"
 *   → 두 개의 다른 (date+intent) 쿼리를 하나의 답변으로 통합
 *
 * 사용:
 *   const sections = await runMultiIntent([
 *     { label: '5/5 베스트', destination: '다낭', departure_date: '2026-05-05' },
 *     { label: '5월말 가성비', destination: '다낭', departure_from: '2026-05-25', departure_to: '2026-05-31', intent: 'budget' },
 *   ])
 *   formatAnswer(sections) → 마크다운 답변
 */
import { recommendBestPackages, type RankedPackage } from './recommend';
import { getPolicyById, getActivePolicy } from './policy';
import { supabaseAdmin } from '@/lib/supabase';

export interface IntentQuery {
  /** 사용자 노출용 라벨 (예: "5/5 베스트", "5월말 가성비") */
  label: string;
  destination: string;
  departure_date?: string | null;
  /** 범위 검색 (월말/주간 등) — from~to 사이 가장 비교 풀 큰 날짜 자동 선택 */
  departure_from?: string | null;
  departure_to?: string | null;
  duration_days?: number | null;
  /** policy 매핑 (family/couple/filial/budget/no-option). version으로 lookup */
  intent?: 'family' | 'couple' | 'filial' | 'budget' | 'no-option' | null;
  limit?: number;
}

export interface IntentSection {
  label: string;
  group_key: string;
  group_size: number;
  ranked: RankedPackage[];
  intent_used?: string | null;
  policy_version?: string;
}

const INTENT_TO_VERSION: Record<string, string> = {
  family: 'intent-family',
  couple: 'intent-couple',
  filial: 'intent-filial',
  budget: 'intent-budget',
  'no-option': 'intent-no-option',
};

async function resolveIntentPolicy(intent?: string | null) {
  if (!intent) return undefined;
  const version = INTENT_TO_VERSION[intent];
  if (!version) return undefined;
  const { data } = await supabaseAdmin
    .from('scoring_policies')
    .select('id')
    .eq('version', version)
    .limit(1)
    .single();
  if (!data?.id) return undefined;
  return await getPolicyById(data.id);
}

/** 범위 검색용 — group_size가 가장 큰 날짜 자동 선택 (의미있는 비교 그룹) */
async function pickBestDateInRange(
  destination: string,
  from: string,
  to: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('package_scores')
    .select('departure_date, group_size')
    .like('group_key', `${destination}|%`)
    .gte('departure_date', from)
    .lte('departure_date', to)
    .order('group_size', { ascending: false })
    .order('departure_date', { ascending: true })
    .limit(1);
  return data?.[0]?.departure_date ?? null;
}

export async function runMultiIntent(queries: IntentQuery[]): Promise<IntentSection[]> {
  const sections: IntentSection[] = [];
  const activePolicy = await getActivePolicy();

  for (const q of queries) {
    const policy = (await resolveIntentPolicy(q.intent)) ?? activePolicy;
    let date = q.departure_date ?? null;
    if (!date && q.departure_from && q.departure_to) {
      date = await pickBestDateInRange(q.destination, q.departure_from, q.departure_to);
    }

    const result = await recommendBestPackages({
      destination: q.destination,
      departure_date: date,
      duration_days: q.duration_days ?? null,
      limit: q.limit ?? 3,
      policy,
    });

    sections.push({
      label: q.label,
      group_key: result.group_key,
      group_size: result.group_size,
      ranked: result.ranked,
      intent_used: q.intent ?? null,
      policy_version: result.policy_version,
    });
  }

  return sections;
}

/**
 * 자비스가 사용할 마크다운 합성 (점수 숫자 비공개 정책 준수).
 * "📅 5/5 베스트 — 🥇 / 🥈 / 🥉 ..." 형태.
 */
export function formatMultiIntentAnswer(sections: IntentSection[]): string {
  const out: string[] = [];
  for (const s of sections) {
    out.push(`📅 **${s.label}**`);
    if (s.ranked.length === 0) {
      out.push('   해당 일정에 비교 가능한 패키지가 없어요.');
      out.push('');
      continue;
    }
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < Math.min(3, s.ranked.length); i++) {
      const r = s.ranked[i];
      const why = (r.breakdown.why ?? []).slice(0, 2).join(' · ');
      out.push(`${medals[i]} ${r.title} / ₩${r.list_price.toLocaleString()}`);
      if (why) out.push(`   ${why}`);
    }
    out.push('');
  }
  return out.join('\n').trim();
}
