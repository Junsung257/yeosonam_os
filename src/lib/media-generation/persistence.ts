import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildConceptualMediaPrompt } from './prompts';
import type {
  CodexMediaJobV1,
  MediaAssetManifestV1,
  MediaAssetStatus,
  MediaBriefV1,
  MediaProvider,
  MediaQaReportV1,
  MediaSourceKind,
} from './types';

const MEDIA_BUCKET = process.env.MEDIA_ASSET_BUCKET?.trim() || 'media-assets';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MediaAssetRow = {
  id: string;
  public_url: string | null;
  variants: Record<string, string> | null;
  source_kind: MediaSourceKind;
  provider: MediaProvider;
  model: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  sha256: string | null;
  prompt_version: string;
  brief_digest: string;
  cost_usd: number | string | null;
  disclosure: string | null;
  status: MediaAssetStatus;
  qa_report: MediaQaReportV1 | null;
  superseded_by?: string | null;
};

export type MediaAssetAdminRow = MediaAssetRow & {
  tenant_id: string | null;
  owner_type: string;
  owner_id: string;
  purpose: string;
  asset_class: string;
  storage_bucket: string | null;
  storage_path: string | null;
  source_metadata: Record<string, unknown> | null;
  approval_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  attempt_count: number;
  attempt_day: string | null;
  attempts_on_day: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string | null;
  last_error_code: string | null;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function digestMediaBrief(brief: MediaBriefV1): string {
  return createHash('sha256').update(stableStringify(brief)).digest('hex');
}

export function buildMediaIdempotencyKey(brief: MediaBriefV1, promptVersion: string): string {
  return createHash('sha256')
    .update(`${brief.ownerType}:${brief.ownerId}:${brief.purpose}:${digestMediaBrief(brief)}:${promptVersion}`)
    .digest('hex');
}

function rowToManifest(row: MediaAssetRow): MediaAssetManifestV1 | null {
  if (!row.public_url || !row.sha256 || !row.width || !row.height || !row.mime_type || !row.qa_report) return null;
  return {
    id: row.id,
    url: row.public_url,
    variants: row.variants ?? {},
    sourceKind: row.source_kind,
    provider: row.provider,
    model: row.model,
    width: row.width,
    height: row.height,
    mimeType: row.mime_type,
    sha256: row.sha256,
    promptVersion: row.prompt_version,
    briefDigest: row.brief_digest,
    costUsd: Number(row.cost_usd ?? 0),
    disclosure: row.disclosure,
    status: row.status,
    qa: row.qa_report,
  };
}

export async function findPersistedMediaAsset(idempotencyKey: string): Promise<MediaAssetManifestV1 | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client
    .from('media_assets')
    .select('id, public_url, variants, source_kind, provider, model, width, height, mime_type, sha256, prompt_version, brief_digest, cost_usd, disclosure, status, qa_report, superseded_by')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['pending_review', 'approved', 'superseded'])
    .maybeSingle();
  if (error) {
    if (/media_assets|schema cache|does not exist/i.test(error.message)) return null;
    throw error;
  }
  if (!data) return null;
  const row = data as unknown as MediaAssetRow;
  if (row.status === 'superseded' && row.superseded_by) {
    const replacement = await client.from('media_assets')
      .select('id, public_url, variants, source_kind, provider, model, width, height, mime_type, sha256, prompt_version, brief_digest, cost_usd, disclosure, status, qa_report, superseded_by')
      .eq('id', row.superseded_by)
      .eq('status', 'approved')
      .maybeSingle();
    if (replacement.error) throw replacement.error;
    return replacement.data ? rowToManifest(replacement.data as unknown as MediaAssetRow) : null;
  }
  return rowToManifest(row);
}

export async function getMediaAssetByIdempotencyKey(
  idempotencyKey: string,
): Promise<MediaAssetAdminRow | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client
    .from('media_assets')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) {
    if (/media_assets|schema cache|does not exist/i.test(error.message)) return null;
    throw error;
  }
  return data ? data as unknown as MediaAssetAdminRow : null;
}

