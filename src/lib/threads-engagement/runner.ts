import { readBoundedIntEnv } from '@/lib/env-utils';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { getThreadsConfig } from '@/lib/threads-publisher';
import {
  findUnansweredReplies,
  ThreadsApiError,
  ThreadsEngagementClient,
} from './client';
import {
  classifyThreadsInboxItem,
  redactThreadsPersonalData,
  validateGeneratedThreadsReply,
} from './policy';
import { generateThreadsReply } from './reply-generator';
import type {
  ThreadsInboxItem,
  ThreadsPolicyResult,
  ThreadsRunSummary,
} from './types';

const MAX_POSTS_PER_RUN = readBoundedIntEnv('THREADS_AUTOREPLY_SCAN_POSTS', 20, 1, 40);
const MAX_ITEMS_PER_RUN = readBoundedIntEnv('THREADS_AUTOREPLY_MAX_PER_RUN', 8, 1, 20);
const MAX_ITEMS_PER_DAY = readBoundedIntEnv('THREADS_AUTOREPLY_MAX_PER_DAY', 80, 1, 500);
const ACTION_TYPE = 'threads_auto_reply';
const REVIEW_ACTION_TYPE = 'threads_reply_review';

interface SocialConfigRow {
  enabled: boolean | null;
  account_id: string | null;
}

