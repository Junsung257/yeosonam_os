/**
 * Cover Critic 의 rewritten_cover 를 실제 slides[0] 에 덮어쓰는 헬퍼.
 *
 * 사용처:
 *   1. /api/card-news POST 생성 직후 — 자동 Critic → 자동 적용
 *   2. /api/content/cover-critic route — 수동 재검수 시 apply 옵션
 *   3. V2 Studio UI "자동 적용" 버튼
 *
 * 적용 규칙:
 *   - rewritten_cover 의 각 필드가 non-null 이면 slide[0] 동일 필드 덮어씀
 *   - verdict === 'ship_as_is' 면 적용 스킵 (이미 OK)
 *   - critique_log 에 이력 append (최대 5건 유지)
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { CoverCritique } from './agents/cover-critic';

export interface ApplyCritiqueResult {
  applied: boolean;
  reason: string;                 // 'ship_as_is' | 'applied' | 'no_rewrite' | 'error' 등
  changes?: Record<string, { before: unknown; after: unknown }>;
}

export async function applyCritiqueToCover(
  cardNewsId: string,
  critique: CoverCritique,
): Promise<ApplyCritiqueResult> {
  if (!isSupabaseConfigured) {
    return { applied: false, reason: 'db_not_configured' };
  }

  // 1. 카드뉴스 + slides 조회
  const { data: cn, error } = await supabaseAdmin
    .from('card_news')
    .select('id, slides')
    .eq('id', cardNewsId)
    .single();
  if (error || !cn) {
    return { applied: false, reason: 'card_news_not_found' };
  }

  const slides = Array.isArray(cn.slides) ? [...(cn.slides as Array<Record<string, unknown>>)] : [];
  if (slides.length === 0) {
    return { applied: false, reason: 'no_slides' };
  }

  // 2. verdict=ship_as_is 면 적용 불필요
  if (critique.verdict === 'ship_as_is') {
    return { applied: false, reason: 'ship_as_is' };
  }

  const rewritten = critique.rewritten_cover;
  if (!rewritten) {
    return { applied: false, reason: 'no_rewrite' };
  }

  // 3. slide[0] 에 덮어쓰기 (non-null 필드만)
  const cover = { ...slides[0] };
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  const applyField = (key: 'headline' | 'body' | 'eyebrow') => {
    const newValue = rewritten[key];
    if (newValue && newValue.trim().length > 0 && newValue !== cover[key]) {
      changes[key] = { before: cover[key], after: newValue };
      cover[key] = newValue;
    }
  };
  applyField('headline');
  applyField('body');
  applyField('eyebrow');

  if (Object.keys(changes).length === 0) {
    return { applied: false, reason: 'no_diff' };
  }

  slides[0] = cover;

  // 4. DB 업데이트
  try {
    await supabaseAdmin
      .from('card_news')
      .update({ slides, updated_at: new Date().toISOString() })
      .eq('id', cardNewsId);
    return { applied: true, reason: 'applied', changes };
  } catch (err) {
    console.error('[apply-critique] DB update 실패:', err);
    return { applied: false, reason: 'db_update_failed' };
  }
}
