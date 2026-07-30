import { type NextRequest } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { resolveMetaToken } from '@/lib/meta-token-resolver';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import {
  inspectThreadsToken,
  OPTIONAL_AUTOPILOT_SCOPES,
  REQUIRED_AUTOPILOT_SCOPES,
} from '@/lib/threads-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStore<T>(body: T, init?: ResponseInit) {
  const response = apiResponse(body, init);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseAdminConfigured) {
    return noStore({ error: 'Admin database is not configured' }, { status: 503 });
  }

  try {
    const [
      { data: config, error: configError },
      { data: masterGuard, error: guardError },
      token,
      storedUserId,
    ] = await Promise.all([
      supabaseAdmin
        .from('social_platform_configs')
        .select('enabled, account_id, token_expires_at, daily_post_limit, posts_today')
        .eq('platform', 'threads')
        .maybeSingle(),
      supabaseAdmin
        .from('card_news_publish_guards')
        .select('auto_publish_enabled, anomaly_paused_until')
        .eq('scope_label', 'global')
        .maybeSingle(),
      resolveMetaToken('THREADS_ACCESS_TOKEN'),
      resolveMetaToken('THREADS_USER_ID'),
    ]);
    if (configError) throw configError;
    if (guardError) throw guardError;

    const blockers: string[] = [];
    if (config?.enabled !== true) blockers.push('threads_platform_disabled');
    if (masterGuard?.auto_publish_enabled !== true) blockers.push('global_publish_master_disabled');
    if (
      masterGuard?.anomaly_paused_until &&
      new Date(masterGuard.anomaly_paused_until).getTime() > Date.now()
    ) {
      blockers.push('global_publish_anomaly_paused');
    }
    if (!token) blockers.push('threads_access_token_missing');
    if (!config?.account_id && !storedUserId) blockers.push('threads_user_id_missing');

    const inspection = token ? await inspectThreadsToken(token) : null;
    if (inspection && !inspection.valid) blockers.push('threads_access_token_invalid');
    for (const scope of inspection?.missingRequiredScopes ?? REQUIRED_AUTOPILOT_SCOPES) {
      blockers.push(`missing_scope:${scope}`);
    }
    for (const scope of OPTIONAL_AUTOPILOT_SCOPES) {
      if (inspection?.optionalScopes[scope] !== true) {
        blockers.push(`missing_full_automation_scope:${scope}`);
      }
    }
    if (
      inspection?.userId &&
      config?.account_id &&
      inspection.userId !== config.account_id
    ) {
      blockers.push('threads_account_id_mismatch');
    }

    const expiresAt = inspection?.expiresAt ?? config?.token_expires_at ?? null;
    const expiresInDays = expiresAt
      ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
      : null;
    if (expiresInDays != null && expiresInDays <= 0) blockers.push('threads_access_token_expired');

    return noStore({
      ready: blockers.length === 0,
      blockers: Array.from(new Set(blockers)),
      account: {
        enabled: config?.enabled === true,
        configured_user_id: config?.account_id ?? storedUserId ?? null,
        token_user_id: inspection?.userId ?? null,
        username: inspection?.username ?? null,
      },
      token: {
        present: Boolean(token),
        valid: inspection?.valid ?? false,
        expires_at: expiresAt,
        expires_in_days: expiresInDays,
        scopes: inspection?.scopes ?? [],
        required_scopes: REQUIRED_AUTOPILOT_SCOPES,
        missing_required_scopes:
          inspection?.missingRequiredScopes ?? [...REQUIRED_AUTOPILOT_SCOPES],
        optional_scopes: inspection?.optionalScopes ??
          Object.fromEntries(OPTIONAL_AUTOPILOT_SCOPES.map((scope) => [scope, false])),
        inspection_warning: inspection?.error ?? null,
      },
      automation: {
        global_publish_master_enabled: masterGuard?.auto_publish_enabled === true,
        anomaly_paused_until: masterGuard?.anomaly_paused_until ?? null,
        topic_mining: 'daily',
        threads_content_generation: 'daily',
        content_generation_and_publish: 'every_2_hours',
        scheduled_publish: 'every_15_minutes',
        comment_and_mention_loop: 'every_5_minutes',
        engagement_sync: 'every_30_minutes',
        audit_store: 'agent_actions',
        external_url_fetching_from_comments: false,
      },
      limits: {
        configured_daily_post_limit: config?.daily_post_limit ?? null,
        posts_today: config?.posts_today ?? null,
        replies_per_run: 8,
        replies_per_day: 80,
      },
    });
  } catch (error) {
    console.error('[threads-autopilot-readiness] failed:', sanitizeDbError(error));
    return noStore({ error: 'Threads autopilot readiness check failed' }, { status: 500 });
  }
}
