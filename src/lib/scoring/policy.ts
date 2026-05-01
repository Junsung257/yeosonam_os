import { supabaseAdmin } from '@/lib/supabase';
import type { ScoringPolicy } from './types';
import { isValidPolicy } from './types';

let cached: { policy: ScoringPolicy; loadedAt: number } | null = null;
const TTL_MS = 60 * 1000;

export async function getActivePolicy(force = false): Promise<ScoringPolicy> {
  const now = Date.now();
  if (!force && cached && now - cached.loadedAt < TTL_MS) return cached.policy;

  const { data, error } = await supabaseAdmin
    .from('scoring_policies')
    .select('*')
    .eq('is_active', true)
    .limit(1);

  if (error) throw new Error(`scoring_policies 로드 실패: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('활성 scoring_policy 없음. 마이그레이션 시드 확인 필요.');
  }
  const raw = data[0];
  if (!isValidPolicy(raw)) {
    throw new Error(`scoring_policy 스키마 오류: id=${(raw as Record<string, unknown>)?.id}`);
  }
  cached = { policy: raw, loadedAt: now };
  return raw;
}

export async function getPolicyById(id: string): Promise<ScoringPolicy> {
  const { data, error } = await supabaseAdmin
    .from('scoring_policies').select('*').eq('id', id).limit(1);
  if (error) throw new Error(`scoring_policies 조회 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`정책 ${id} 없음`);
  const raw = data[0];
  if (!isValidPolicy(raw)) throw new Error(`scoring_policy 스키마 오류: id=${id}`);
  return raw;
}

export function invalidatePolicyCache(): void { cached = null; }
