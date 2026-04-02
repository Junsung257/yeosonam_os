/**
 * ══════════════════════════════════════════════════════════
 * Get Winning Patterns — 승리 패턴 조회
 * ══════════════════════════════════════════════════════════
 * 신규 소재 생성 시 과거 성과 데이터에서 훅 타입 우선순위 결정
 */

export interface WinningPatternRow {
  id: string;
  destination_type: string;
  channel: string;
  target_segment: string;
  hook_type: string;
  creative_type: string;
  avg_ctr: number;
  avg_conv_rate: number;
  avg_roas: number;
  total_spend: number;
  sample_count: number;
  confidence_score: number;
  best_headline: string | null;
  best_body: string | null;
  best_hook_example: string | null;
}

interface GetPatternsParams {
  destinationType: string;
  channel: string;
  creativeType: string;
  targetSegment?: string;
}

export async function getWinningPatterns(params: GetPatternsParams): Promise<WinningPatternRow[]> {
  const { supabaseAdmin } = await import('@/lib/supabase');

  let query = supabaseAdmin
    .from('winning_patterns')
    .select('*')
    .eq('destination_type', params.destinationType)
    .eq('channel', params.channel)
    .eq('creative_type', params.creativeType)
    .gt('confidence_score', 0.2)
    .order('avg_ctr', { ascending: false })
    .limit(5);

  if (params.targetSegment) {
    query = query.eq('target_segment', params.targetSegment);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[getWinningPatterns] 조회 실패:', error.message);
    return [];
  }

  return (data ?? []) as WinningPatternRow[];
}
