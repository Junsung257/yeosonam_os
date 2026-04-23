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
}

interface BrandKit {
  voice_guide?: string | null;
  voice_samples?: VoiceSample[] | null;
}

/**
 * brand_kits 에서 voice_guide + platform 일치하는 voice_samples 추출 → prompt block.
 */
export async function getBrandVoiceBlock(
  brandCode: string,
  platform: string,
  maxSamples: number = 2,
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
      // platform 일치하는 샘플 우선, 없으면 전체 중 performance_score 상위
      const relevantSamples = kit.voice_samples
        .filter((s) => s.platform === platform)
        .sort((a, b) => (b.performance_score ?? 0) - (a.performance_score ?? 0))
        .slice(0, maxSamples);

      const fallbackSamples = relevantSamples.length < maxSamples
        ? kit.voice_samples
          .filter((s) => s.platform !== platform)
          .sort((a, b) => (b.performance_score ?? 0) - (a.performance_score ?? 0))
          .slice(0, maxSamples - relevantSamples.length)
        : [];

      const combined = [...relevantSamples, ...fallbackSamples];

      if (combined.length > 0) {
        const samplesBlock = combined
          .map((s, i) => `### 샘플 ${i + 1} [${s.platform}] ${s.performance_score ? `(성과 ${s.performance_score})` : ''}\n${s.content}`)
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