export async function createPendingMediaAsset(input: {
  brief: MediaBriefV1;
  promptVersion: string;
  sourceKind: MediaSourceKind;
  provider: MediaProvider;
  model: string | null;
  idempotencyKey: string;
  additionalSourceMetadata?: Record<string, unknown>;
}): Promise<string> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for durable media generation');
  const id = randomUUID();
  const { data, error } = await client.from('media_assets').insert({
    id,
    tenant_id: input.brief.tenantId ?? null,
    owner_type: input.brief.ownerType,
    owner_id: input.brief.ownerId,
    purpose: input.brief.purpose,
    asset_class: input.brief.assetClass,
    source_kind: input.sourceKind,
    provider: input.provider,
    model: input.model,
    prompt_version: input.promptVersion,
    brief_digest: digestMediaBrief(input.brief),
    idempotency_key: input.idempotencyKey,
    source_metadata: {
      brief_version: input.brief.version,
      locale: input.brief.locale,
      aspect_ratio: input.brief.aspectRatio,
      style_preset: input.brief.stylePreset,
      subject: input.brief.subject,
      destination: input.brief.destination ?? null,
      disclosure_required: input.brief.disclosureRequired,
      ...(input.additionalSourceMetadata ?? {}),
    },
    status: 'pending',
  } as never).select('id').single();
  if (error) {
    if (error.code === '23505') {
      const existing = await client.from('media_assets')
        .select('id, status')
        .eq('idempotency_key', input.idempotencyKey)
        .single();
      const existingData = existing.data as unknown as { id?: string; status?: MediaAssetStatus } | null;
      if (!existing.error && existingData?.id) return String(existingData.id);
    }
    throw error;
  }
  const insertedData = data as unknown as { id?: string } | null;
  return String(insertedData?.id ?? id);
}

async function uploadImmutableImage(path: string, bytes: Buffer): Promise<string> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media storage');
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  if (!/^https:\/\//i.test(data.publicUrl)) throw new Error('media storage did not return a public HTTPS URL');
  return data.publicUrl;
}

