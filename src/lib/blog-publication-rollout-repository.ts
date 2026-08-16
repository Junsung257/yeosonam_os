import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BlogPublicationRolloutEvaluation,
  BlogPublicationRolloutSignals,
  BlogPublicationRolloutState,
} from './blog-publication-rollout';

export async function loadBlogPublicationRolloutState(
  client: SupabaseClient,
): Promise<{ state: BlogPublicationRolloutState | null; error: string | null }> {
  const { data, error } = await client.from('blog_publication_rollout_state')
    .select('scope,stage,status,healthy_window_streak,unhealthy_window_streak,publications_since_stage_started,state_version,stage_started_at,last_evaluated_at,frozen_at,freeze_reason')
    .eq('scope', 'global')
    .maybeSingle();
  if (error || !data) return { state: null, error: error?.message || 'rollout_state_missing' };
  if (!['pilot_3', 'ramp_10', 'max_30'].includes(String(data.stage))
    || !['active', 'frozen'].includes(String(data.status))) {
    return { state: null, error: 'rollout_state_invalid' };
  }
  return {
    state: {
      scope: 'global',
      stage: data.stage,
      status: data.status,
      healthyWindowStreak: Number(data.healthy_window_streak || 0),
      unhealthyWindowStreak: Number(data.unhealthy_window_streak || 0),
      publicationsSinceStageStarted: Number(data.publications_since_stage_started || 0),
      stateVersion: Number(data.state_version || 0),
      stageStartedAt: String(data.stage_started_at),
      lastEvaluatedAt: typeof data.last_evaluated_at === 'string' ? data.last_evaluated_at : null,
      frozenAt: typeof data.frozen_at === 'string' ? data.frozen_at : null,
      freezeReason: typeof data.freeze_reason === 'string' ? data.freeze_reason : null,
    },
    error: null,
  };
}

export async function persistBlogPublicationRolloutEvaluation(input: {
  client: SupabaseClient;
  state: BlogPublicationRolloutState;
  evaluation: BlogPublicationRolloutEvaluation;
  windowKey: string;
  signals: BlogPublicationRolloutSignals;
  publicationsObserved: number;
}): Promise<{ persisted: boolean; error: string | null }> {
  const { error } = await input.client.rpc('apply_blog_publication_rollout_evaluation_v1', {
    p_scope: input.state.scope,
    p_window_key: input.windowKey,
    p_expected_state_version: input.state.stateVersion,
    p_decision: input.evaluation.decision,
    p_stage_after: input.evaluation.stageAfter,
    p_status_after: input.evaluation.statusAfter,
    p_observation_complete: input.evaluation.observationComplete,
    p_severe_incident: input.evaluation.severeIncident,
    p_healthy_window_streak_after: input.evaluation.healthyWindowStreakAfter,
    p_unhealthy_window_streak_after: input.evaluation.unhealthyWindowStreakAfter,
    p_publications_observed: Math.max(0, Math.trunc(input.publicationsObserved)),
    p_publications_since_stage_started_after: input.evaluation.publicationsSinceStageStartedAfter,
    p_reasons: input.evaluation.reasons,
    p_signals: input.signals,
  });
  return error ? { persisted: false, error: error.message } : { persisted: true, error: null };
}
