import { enqueueBlogIndexingJob } from '@/lib/blog-indexing-outbox';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizeAndInspectMediaImage } from './image-quality';
import {
  completeMediaAsset,
  getMediaAssetById,
  mediaBriefFromAssetRow,
  type MediaAssetAdminRow,
} from './persistence';
import type { MediaAssetManifestV1 } from './types';

const RETRYABLE_CODES = new Set([
  'imagegen_unavailable',
  'builtin_imagegen_unavailable',
  'usage_exhausted',
  'subscription_limit',
  'generation_timeout',
  'generation_failed',
  'artifact_missing',
  'visual_policy_failed',
  'worker_interrupted',
  'upload_failed',
]);

function assertLease(row: MediaAssetAdminRow, workerRunId: string): void {
  if (row.provider !== 'codex_builtin' || row.status !== 'generating') {
    throw new Error('media job is not generating');
  }
  if (row.lease_owner !== workerRunId) throw new Error('media job lease owner mismatch');
  if (!row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= Date.now()) {
    throw new Error('media job lease expired');
  }
}

export function isManagedBlogFallback(url: string | null, expectedFallback: unknown): boolean {
  if (!url) return true;
  if (typeof expectedFallback === 'string' && expectedFallback === url) return true;
  return /\/og-image\.png(?:[?#].*)?$/i.test(url)
    || /\/media-assets\/code_rendered\/blog\/(?:brand_fallback|blog_cover)\//i.test(url);
}

async function attachApprovedBlogCover(
  row: MediaAssetAdminRow,
  manifest: MediaAssetManifestV1,
): Promise<{ attached: boolean; reason: string }> {
  if (
    row.owner_type !== 'blog'
    || row.purpose !== 'blog_cover'
    || row.source_metadata?.auto_attach !== true
    || manifest.status !== 'approved'
  ) {
    return { attached: false, reason: 'manual_or_non_blog_asset' };
  }
  const client = getSupabaseAdmin();
  if (!client) return { attached: false, reason: 'supabase_unavailable' };
  const { data, error } = await client.from('content_creatives')
    .select('id, slug, destination, status, channel, og_image_url, generation_meta')
    .eq('id', row.owner_id)
    .maybeSingle();
  if (error) throw error;
  const creative = data as unknown as {
    id: string;
    slug: string | null;
    destination: string | null;
    status: string | null;
    channel: string | null;
    og_image_url: string | null;
    generation_meta: Record<string, unknown> | null;
  } | null;
  if (!creative || creative.status !== 'published' || creative.channel !== 'naver_blog') {
    return { attached: false, reason: 'creative_not_public' };
  }
  if (!isManagedBlogFallback(creative.og_image_url, row.source_metadata?.fallback_url)) {
    return { attached: false, reason: 'existing_non_managed_cover' };
  }
  const coverUrl = manifest.variants.og || manifest.url;
  const generationMeta = {
    ...(creative.generation_meta ?? {}),
    media_cover: {
      asset_id: manifest.id,
      provider: 'codex_builtin',
      billing_surface: 'chatgpt_subscription',
      prompt_version: manifest.promptVersion,
      attached_at: new Date().toISOString(),
    },
  };
  let update = client.from('content_creatives').update({
    og_image_url: coverUrl,
    generation_meta: generationMeta,
    updated_at: new Date().toISOString(),
  } as never)
    .eq('id', creative.id)
    .eq('status', 'published');
  update = creative.og_image_url
    ? update.eq('og_image_url', creative.og_image_url)
    : update.is('og_image_url', null);
  const { data: updated, error: updateError } = await update.select('id').maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return { attached: false, reason: 'cover_changed_concurrently' };
  revalidatePublicBlogCache(creative.slug, creative.destination);
  if (creative.slug) {
    await enqueueBlogIndexingJob({
      slug: creative.slug,
      contentCreativeId: creative.id,
      source: 'codex_media_cover_attached',
    });
  }
  return { attached: true, reason: 'attached' };
}

export async function completeCodexMediaJob(input: {
  id: string;
  workerRunId: string;
  workerVisualQaPassed: boolean;
  imageBytes: Buffer;
}): Promise<{ asset: MediaAssetManifestV1; attachment: { attached: boolean; reason: string } }> {
  if (!input.workerVisualQaPassed) throw new Error('worker visual QA pass is required');
  const row = await getMediaAssetById(input.id);
  if (!row) throw new Error('media job not found');
  assertLease(row, input.workerRunId);
  const brief = mediaBriefFromAssetRow(row);
  const normalized = await normalizeAndInspectMediaImage(input.imageBytes);
  const approvalMode = row.source_metadata?.approval_mode === 'automatic' ? 'automatic' : 'manual';
  const asset = await completeMediaAsset({
    id: row.id,
    brief,
    sourceKind: 'openai_generated',
    provider: 'codex_builtin',
    model: 'chatgpt-imagegen-builtin',
    promptVersion: row.prompt_version,
    mainBytes: normalized.bytes,
    ogBytes: normalized.ogBytes,
    squareBytes: normalized.squareBytes,
    portraitBytes: normalized.portraitBytes,
    sha256: normalized.sha256,
    ogSha256: normalized.ogSha256,
    squareSha256: normalized.squareSha256,
    portraitSha256: normalized.portraitSha256,
    width: normalized.width,
    height: normalized.height,
    qa: normalized.qa,
    costUsd: 0,
    approvalMode,
    expectedLeaseOwner: input.workerRunId,
    sourceMetadata: {
      ...(row.source_metadata ?? {}),
      worker_run_id: input.workerRunId,
      worker_visual_qa: {
        passed: true,
        policy: 'codex-worker-visual-qa-v1',
      },
      completed_at: new Date().toISOString(),
    },
  });
  const attachment = await attachApprovedBlogCover(row, asset);
  return { asset, attachment };
}

export async function failCodexMediaJob(input: {
  id: string;
  workerRunId: string;
  errorCode: string;
}): Promise<{ status: 'pending' | 'failed'; retryable: boolean }> {
  const row = await getMediaAssetById(input.id);
  if (!row) throw new Error('media job not found');
  assertLease(row, input.workerRunId);
  const errorCode = input.errorCode.replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 80);
  const retryable = RETRYABLE_CODES.has(errorCode) && row.attempt_count < 2;
  const status = retryable ? 'pending' : 'failed';
  const nextAttemptAt = retryable ? new Date(Date.now() + 30 * 60_000).toISOString() : null;
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase admin client is required for media jobs');
  const { data, error } = await client.from('media_assets').update({
    status,
    lease_owner: null,
    lease_expires_at: null,
    next_attempt_at: nextAttemptAt,
    last_error_code: errorCode || 'worker_failed',
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
      issues: [errorCode || 'worker_failed'],
    },
    updated_at: new Date().toISOString(),
  } as never)
    .eq('id', row.id)
    .eq('status', 'generating')
    .eq('lease_owner', input.workerRunId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('media job lease is no longer valid');
  return { status, retryable };
}

export async function getCodexMediaJobStatus(id: string): Promise<{
  id: string;
  status: MediaAssetAdminRow['status'];
  publicUrl: string | null;
  provider: MediaAssetAdminRow['provider'];
  attemptCount: number;
  lastErrorCode: string | null;
} | null> {
  const row = await getMediaAssetById(id);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    publicUrl: row.public_url,
    provider: row.provider,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
  };
}