export async function completeMediaAsset(input: {
  id: string;
  brief: MediaBriefV1;
  sourceKind: MediaSourceKind;
  provider: MediaProvider;
  model: string | null;
  promptVersion: string;
  mainBytes: Buffer;
  ogBytes: Buffer;
  squareBytes: Buffer;
  portraitBytes: Buffer;
  sha256: string;
  ogSha256: string;
  squareSha256: string;
  portraitSha256: string;
  width: number;
  height: number;
  qa: MediaQaReportV1;
  costUsd: number;
  approvalMode: 'automatic' | 'manual';
  usage?: Record<string, unknown> | null;
  sourceMetadata?: Record<string, unknown> | null;
  expectedLeaseOwner?: string;
}): Promise<MediaAssetManifestV1> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media persistence');
  const owner = input.brief.ownerType.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const purpose = input.brief.purpose.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const source = input.sourceKind.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const mainPath = `${source}/${owner}/${purpose}/${input.sha256.slice(0, 2)}/${input.sha256}.webp`;
  const ogPath = `${source}/${owner}/${purpose}/${input.ogSha256.slice(0, 2)}/${input.ogSha256}-og.webp`;
  const squarePath = `${source}/${owner}/${purpose}/${input.squareSha256.slice(0, 2)}/${input.squareSha256}-square.webp`;
  const portraitPath = `${source}/${owner}/${purpose}/${input.portraitSha256.slice(0, 2)}/${input.portraitSha256}-portrait.webp`;
  const [publicUrl, ogUrl, squareUrl, portraitUrl] = await Promise.all([
    uploadImmutableImage(mainPath, input.mainBytes),
    uploadImmutableImage(ogPath, input.ogBytes),
    uploadImmutableImage(squarePath, input.squareBytes),
    uploadImmutableImage(portraitPath, input.portraitBytes),
  ]);
  const status: MediaAssetStatus = input.approvalMode === 'automatic' ? 'approved' : 'pending_review';
  const disclosure = input.sourceKind === 'openai_generated'
    ? 'AI 생성 참고 이미지 · 실제 현장 기록이나 최신 운영 상황의 증거가 아닙니다.'
    : null;
  const row = {
    storage_bucket: MEDIA_BUCKET,
    storage_path: mainPath,
    public_url: publicUrl,
    variants: { og: ogUrl, square: squareUrl, portrait: portraitUrl },
    mime_type: 'image/webp',
    width: input.width,
    height: input.height,
    sha256: input.sha256,
    provider: input.provider,
    model: input.model,
    prompt_version: input.promptVersion,
    brief_digest: digestMediaBrief(input.brief),
    qa_report: input.qa,
    cost_usd: input.costUsd,
    disclosure,
    source_metadata: {
      brief_version: input.brief.version,
      locale: input.brief.locale,
      aspect_ratio: input.brief.aspectRatio,
      style_preset: input.brief.stylePreset,
      subject: input.brief.subject,
      destination: input.brief.destination ?? null,
      disclosure_required: input.brief.disclosureRequired,
      ...(input.sourceMetadata ?? {}),
      usage: input.usage ?? null,
      og_sha256: input.ogSha256,
      square_sha256: input.squareSha256,
      portrait_sha256: input.portraitSha256,
    },
    status,
    approved_at: status === 'approved' ? new Date().toISOString() : null,
    lease_owner: null,
    lease_expires_at: null,
    next_attempt_at: null,
    last_error_code: null,
    updated_at: new Date().toISOString(),
  };
  let updateQuery = client.from('media_assets')
    .update(row as never)
    .eq('id', input.id);
  if (input.expectedLeaseOwner) {
    updateQuery = updateQuery
      .eq('status', 'generating')
      .eq('lease_owner', input.expectedLeaseOwner);
  }
  const { data, error } = await updateQuery
    .select('id, public_url, variants, source_kind, provider, model, width, height, mime_type, sha256, prompt_version, brief_digest, cost_usd, disclosure, status, qa_report')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('media job lease is no longer valid');
  const manifest = rowToManifest(data as unknown as MediaAssetRow);
  if (!manifest) throw new Error('completed media asset could not be converted to a manifest');
  return manifest;
}

export async function failMediaAsset(id: string, error: unknown): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  const message = error instanceof Error ? error.message : String(error);
  await client.from('media_assets').update({
    status: 'failed',
    qa_report: {
      version: 'media-qa-v1',
      passed: false,
      checks: {
        decoded: false,
        allowedMime: false,
        minimumDimensions: false,
        maximumBytes: false,
        expectedAspectRatio: false,
      },
      issues: [message.slice(0, 240)],
    },
    updated_at: new Date().toISOString(),
  } as never).eq('id', id);
}

