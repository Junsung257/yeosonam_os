/**
 * Content Factory Job 스텝 상태 업데이트 헬퍼.
 * 여러 API 라우트에서 fire-and-forget으로 호출.
 * 실패해도 실제 비즈니스 로직에 영향 없음.
 */
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

type StepKey = 'satori_render' | 'cover_critic' | 'blog_generate' | 'ig_publish' | 'meta_ads';
type StepStatus = 'done' | 'failed' | 'running' | 'queued';

interface JobRow {
  steps: Record<string, unknown>;
  completed_steps: number;
  failed_steps: number;
}

export function updateFactoryJobStep(
  cardNewsId: string,
  step: StepKey,
  status: StepStatus,
  error: string | null = null,
): void {
  if (!isSupabaseConfigured || !cardNewsId) return;

  supabaseAdmin
    .from('content_factory_jobs')
    .select('steps, completed_steps, failed_steps')
    .eq('card_news_id', cardNewsId)
    .maybeSingle()
    .then(async ({ data: jobRow }: { data: JobRow | null }) => {
      if (!jobRow) return;
      const now = new Date().toISOString();
      const steps = { ...(jobRow.steps as Record<string, unknown>) };
      const prev = (steps[step] as Record<string, unknown> | undefined)?.status;
      steps[step] = { status, updated_at: now, error };
      const updates: Record<string, unknown> = { steps };
      if (status === 'done' && prev !== 'done') {
        updates.completed_steps = (jobRow.completed_steps ?? 0) + 1;
      }
      if (status === 'failed' && prev !== 'failed') {
        updates.failed_steps = (jobRow.failed_steps ?? 0) + 1;
      }
      await supabaseAdmin
        .from('content_factory_jobs')
        .update(updates)
        .eq('card_news_id', cardNewsId);
    })
    .catch(() => {});
}
