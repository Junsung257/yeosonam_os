import { createHash } from 'node:crypto';
import { assertConceptualGenerationAllowed, isMediaCodexEnabled } from './policy';
import {
  buildMediaIdempotencyKey,
  createPendingMediaAsset,
  getMediaAssetById,
  getMediaAssetByIdempotencyKey,
} from './persistence';
import {
  MEDIA_PROMPT_VERSION,
  type EnqueueConceptualMediaOptions,
  type MediaBriefV1,
  type QueuedMediaAssetV1,
} from './types';

export * from './types';
export * from './policy';
export {
  getLatestApprovedMediaAsset,
  listMediaAssets,
  reviewMediaAsset,
  getMediaAssetById,
  supersedeMediaAsset,
  markMediaAssetRegenerationRequested,
  claimNextCodexMediaJob,
  readCodexDailyUsage,
  type MediaAssetAdminRow,
} from './persistence';
export { renderDeterministicMedia } from './deterministic';
export { completeCodexMediaJob, failCodexMediaJob, getCodexMediaJobStatus } from './worker';
export { isMediaCodexWorkerAuthorized } from './worker-auth';

function queuedAsset(row: Awaited<ReturnType<typeof getMediaAssetById>>): QueuedMediaAssetV1 {
  if (!row) throw new Error('queued media asset could not be read back');
  return {
    id: row.id,
    status: row.status,
    ownerType: row.owner_type as MediaBriefV1['ownerType'],
    ownerId: row.owner_id,
    purpose: row.purpose as MediaBriefV1['purpose'],
    provider: row.provider,
    publicUrl: row.public_url,
    createdAt: row.created_at,
  };
}

export async function enqueueConceptualMedia(
  brief: MediaBriefV1,
  options: EnqueueConceptualMediaOptions = {},
): Promise<QueuedMediaAssetV1> {
  assertConceptualGenerationAllowed(brief);
  if (!isMediaCodexEnabled()) throw new Error('Codex subscription media generation is disabled');
  const baseIdempotencyKey = buildMediaIdempotencyKey(brief, MEDIA_PROMPT_VERSION);
  const idempotencyKey = options.idempotencySalt
    ? createHash('sha256').update(`${baseIdempotencyKey}:${options.idempotencySalt}`).digest('hex')
    : baseIdempotencyKey;
  const existing = await getMediaAssetByIdempotencyKey(idempotencyKey);
  if (existing) return queuedAsset(existing);
  const id = await createPendingMediaAsset({
    brief,
    promptVersion: MEDIA_PROMPT_VERSION,
    sourceKind: 'openai_generated',
    provider: 'codex_builtin',
    model: 'chatgpt-imagegen-builtin',
    idempotencyKey,
    additionalSourceMetadata: {
      billing_surface: 'chatgpt_subscription',
      execution_surface: 'codex_builtin_imagegen',
      approval_mode: options.approvalMode ?? 'manual',
      factual_constraints: brief.factualConstraints ?? [],
      ...(options.sourceMetadata ?? {}),
    },
  });
  return queuedAsset(await getMediaAssetById(id));
}