function kstDay(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export async function readCodexDailyUsage(now = new Date()): Promise<{ attempts: number; limit: number }> {
  const client = getSupabaseAdmin();
  const limit = boundedInteger(process.env.MEDIA_CODEX_DAILY_LIMIT, 6, 1, 30);
  if (!client) return { attempts: 0, limit };
  const { data, error } = await client.from('media_assets')
    .select('attempts_on_day')
    .eq('provider', 'codex_builtin')
    .eq('attempt_day', kstDay(now));
  if (error) throw error;
  const rows = (data ?? []) as Array<{ attempts_on_day?: number | null }>;
  return {
    attempts: rows.reduce((sum, row) => sum + Number(row.attempts_on_day ?? 0), 0),
    limit,
  };
}

const OWNER_TYPES = new Set<MediaBriefV1['ownerType']>(['blog', 'home', 'package', 'card_news', 'marketing']);
const PURPOSES = new Set<MediaBriefV1['purpose']>([
  'blog_cover',
  'blog_inline_summary',
  'blog_inline_cta',
  'home_campaign_hero',
  'card_news_background',
  'social_og',
  'brand_fallback',
]);
const STYLE_PRESETS = new Set<MediaBriefV1['stylePreset']>([
  'yeosonam_editorial',
  'yeosonam_campaign',
  'yeosonam_information',
]);
const ASPECT_RATIOS = new Set<MediaBriefV1['aspectRatio']>(['16:9', '1:1', '4:5', '9:16', '1.91:1']);

export function mediaBriefFromAssetRow(row: MediaAssetAdminRow): MediaBriefV1 {
  const metadata = row.source_metadata ?? {};
  const ownerType = row.owner_type as MediaBriefV1['ownerType'];
  const purpose = row.purpose as MediaBriefV1['purpose'];
  const stylePreset = metadata.style_preset as MediaBriefV1['stylePreset'];
  const aspectRatio = metadata.aspect_ratio as MediaBriefV1['aspectRatio'];
  const subject = typeof metadata.subject === 'string' ? metadata.subject.trim() : '';
  if (
    !OWNER_TYPES.has(ownerType)
    || !PURPOSES.has(purpose)
    || !STYLE_PRESETS.has(stylePreset)
    || !ASPECT_RATIOS.has(aspectRatio)
    || subject.length < 4
  ) {
    throw new Error('media job brief is incomplete');
  }
  const factualConstraints = Array.isArray(metadata.factual_constraints)
    ? metadata.factual_constraints.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : [];
  return {
    version: 'media-brief-v1',
    tenantId: row.tenant_id,
    ownerType,
    ownerId: row.owner_id,
    purpose,
    assetClass: 'conceptual_allowed',
    locale: 'ko-KR',
    subject,
    destination: typeof metadata.destination === 'string' ? metadata.destination : null,
    factualConstraints,
    stylePreset,
    aspectRatio,
    disclosureRequired: true,
  };
}

async function recoverExpiredCodexLeases(nowIso: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  await client.from('media_assets').update({
    status: 'pending',
    lease_owner: null,
    lease_expires_at: null,
    next_attempt_at: nowIso,
    last_error_code: 'lease_expired',
    updated_at: nowIso,
  } as never)
    .eq('provider', 'codex_builtin')
    .eq('status', 'generating')
    .lt('lease_expires_at', nowIso)
    .lt('attempt_count', 2);
  await client.from('media_assets').update({
    status: 'failed',
    lease_owner: null,
    lease_expires_at: null,
    last_error_code: 'lease_retry_exhausted',
    updated_at: nowIso,
  } as never)
    .eq('provider', 'codex_builtin')
    .eq('status', 'generating')
    .lt('lease_expires_at', nowIso)
    .gte('attempt_count', 2);
}

export async function claimNextCodexMediaJob(workerRunId: string): Promise<CodexMediaJobV1 | null> {
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(workerRunId)) throw new Error('invalid worker run id');
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media jobs');
  const now = new Date();
  const nowIso = now.toISOString();
  await recoverExpiredCodexLeases(nowIso);
  const usage = await readCodexDailyUsage(now);
  if (usage.attempts >= usage.limit) return null;
  const today = kstDay(now);
  const leaseMinutes = boundedInteger(process.env.MEDIA_CODEX_JOB_LEASE_MINUTES, 30, 5, 90);
  const leaseExpiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  const { data, error } = await client.rpc('claim_codex_media_job_v1' as never, {
    p_worker_run_id: workerRunId,
    p_now: nowIso,
    p_attempt_day: today,
    p_lease_expires_at: leaseExpiresAt,
    p_daily_limit: usage.limit,
  } as never);
  if (error) throw error;
  const claimed = Array.isArray(data) ? data[0] : data;
  if (!claimed) return null;
  const claimedRow = claimed as unknown as MediaAssetAdminRow;
  const brief = mediaBriefFromAssetRow(claimedRow);
  return {
    id: claimedRow.id,
    workerRunId,
    prompt: buildConceptualMediaPrompt(brief),
    purpose: brief.purpose,
    ownerType: brief.ownerType,
    ownerId: brief.ownerId,
    aspectRatio: brief.aspectRatio,
    subject: brief.subject,
    destination: brief.destination ?? null,
    attemptCount: claimedRow.attempt_count,
    leaseExpiresAt: claimedRow.lease_expires_at ?? leaseExpiresAt,
  };
}

