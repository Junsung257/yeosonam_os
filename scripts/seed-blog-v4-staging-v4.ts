import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE_TOPIC = '괌 가족여행에서 투몬과 타무닝 중 숙소 지역을 고르는 판단 기준';
const STAGING_CANARY_TOPIC = '괌 숙소 지역 비교: 투몬과 타무닝을 고르는 기준';
const BASE_SLUG = 'guam-tumon-tamuning-family-hotel-areas';
const DEFAULT_SEED_KEY = 'blog-v4-staging-canary-v1';
const OFFICIAL_SOURCE_URL = 'https://www.visitguam.com/';
const SYSTEM_VERIFIER_ID = '00000000-0000-0000-0000-000000000001';

type SeedMode = 'seed' | 'reset';

function topicForSeedKey(seedKey: string): string {
  const normalized = seedKey.trim();
  if (normalized === DEFAULT_SEED_KEY) return BASE_TOPIC;
  const suffix = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `${STAGING_CANARY_TOPIC} (staging canary ${suffix})`;
}

function stagingCanarySuffix(seedKey: string): string {
  return createHash('sha256').update(seedKey.trim()).digest('hex').slice(0, 8);
}

function expectedSlugForSeedKey(seedKey: string): string {
  const normalized = seedKey.trim();
  if (normalized === DEFAULT_SEED_KEY) return BASE_SLUG;
  return `${BASE_SLUG}-staging-${stagingCanarySuffix(normalized)}`;
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`blog_v4_staging_seed_missing_env:${name}`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nowPlusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function client(): SupabaseClient {
  return createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function readSeedRows(db: SupabaseClient, seedKey: string, topic: string) {
  const result = await db
    .from('blog_topic_queue')
    .select('id,status,attempts,meta,content_creative_id')
    .eq('topic', topic)
    .eq('source', 'user_seed')
    .contains('meta', { blog_v4_staging_seed: seedKey })
    .order('created_at', { ascending: true });
  if (result.error) throw new Error(`blog_v4_staging_seed_queue_read_failed:${result.error.message}`);
  return result.data ?? [];
}

async function readOperations(db: SupabaseClient, queueIds: string[]) {
  if (queueIds.length === 0) return [];
  const result = await db
    .from('blog_content_operations')
    .select('id,queue_id,status,current_stage,completed_at')
    .in('queue_id', queueIds);
  if (result.error) throw new Error(`blog_v4_staging_seed_operation_read_failed:${result.error.message}`);
  return result.data ?? [];
}

async function ensureStagingControlPlane(db: SupabaseClient) {
  // The migration creates the initial rollout row and grants service_role
  // select/update, not insert. Read it first so the staging seed never needs
  // a direct rollout-state insert or a production-like privilege.
  const currentRollout = await db
    .from('blog_publication_rollout_state')
    .select('scope,stage,status,state_version')
    .eq('scope', 'global')
    .maybeSingle();
  if (currentRollout.error || !currentRollout.data) {
    throw new Error(`blog_v4_staging_seed_rollout_state_read_failed:${currentRollout.error?.message || 'missing'}`);
  }
  // The Preview branch accumulates canary audit rows across retries. Promote
  // only the staging rollout state through the audited RPC so the inventory
  // ceiling can admit one fresh canary without touching Production state.
  if (currentRollout.data.stage === 'pilot_3') {
    const releaseCommit = process.env.GITHUB_SHA?.trim().toLowerCase() || '';
    if (!/^[0-9a-f]{40}$/.test(releaseCommit)) {
      throw new Error('blog_v4_staging_seed_rollout_release_commit_missing');
    }
    const seedKey = process.env.BLOG_V4_STAGING_SEED_KEY?.trim() || `run-${process.env.GITHUB_RUN_ID || 'unknown'}`;
    const approvalReference = `staging-canary-inventory-${seedKey}`;
    const evidenceSha256 = createHash('sha256')
      .update(JSON.stringify({ scope: 'global', nextStage: 'ramp_10', seedKey, releaseCommit }))
      .digest('hex');
    const transition = await db.rpc('transition_blog_publication_rollout_stage_v1', {
      p_scope: 'global',
      p_expected_stage: 'pilot_3',
      p_next_stage: 'ramp_10',
      p_expected_state_version: Number(currentRollout.data.state_version),
      p_approval_reference: approvalReference,
      p_approved_inventory_count: 0,
      p_github_run_id: process.env.GITHUB_RUN_ID || seedKey,
      p_release_commit: releaseCommit,
      p_evidence_sha256: evidenceSha256,
      p_operator: process.env.GITHUB_ACTOR || 'blog-v4-staging-autopilot',
    });
    if (transition.error || !Array.isArray(transition.data) || transition.data.length !== 1) {
      throw new Error(`blog_v4_staging_seed_rollout_transition_failed:${transition.error?.message || 'unexpected_result'}`);
    }
  }

  const registry = await db
    .from('blog_information_official_source_registry')
    .upsert({
      hostname: 'visitguam.com',
      source_type: 'official_tourism',
      authority_level: 'official_primary',
      allow_subdomains: true,
      status: 'active',
      reviewed_by: 'blog-v4-staging-autopilot',
      reviewed_at: new Date().toISOString(),
      review_note: 'Staging-only canary source registry entry.',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hostname,source_type' })
    .select('id')
    .maybeSingle();
  if (registry.error) {
    throw new Error(`blog_v4_staging_seed_source_registry_failed:${registry.error.message}`);
  }

  const reputableRegistry = await db
    .from('blog_information_reputable_source_registry')
    .upsert({
      hostname: 'kayak.com',
      source_types: ['reputable_price_source'],
      intents: ['hotel_areas'],
      allow_subdomains: true,
      status: 'active',
      reviewed_by: 'blog-v4-staging-autopilot',
      reviewed_at: new Date().toISOString(),
      review_note: 'Staging canary price source fallback. Direct page must expose named hotel prices.',
      research_urls: ['https://www.kayak.com/Guam-Hotels.98.dc.html'],
      research_destinations: ['괌'],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hostname' })
    .select('id')
    .maybeSingle();
  if (reputableRegistry.error) {
    throw new Error(`blog_v4_staging_reputable_source_registry_failed:${reputableRegistry.error.message}`);
  }
}

async function seed(db: SupabaseClient, seedKey: string, mode: SeedMode) {
  await ensureStagingControlPlane(db);
  const topic = topicForSeedKey(seedKey);
  const now = new Date().toISOString();
  const expiresAt = nowPlusDays(7);
  const existing = await readSeedRows(db, seedKey, topic);
  const queue = existing[0] as Record<string, unknown> | undefined;
  const queueId = typeof queue?.id === 'string' ? queue.id : null;
  const operations = await readOperations(db, queueId ? [queueId] : []);
  const nonTerminal = operations.filter((row) => (
    !['cancelled', 'failed'].includes(String(row.status))
  ));

  if (mode === 'reset' && nonTerminal.length > 0) {
    throw new Error('blog_v4_staging_seed_reset_requires_no_existing_operation');
  }

  const metadata = {
    ...asRecord(queue?.meta),
    blog_v4_staging_seed: seedKey,
    editor_approved_seed: 'true',
    verified_operator_note_id: `blog-v4-staging:${seedKey}`,
    risk_level: 'LOW',
    publication_disposition: 'draft_only',
    official_source_urls: [OFFICIAL_SOURCE_URL],
    expected_slug: expectedSlugForSeedKey(seedKey),
    micro_angle: 'family_lodging_area_choice',
    // The default seed validates the family audience. Retry canaries use the
    // general audience and a distinct slug so they never compete with the
    // already reserved family representative in the Preview branch.
    audience: seedKey.trim() === DEFAULT_SEED_KEY ? '아이 동반 가족 여행자' : 'general',
    locale: 'ko-KR',
    traveler_nationality: '대한민국',
    keywords: seedKey.trim() === DEFAULT_SEED_KEY
      ? ['괌 숙소 지역', '투몬 타무닝 숙소 비교', '괌 가족 호텔']
      : ['괌 숙소 지역', '투몬 타무닝 숙소 비교', '괌 호텔 지역'],
    seeded_at: now,
  };

  let targetQueueId = queueId;
  if (queueId) {
    const update = await db
      .from('blog_topic_queue')
      .update({
        status: 'queued',
        attempts: 0,
        last_error: null,
        priority: 10_000,
        target_publish_at: now,
        meta: metadata,
        updated_at: now,
      })
      .eq('id', queueId)
      .select('id')
      .single();
    if (update.error || !update.data?.id) {
      throw new Error(`blog_v4_staging_seed_queue_update_failed:${update.error?.message || 'missing_id'}`);
    }
    targetQueueId = update.data.id;
  } else {
    const insert = await db
      .from('blog_topic_queue')
      .insert({
        topic,
        // Keep the queue topic unique per canary, but do not pollute the
        // reader keyword with the staging-only suffix. The suffix is an
        // inventory id, not part of the search intent or article title.
        primary_keyword: seedKey.trim() === DEFAULT_SEED_KEY ? BASE_TOPIC : STAGING_CANARY_TOPIC,
        destination: '괌',
        angle_type: '숙소 지역 비교',
        category: '여행정보',
        source: 'user_seed',
        // Keep the explicit canary ahead of historical and previous retry rows;
        // the materializer remains bounded to one workflow start per request.
        priority: 10_000,
        status: 'queued',
        target_publish_at: now,
        keyword_tier: 'longtail',
        meta: metadata,
      })
      .select('id')
      .single();
    if (insert.error || !insert.data?.id) {
      throw new Error(`blog_v4_staging_seed_queue_insert_failed:${insert.error?.message || 'missing_id'}`);
    }
    targetQueueId = insert.data.id;
  }

  const signal = await db
    .from('blog_demand_signals')
    .upsert({
      queue_id: targetQueueId,
      provider: 'editor_seed',
      signal_key: `blog-v4-staging:${seedKey}`,
      signal_value: 1,
      source_reference: `staging://blog-v4/${seedKey}/editor-seed`,
      observed_at: now,
      expires_at: expiresAt,
      verified_by: SYSTEM_VERIFIER_ID,
      verified_at: now,
      metadata: {
        verifier: 'blog-v4-staging-autopilot',
        topic,
        official_source_url: OFFICIAL_SOURCE_URL,
      },
    }, { onConflict: 'provider,signal_key,source_reference' })
    .select('id')
    .single();
  if (signal.error || !signal.data?.id) {
    throw new Error(`blog_v4_staging_seed_signal_upsert_failed:${signal.error?.message || 'missing_id'}`);
  }

  process.stdout.write(JSON.stringify({
    seedKey,
    mode,
    topic,
    queueId: targetQueueId,
    demandSignalId: signal.data.id,
    reusedQueue: Boolean(queueId),
    expiresAt,
  }) + '\n');
}

async function main() {
  const seedKey = argument('seed-key') || process.env.BLOG_V4_STAGING_SEED_KEY?.trim();
  if (!seedKey) throw new Error('blog_v4_staging_seed_missing_seed_key');
  const mode = (argument('mode') || 'seed') as SeedMode;
  if (!['seed', 'reset'].includes(mode)) throw new Error(`blog_v4_staging_seed_invalid_mode:${mode}`);
  await seed(client(), seedKey, mode);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
