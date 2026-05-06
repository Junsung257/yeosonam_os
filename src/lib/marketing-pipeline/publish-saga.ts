/**
 * 멀티플랫폼 발행 Saga (보상 트랜잭션 패턴)
 *
 * 실행 순서: Meta → Blog → Instagram (순차, 의도적)
 * 중간 실패 시 성공한 플랫폼을 병렬로 DRAFT 롤백 후 Slack 알림.
 *
 * 사용법:
 *   await publishWithSaga(contentId, [
 *     { platform: 'meta',      publish: () => postToMeta(content) },
 *     { platform: 'blog',      publish: () => postToBlog(content) },
 *     { platform: 'instagram', publish: () => postToInstagram(content) },
 *   ]);
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

type Platform = 'meta' | 'blog' | 'instagram';

interface PublishStep {
  platform: Platform;
  publish: () => Promise<void>;
}

async function revertToDraft(platform: Platform, contentId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabaseAdmin
    .from('content_distributions')
    .update({ status: 'draft', published_at: null })
    .eq('content_id', contentId)
    .eq('platform', platform);
}

export async function publishWithSaga(
  contentId: string,
  steps: PublishStep[],
): Promise<{ ok: boolean; publishedPlatforms: Platform[]; rolledBack: Platform[]; error?: string }> {
  const publishedPlatforms: Platform[] = [];

  for (const step of steps) {
    try {
      await step.publish();
      publishedPlatforms.push(step.platform);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[publish-saga] ${step.platform} 발행 실패:`, err);

      // 보상: 앞서 성공한 플랫폼을 병렬로 DRAFT 롤백
      const rollbackResults = await Promise.allSettled(
        publishedPlatforms.map((p) => revertToDraft(p, contentId)),
      );
      const rolledBack = publishedPlatforms.filter((_, i) => rollbackResults[i].status === 'fulfilled');
      rollbackResults.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[publish-saga] ${publishedPlatforms[i]} 롤백 실패:`, r.reason);
      });

      const rollbackSummary = rolledBack.length ? `롤백: ${rolledBack.join(', ')}` : '롤백 없음';
      const msg = `contentId=${contentId} | ${step.platform} 실패: ${error} | ${rollbackSummary}`;
      void sendSlackAlert(`발행 Saga 실패: ${msg}`);

      // agent_incidents 기록
      if (isSupabaseConfigured) {
        void supabaseAdmin.from('agent_incidents').insert({
          severity: 'error',
          category: 'publish_saga_failure',
          message: `[publish-saga] ${msg}`,
          details: { contentId, failedPlatform: step.platform, rolledBack, error },
          detected_by: 'publish-saga',
        }).catch(() => null);
      }

      return { ok: false, publishedPlatforms, rolledBack, error };
    }
  }

  return { ok: true, publishedPlatforms, rolledBack: [] };
}
