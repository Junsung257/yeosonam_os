/**
 * @file region-cache-context.ts — 지역 블록 컨텍스트 조회
 *
 * destination_masters + tour_blocks → DeepSeek 캐시용 stable prefix 반환.
 * tour_blocks 없는 지역은 attractions.long_desc (MRT 재작성본) 로 fallback.
 * 동일 지역 파일 연속 업로드 시 이 prefix가 자동 캐시돼 input 토큰 90% 할인.
 */

import { supabaseAdmin } from '@/lib/supabase';

export async function getRegionCacheContext(destination: string): Promise<string> {
  if (!destination) return '';

  try {
    // 1차: destination_masters + tour_blocks (어셈블러 설정 지역)
    const { data: master } = await supabaseAdmin
      .from('destination_masters')
      .select('id')
      .ilike('name', `%${destination}%`)
      .limit(1)
      .maybeSingle();

    if (master?.id) {
      const { data: blocks } = await supabaseAdmin
        .from('tour_blocks')
        .select('block_name, description, typical_duration_hours')
        .eq('destination_master_id', master.id)
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .limit(20);

      if (blocks?.length) {
        return `\n\n## ${destination} 지역 관광 블록 (표준 데이터 — 일정 매핑 참고용)\n`
          + blocks.map((b: { block_name: string; description: string | null; typical_duration_hours: number | null }) =>
              `- ${b.block_name}${b.typical_duration_hours ? ` (${b.typical_duration_hours}h)` : ''}: ${b.description ?? ''}`
            ).join('\n');
      }
    }

    // 2차 fallback: attractions.long_desc (MRT 시딩 지역 — 어셈블러 미설정)
    const { data: attrs } = await supabaseAdmin
      .from('attractions')
      .select('name, long_desc, typical_duration_hours')
      .ilike('region', `%${destination}%`)
      .not('long_desc', 'is', null)
      .eq('is_active', true)
      .order('mrt_rating', { ascending: false })
      .limit(10);

    if (!attrs?.length) return '';

    return `\n\n## ${destination} 주요 관광지 (MRT 표준 데이터 — 일정 매핑 참고용)\n`
      + attrs.map((a: { name: string; long_desc: string | null; typical_duration_hours: number | null }) =>
          `- ${a.name}${a.typical_duration_hours ? ` (${a.typical_duration_hours}h)` : ''}: ${a.long_desc ?? ''}`
        ).join('\n');
  } catch {
    return '';
  }
}
