import { createHash } from 'node:crypto';
import type { MediaAssetClass, MediaBriefV1 } from './types';

export class MediaPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaPolicyError';
  }
}

export function assertMediaGenerationAllowed(assetClass: MediaAssetClass): void {
  if (assetClass === 'reality_required') {
    throw new MediaPolicyError(
      'reality_required assets must use supplier, official, or otherwise verified real imagery',
    );
  }
}

export function assertConceptualGenerationAllowed(brief: MediaBriefV1): void {
  assertMediaGenerationAllowed(brief.assetClass);
  if (brief.assetClass !== 'conceptual_allowed') {
    throw new MediaPolicyError('Generated conceptual media requires conceptual_allowed');
  }
  if (!brief.disclosureRequired) {
    throw new MediaPolicyError('AI-generated media must require public disclosure');
  }
  const promptInput = [
    brief.subject,
    brief.destination ?? '',
    ...(brief.factualConstraints ?? []),
  ].join(' ');
  const sensitivePatterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/,
    /\b\d{6}[-.\s]?\d{7}\b/,
    /\b(?:\d[ -]*?){13,19}\b/,
    /(?:여권|passport|주민등록|resident registration|카드번호|card number|계좌번호|bank account)\s*[:#-]?\s*[A-Z0-9-]{5,}/i,
  ];
  if (sensitivePatterns.some((pattern) => pattern.test(promptInput))) {
    throw new MediaPolicyError('media briefs must not contain personal or sensitive identifiers');
  }
}

export function assertDeterministicRenderingAllowed(brief: MediaBriefV1): void {
  if (brief.assetClass !== 'deterministic_graphic') {
    throw new MediaPolicyError('code rendering requires deterministic_graphic');
  }
}

export function isMediaCodexEnabled(): boolean {
  return process.env.MEDIA_CODEX_ENABLED?.trim().toLowerCase() === 'true';
}

export function isStableRolloutParticipant(ownerId: string, surface: 'blog' | 'card_news'): boolean {
  const raw = surface === 'blog'
    ? process.env.MEDIA_CODEX_BLOG_ROLLOUT_PERCENT
    : process.env.MEDIA_CODEX_CARD_NEWS_ROLLOUT_PERCENT;
  const parsed = Number(raw ?? '0');
  const percent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const bucket = Number.parseInt(
    createHash('sha256').update(`${surface}:${ownerId}`).digest('hex').slice(0, 8),
    16,
  ) % 100;
  return bucket < percent;
}
