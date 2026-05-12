/**
 * Brand Voice Archive Helper
 *
 * brand_kits.voice_guide + voice_samples 을 에이전트 프롬프트에 주입.
 * 모든 에이전트가 공통 사용.
 *
 * 사용:
 *   const voiceBlock = await getBrandVoiceBlock('yeosonam', 'instagram_caption');
 *   prompt = voiceBlock + '\n\n## 소재\n...';
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

interface VoiceSample {
  platform: string;
  content: string;
  performance_score?: number;
  captured_at?: string;
  hook_type?: string;                  // PR-4: hook_type별 분류 + retrieval
  design_archetype_id?: string;        // PR-4: archetype 매칭
  palette_category?: string;           // PR-4
}

interface BrandKit {
  voice_guide?: string | null;
  voice_samples?: VoiceSample[] | null;
}

/**
 * brand_kits 에서 voice_guide + platform 일치하는 voice_samples 추출 → prompt block.
 *
 * PR-4: hookType 지정 시 동일 hook_type 샘플 우선 retrieval.
 */
export async function getBrandVoiceBlock(
  brandCode: string,
  platform: string,
  maxSamples: number = 2,
  options?: { hookType?: string; paletteCategory?: string },
): Promise<string> {
  if (!isSupabaseConfigured) return '';

  try {
    const { data } = await supabaseAdmin
      .from('brand_kits')
      .select('voice_guide, voice_samples')
      .eq('code', brandCode)
      .eq('is_active', true)
      .maybeSingle();

    if (!data) return '';
    const kit = data as BrandKit;

    const blocks: string[] = [];

    if (kit.voice_guide && kit.voice_guide.trim().length > 0) {
      blocks.push(`## 브랜드 보이스 가이드\n${kit.voice_guide.trim()}`);
    }

    if (kit.voice_samples && Array.isArray(kit.voice_samples) && kit.voice_samples.length > 0) {
      const all = kit.voice_samples;
      const byScore = (a: VoiceSample, b: VoiceSample) =>
        (b.performance_score ?? 0) - (a.performance_score ?? 0);

      // 우선순위: (1) platform + hook_type 동일 → (2) platform 동일 → (3) hook_type 동일 → (4) 나머지
      // 다양성을 위해 hook_type 동일 N개 + 나머지 hook_type 1개 섞음
      const samePlatformSameHook = options?.hookType
        ? all.filter((s) => s.platform === platform && s.hook_type === options.hookType).sort(byScore)
        : [];
      const samePlatform = all.filter((s) => s.platform === platform &&
        (!options?.hookType || s.hook_type !== options.hookType)).sort(byScore);
      const sameHookOther = options?.hookType
        ? all.filter((s) => s.platform !== platform && s.hook_type === options.hookType).sort(byScore)
        : [];
      const others = all.filter((s) => s.platform !== platform &&
        (!options?.hookType || s.hook_type !== options.hookType)).sort(byScore);

      const ordered = [...samePlatformSameHook, ...samePlatform, ...sameHookOther, ...others];
      const combined = ordered.slice(0, maxSamples);

      if (combined.length > 0) {
        const samplesBlock = combined
          .map((s, i) => {
            const tags = [
              s.platform,
              s.hook_type ? `hook=${s.hook_type}` : '',
              s.palette_category ? `palette=${s.palette_category}` : '',
              s.performance_score ? `성과 ${s.performance_score}` : '',
            ].filter(Boolean).join(' · ');
            return `### 샘플 ${i + 1} [${tags}]\n${s.content}`;
          })
          .join('\n\n');
        blocks.push(`## 브랜드 톤 샘플 (위 가이드에 정렬해 작성)\n${samplesBlock}`);
      }
    }

    return blocks.join('\n\n');
  } catch (err) {
    console.warn('[brand-voice] 조회 실패:', err instanceof Error ? err.message : err);
    return '';
  }
}

/**
 * 새 성공 사례를 voice_samples 에 append (향후 성과 기반 학습 루프).
 */
export async function appendVoiceSample(
  brandCode: string,
  sample: VoiceSample,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const { data } = await supabaseAdmin
      .from('brand_kits')
      .select('id, voice_samples')
      .eq('code', brandCode)
      .single();
    if (!data) return false;

    const current = (data as unknown as { voice_samples: VoiceSample[] }).voice_samples ?? [];
    const newSamples = [...current, sample].slice(-50);  // 최대 50개 유지 (최신 우선)

    await supabaseAdmin
      .from('brand_kits')
      .update({ voice_samples: newSamples })
      .eq('id', (data as unknown as { id: string }).id);

    return true;
  } catch (err) {
    console.warn('[brand-voice] append 실패:', err instanceof Error ? err.message : err);
    return false;
  }
}
