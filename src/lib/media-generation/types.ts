export const MEDIA_BRIEF_VERSION = 'media-brief-v1' as const;
export const MEDIA_PROMPT_VERSION = 'yeosonam-editorial-v1' as const;

export type MediaAssetClass =
  | 'reality_required'
  | 'conceptual_allowed'
  | 'deterministic_graphic';

export type MediaPurpose =
  | 'blog_cover'
  | 'blog_inline_summary'
  | 'blog_inline_cta'
  | 'home_campaign_hero'
  | 'card_news_background'
  | 'social_og'
  | 'brand_fallback';

export type MediaSourceKind =
  | 'supplier'
  | 'official'
  | 'licensed_stock'
  | 'openai_generated'
  | 'code_rendered'
  | 'brand_static';

export type MediaAssetStatus =
  | 'pending'
  | 'generating'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'superseded';

export type MediaProvider = 'openai' | 'codex_builtin' | 'code' | null;

export interface MediaBriefV1 {
  version: typeof MEDIA_BRIEF_VERSION;
  tenantId?: string | null;
  ownerType: 'blog' | 'home' | 'package' | 'card_news' | 'marketing';
  ownerId: string;
  purpose: MediaPurpose;
  assetClass: MediaAssetClass;
  locale: 'ko-KR';
  subject: string;
  destination?: string | null;
  factualConstraints?: string[];
  stylePreset: 'yeosonam_editorial' | 'yeosonam_campaign' | 'yeosonam_information';
  aspectRatio: '16:9' | '1:1' | '4:5' | '9:16' | '1.91:1';
  disclosureRequired: boolean;
}

export interface MediaQaReportV1 {
  version: 'media-qa-v1';
  passed: boolean;
  checks: {
    decoded: boolean;
    allowedMime: boolean;
    minimumDimensions: boolean;
    maximumBytes: boolean;
    expectedAspectRatio: boolean;
  };
  issues: string[];
}

export interface MediaAssetManifestV1 {
  id: string;
  url: string;
  variants: Record<string, string>;
  sourceKind: MediaSourceKind;
  provider: MediaProvider;
  model: string | null;
  width: number;
  height: number;
  mimeType: string;
  sha256: string;
  promptVersion: string;
  briefDigest: string;
  costUsd: number;
  disclosure: string | null;
  status: MediaAssetStatus;
  qa: MediaQaReportV1;
}

export interface EnqueueConceptualMediaOptions {
  approvalMode?: 'automatic' | 'manual';
  idempotencySalt?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface QueuedMediaAssetV1 {
  id: string;
  status: MediaAssetStatus;
  ownerType: MediaBriefV1['ownerType'];
  ownerId: string;
  purpose: MediaPurpose;
  provider: MediaProvider;
  publicUrl: string | null;
  createdAt: string;
}

export interface CodexMediaJobV1 {
  id: string;
  workerRunId: string;
  prompt: string;
  purpose: MediaPurpose;
  ownerType: MediaBriefV1['ownerType'];
  ownerId: string;
  aspectRatio: MediaBriefV1['aspectRatio'];
  subject: string;
  destination: string | null;
  attemptCount: number;
  leaseExpiresAt: string;
}

export interface RenderDeterministicMediaInput {
  brief: MediaBriefV1;
  eyebrow?: string;
  title: string;
  lines: string[];
  footer?: string;
  approvalMode?: 'automatic' | 'manual';
}