function startOfKstDayIso(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

function safeError(error: unknown): string {
  return sanitizeDbError(error, 'Threads engagement operation failed').slice(0, 500);
}

async function claimInboxItem(
  item: ThreadsInboxItem,
  policy: ThreadsPolicyResult,
): Promise<{ id: string; runnable: boolean } | null> {
  const idempotencyKey = `threads_engagement:${item.id}`;
  const status =
    policy.decision === 'reply'
      ? 'executing'
      : policy.decision === 'escalate'
        ? 'pending'
        : 'rejected';
  const actionType = policy.decision === 'escalate' ? REVIEW_ACTION_TYPE : ACTION_TYPE;
  const leaseUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const auditPayload = {
    platform: 'threads',
    source_kind: item.kind,
    source_id: item.id,
    source_username: item.username.slice(0, 120),
    source_text: redactThreadsPersonalData(item.text),
    source_timestamp: item.timestamp || null,
    source_permalink: item.permalink ?? null,
    root_post_id: item.rootPostId ?? null,
    root_post_text: item.rootPostText
      ? redactThreadsPersonalData(item.rootPostText)
      : null,
    policy_decision: policy.decision,
    policy_reason: policy.reason,
    attempt_count: 1,
  };
  const { data, error } = await supabaseAdmin
    .from('agent_actions')
    .insert({
      agent_type: 'marketing',
      action_type: actionType,
      summary:
        policy.decision === 'reply'
          ? `Threads ${item.kind} 자동 답변`
          : `Threads ${item.kind} ${policy.decision === 'escalate' ? '운영 확인 필요' : '자동 제외'}`,
      payload: auditPayload,
      status,
      priority: policy.decision === 'escalate' ? 'high' : 'normal',
      requested_by: 'threads-engagement-cron',
      idempotency_key: idempotencyKey,
      reject_reason: policy.decision === 'skip' ? policy.reason : null,
      resolved_at: policy.decision === 'skip' ? new Date().toISOString() : null,
      expires_at: policy.decision === 'reply' ? leaseUntil : null,
    } as never)
    .select('id')
    .maybeSingle();

  if (!error) {
    if (!data?.id) return null;
    return { id: data.id, runnable: policy.decision === 'reply' };
  }
  if ((error as { code?: string }).code !== '23505' || policy.decision !== 'reply') {
    if ((error as { code?: string }).code === '23505') return null;
    throw error;
  }

  // A transient provider failure or an expired execution lease may be retried,
  // but only while the fresh inbox scan still shows the item as unanswered.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('agent_actions')
    .select('id, status, expires_at, created_at, payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing?.id) return null;

  const leaseExpired =
    existing.status === 'executing' &&
    (existing.expires_at
      ? new Date(existing.expires_at).getTime() <= Date.now()
      : new Date(existing.created_at).getTime() <= Date.now() - 15 * 60 * 1000);
  if (existing.status !== 'failed' && !leaseExpired) return null;

  const currentPayload =
    existing.payload && typeof existing.payload === 'object' && !Array.isArray(existing.payload)
      ? existing.payload as Record<string, unknown>
      : {};
  const attemptCount = Number(currentPayload.attempt_count ?? 1) + 1;
  if (attemptCount > 3) return null;

  let retry = supabaseAdmin
    .from('agent_actions')
    .update({
      status: 'executing',
      payload: { ...auditPayload, attempt_count: attemptCount },
      result_log: null,
      reject_reason: null,
      resolved_at: null,
      expires_at: leaseUntil,
    } as never)
    .eq('id', existing.id)
    .eq('status', existing.status);
  if (existing.status === 'executing') {
    retry = existing.expires_at
      ? retry.lte('expires_at', new Date().toISOString())
      : retry.lte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());
  }
  const { data: retried, error: retryError } = await retry.select('id').maybeSingle();
  if (retryError) throw retryError;
  return retried?.id ? { id: retried.id, runnable: true } : null;
}

async function updateAction(
  id: string,
  patch: {
    status: 'executed' | 'failed' | 'pending';
    result?: Record<string, unknown>;
    error?: string;
    payload?: Record<string, unknown>;
    actionType?: typeof ACTION_TYPE | typeof REVIEW_ACTION_TYPE;
  },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_actions')
    .update({
      status: patch.status,
      result_log: JSON.stringify(
        patch.error ? { success: false, error: patch.error } : { success: true, ...patch.result },
      ),
      reject_reason: patch.error ?? null,
      resolved_at: patch.status === 'pending' ? null : new Date().toISOString(),
      expires_at: null,
      ...(patch.actionType ? { action_type: patch.actionType } : {}),
      ...(patch.payload ? { payload: patch.payload } : {}),
    } as never)
    .eq('id', id);
  if (error) throw error;
}

async function loadAccountEnabled(): Promise<SocialConfigRow | null> {
  const { data, error } = await supabaseAdmin
    .from('social_platform_configs')
    .select('enabled, account_id')
    .eq('platform', 'threads')
    .maybeSingle();
  if (error) throw error;
  return data as SocialConfigRow | null;
}

async function remainingDailyCapacity(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('agent_actions')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', ACTION_TYPE)
    .eq('status', 'executed')
    .gte('created_at', startOfKstDayIso());
  if (error) throw error;
  return Math.max(0, MAX_ITEMS_PER_DAY - (count ?? 0));
}

function defaultSummary(): ThreadsRunSummary {
  return {
    ok: true,
    configured: false,
    accountEnabled: false,
    scannedPosts: 0,
    discoveredReplies: 0,
    discoveredMentions: 0,
    claimed: 0,
    published: 0,
    escalated: 0,
    skipped: 0,
    failed: 0,
    mentionsAvailable: true,
    errors: [],
  };
}

export async function runThreadsEngagement(): Promise<ThreadsRunSummary> {
  const summary = defaultSummary();
  if (!isSupabaseAdminConfigured) {
    summary.ok = false;
    summary.errors.push('admin_database_not_configured');
    return summary;
  }

  try {
    const accountConfig = await loadAccountEnabled();
    summary.accountEnabled = accountConfig?.enabled === true;
    if (!summary.accountEnabled) return summary;

    const credentials = await getThreadsConfig();
    summary.configured = credentials != null;
    if (!credentials) {
      summary.ok = false;
      summary.errors.push('threads_credentials_missing');
      return summary;
    }
    const remainingToday = await remainingDailyCapacity();
    if (remainingToday === 0) {
      summary.errors.push('daily_reply_limit_reached');
      return summary;
    }

    const client = new ThreadsEngagementClient({
      accessToken: credentials.accessToken,
      userId: accountConfig?.account_id || credentials.threadsUserId,
    });
    const profile = await client.getProfile();
    const posts = await client.fetchRecentPosts(MAX_POSTS_PER_RUN);
    summary.scannedPosts = posts.length;

    const inbox: ThreadsInboxItem[] = [];
    let successfulConversationScans = 0;
    for (const post of posts) {
      try {
        const conversation = await client.fetchConversation(post.id);
        successfulConversationScans += 1;
        inbox.push(...findUnansweredReplies(post, conversation, profile.username));
      } catch (error) {
        summary.errors.push(`conversation:${post.id}:${safeError(error)}`);
      }
    }
    if (posts.length > 0 && successfulConversationScans === 0) {
      summary.ok = false;
    }
    summary.discoveredReplies = inbox.length;

    try {
      const mentions = await client.fetchMentions(100);
      for (const mention of mentions) {
        if (!(await client.isDirectlyAnsweredByMe(mention.id, profile.username))) {
          inbox.push(mention);
        }
      }
      summary.discoveredMentions = mentions.length;
    } catch (error) {
      if (
        error instanceof ThreadsApiError &&
        (error.status === 400 || error.status === 403 || error.code === 10 || error.code === 200)
      ) {
        summary.mentionsAvailable = false;
      } else {
        summary.errors.push(`mentions:${safeError(error)}`);
      }
    }

    inbox.sort((a, b) => Date.parse(b.timestamp || '0') - Date.parse(a.timestamp || '0'));
    const uniqueInbox = Array.from(new Map(inbox.map((item) => [item.id, item])).values());

    const maxClaimsThisRun = Math.min(MAX_ITEMS_PER_RUN, remainingToday);
    for (const item of uniqueInbox) {
      // Already-processed newest replies must not starve older unanswered
      // items. Only a newly claimed action consumes this run's work budget.
      if (summary.claimed >= maxClaimsThisRun) break;
      const policy = classifyThreadsInboxItem(item, profile.username);
      let claim: { id: string; runnable: boolean } | null;
      try {
        claim = await claimInboxItem(item, policy);
      } catch (error) {
        summary.failed += 1;
        summary.errors.push(`claim:${item.id}:${safeError(error)}`);
        continue;
      }
      if (!claim) continue;
      summary.claimed += 1;
      if (policy.decision === 'skip') {
        summary.skipped += 1;
        continue;
      }
      if (policy.decision === 'escalate' || !claim.runnable) {
        summary.escalated += 1;
        continue;
      }

      try {
        const generated = await generateThreadsReply(item, policy);
        const validationError = validateGeneratedThreadsReply(generated.text);
        if (validationError) {
          await updateAction(claim.id, {
            status: 'pending',
            error: `generated_reply_blocked:${validationError}`,
            actionType: REVIEW_ACTION_TYPE,
          });
          summary.escalated += 1;
          continue;
        }

        const provider = await client.publishReply(generated.text, item.id);
        await updateAction(claim.id, {
          status: 'executed',
          result: {
            provider_id: provider.id,
            permalink: provider.permalink ?? null,
            reply_text: generated.text,
            generation_source: generated.source,
            model: generated.model ?? null,
          },
        });
        summary.published += 1;
      } catch (error) {
        const message = safeError(error);
        try {
          await updateAction(claim.id, { status: 'failed', error: message });
        } catch (updateError) {
          summary.errors.push(`audit:${item.id}:${safeError(updateError)}`);
        }
        summary.failed += 1;
        summary.errors.push(`publish:${item.id}:${message}`);
      }
    }
  } catch (error) {
    summary.ok = false;
    summary.errors.push(safeError(error));
  }

  summary.ok = summary.ok && summary.failed === 0 && !summary.errors.some((value) =>
    value.startsWith('threads_credentials_missing'),
  );
  return summary;
}