export async function getLatestApprovedMediaAsset(input: {
  ownerType: MediaBriefV1['ownerType'];
  purpose: MediaBriefV1['purpose'];
  ownerId?: string;
}): Promise<MediaAssetManifestV1 | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  let query = client.from('media_assets')
    .select('id, public_url, variants, source_kind, provider, model, width, height, mime_type, sha256, prompt_version, brief_digest, cost_usd, disclosure, status, qa_report')
    .eq('owner_type', input.ownerType)
    .eq('purpose', input.purpose)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(1);
  if (input.ownerId) query = query.eq('owner_id', input.ownerId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (/media_assets|schema cache|does not exist/i.test(error.message)) return null;
    throw error;
  }
  return data ? rowToManifest(data as unknown as MediaAssetRow) : null;
}

export async function listMediaAssets(input: {
  status?: MediaAssetStatus;
  purpose?: MediaBriefV1['purpose'];
  limit?: number;
} = {}): Promise<MediaAssetAdminRow[]> {
  const client = getSupabaseAdmin();
  if (!client) return [];
  let query = client.from('media_assets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(200, input.limit ?? 100)));
  if (input.status) query = query.eq('status', input.status);
  if (input.purpose) query = query.eq('purpose', input.purpose);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as MediaAssetAdminRow[];
}

export async function reviewMediaAsset(input: {
  id: string;
  decision: 'approved' | 'rejected';
  actor: string;
  note?: string | null;
}): Promise<MediaAssetAdminRow> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media review');
  const existing = await getMediaAssetById(input.id);
  if (!existing) throw new Error('media asset not found');
  if (input.decision === 'approved' && (!existing.public_url || !existing.qa_report?.passed)) {
    throw new Error('only persisted media that passed QA can be approved');
  }
  const now = new Date().toISOString();
  const { data, error } = await client.from('media_assets').update({
    status: input.decision,
    approval_note: input.note?.trim().slice(0, 500) || null,
    approved_by: input.actor,
    approved_at: input.decision === 'approved' ? now : null,
    updated_at: now,
  } as never)
    .eq('id', input.id)
    .in('status', ['pending_review', 'approved', 'rejected'])
    .select('*')
    .single();
  if (error) throw error;
  const reviewed = data as unknown as MediaAssetAdminRow;
  const regenerationOf = existing.source_metadata?.regeneration_of;
  if (
    input.decision === 'approved'
    && typeof regenerationOf === 'string'
    && UUID_RE.test(regenerationOf)
  ) {
    await supersedeMediaAsset({ id: regenerationOf, supersededBy: input.id, actor: input.actor });
  }
  return reviewed;
}

export async function getMediaAssetById(id: string): Promise<MediaAssetAdminRow | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client.from('media_assets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? data as unknown as MediaAssetAdminRow : null;
}

export async function supersedeMediaAsset(input: {
  id: string;
  supersededBy: string;
  actor: string;
}): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media supersession');
  const existing = await getMediaAssetById(input.id);
  if (!existing) throw new Error('media asset not found');
  const { error } = await client.from('media_assets').update({
    status: 'superseded',
    superseded_by: input.supersededBy,
    source_metadata: {
      ...(existing.source_metadata ?? {}),
      regeneration_count: 1,
      superseded_by: input.supersededBy,
      superseded_by_actor: input.actor,
    },
    updated_at: new Date().toISOString(),
  } as never).eq('id', input.id);
  if (error) throw error;
}

export async function markMediaAssetRegenerationRequested(input: {
  id: string;
  regenerationId: string;
  actor: string;
}): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media regeneration');
  const existing = await getMediaAssetById(input.id);
  if (!existing) throw new Error('media asset not found');
  if (Number(existing.source_metadata?.regeneration_count ?? 0) >= 1) {
    throw new Error('media asset regeneration limit reached');
  }
  const { error } = await client.from('media_assets').update({
    source_metadata: {
      ...(existing.source_metadata ?? {}),
      regeneration_count: 1,
      regeneration_candidate_id: input.regenerationId,
      regeneration_requested_by: input.actor,
    },
    updated_at: new Date().toISOString(),
  } as never).eq('id', input.id);
  if (error) throw error;
}
