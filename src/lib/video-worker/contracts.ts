export const VIDEO_BRIEF_VERSION = 'video-brief-v1' as const;
export const VIDEO_SOURCE_MANIFEST_VERSION = 'video-source-manifest-v1' as const;
export const VIDEO_DELIVERABLE_VERSION = 'video-deliverable-v1' as const;

export type VideoClaimV1 = {
  id: string;
  text: string;
  evidenceRefs: string[];
};

export type VideoBriefV1 = {
  version: typeof VIDEO_BRIEF_VERSION;
  id: string;
  blog: {
    creativeId: string;
    revision: string;
    bodySha256: string;
    evidenceSha256: string;
    approvalStatus: 'approved';
  };
  durationSeconds: number;
  aspectRatio: '9:16';
  width: 1080;
  height: 1920;
  language: 'ko-KR';
  claims: VideoClaimV1[];
  policy: {
    factsFromApprovedBriefOnly: true;
    webResearch: 'source_discovery_only';
    ttsProvider: 'piper';
    ttsVoiceId: string;
    ttsVoiceLicenseStatus: 'commercially_approved';
    paidHeroProvidersEnabled: false;
    uploadEnabled: false;
    databaseWritesEnabled: false;
    vaApprovalRequired: true;
  };
};

export type VideoSceneRoleV1 =
  | 'product'
  | 'hotel'
  | 'room'
  | 'meal'
  | 'attraction'
  | 'information_broll'
  | 'title_card'
  | 'claim_card';

export type VideoSourceV1 = {
  sceneId: string;
  sceneRole: VideoSceneRoleV1;
  sourceKind: 'internal_product_media' | 'licensed_broll' | 'public_archive' | 'generated_reference' | 'code_rendered';
  internalMediaAssetId: string | null;
  sha256: string;
  provenance: 'supplier_product' | 'operator_product' | 'official' | 'destination_reference' | 'licensed_stock' | 'public_domain' | 'generated' | 'code_rendered';
  rightsStatus: 'verified' | 'attribution_required' | 'unverified' | 'prohibited' | 'expired';
  sourcePageUrl: string | null;
  licenseReference: string | null;
  attributionText: string | null;
  referenceLabel: '참고 영상' | 'AI 생성 참고 이미지' | null;
  claimRefs: string[];
};

export type VideoSourceManifestV1 = {
  version: typeof VIDEO_SOURCE_MANIFEST_VERSION;
  briefId: string;
  sources: VideoSourceV1[];
};

export type VideoDeliverableV1 = {
  version: typeof VIDEO_DELIVERABLE_VERSION;
  briefId: string;
  sourceManifestSha256: string;
  artifacts: {
    mp4Sha256: string;
    srtSha256: string;
    thumbnailSha256: string;
  };
  providers: {
    orchestrator: 'openmontage';
    openMontageCommit: string;
    tts: 'piper';
    ttsVoiceSha256: string;
    ttsVoiceLicense: string;
    paidHeroProvider: null;
    costUsd: 0;
  };
  ffprobe: {
    durationSeconds: number;
    width: 1080;
    height: 1920;
    videoCodec: 'h264';
    audioCodec: 'aac';
  };
  qa: {
    factsPassed: boolean;
    rightsPassed: boolean;
    claimCoveragePassed: boolean;
    subtitleSafeAreaPassed: boolean;
    loudnessPassed: boolean;
    watermarkPassed: boolean;
    referenceLabelsPassed: boolean;
    issues: string[];
  };
  status: 'draft_pending_va' | 'approved_by_va' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
};

export type VideoContractValidation = { ok: boolean; errors: string[] };

const SHA256 = /^[a-f0-9]{64}$/u;
const PRODUCT_ROLES = new Set<VideoSceneRoleV1>(['product', 'hotel', 'room', 'meal', 'attraction']);
const PRODUCT_PROVENANCE = new Set<VideoSourceV1['provenance']>(['supplier_product', 'operator_product', 'official']);

export function validateVideoBriefV1(brief: VideoBriefV1): VideoContractValidation {
  const errors: string[] = [];
  if (brief.version !== VIDEO_BRIEF_VERSION) errors.push('VIDEO_BRIEF_VERSION_INVALID');
  if (brief.blog.approvalStatus !== 'approved') errors.push('BLOG_NOT_APPROVED');
  if (!SHA256.test(brief.blog.bodySha256) || !SHA256.test(brief.blog.evidenceSha256)) errors.push('BLOG_HASH_INVALID');
  if (brief.durationSeconds < 20 || brief.durationSeconds > 40) errors.push('DURATION_OUT_OF_RANGE');
  if (brief.aspectRatio !== '9:16' || brief.width !== 1080 || brief.height !== 1920) errors.push('VIDEO_FORMAT_INVALID');
  if (brief.language !== 'ko-KR') errors.push('LANGUAGE_INVALID');
  if (!brief.claims.length || brief.claims.some((claim) => !claim.id || !claim.text.trim() || claim.evidenceRefs.length === 0)) {
    errors.push('CLAIM_EVIDENCE_MISSING');
  }
  if (!brief.policy.factsFromApprovedBriefOnly || brief.policy.webResearch !== 'source_discovery_only') errors.push('FACT_POLICY_UNSAFE');
  if (brief.policy.ttsProvider !== 'piper' || !brief.policy.ttsVoiceId
    || brief.policy.ttsVoiceLicenseStatus !== 'commercially_approved'
    || brief.policy.paidHeroProvidersEnabled) errors.push('PROVIDER_POLICY_UNSAFE');
  if (brief.policy.uploadEnabled || brief.policy.databaseWritesEnabled || !brief.policy.vaApprovalRequired) errors.push('MUTATION_POLICY_UNSAFE');
  return { ok: errors.length === 0, errors };
}

export function validateVideoSourceManifestV1(
  brief: VideoBriefV1,
  manifest: VideoSourceManifestV1,
): VideoContractValidation {
  const errors: string[] = [];
  const claimIds = new Set(brief.claims.map((claim) => claim.id));
  if (manifest.version !== VIDEO_SOURCE_MANIFEST_VERSION || manifest.briefId !== brief.id) errors.push('SOURCE_MANIFEST_IDENTITY_INVALID');
  if (!manifest.sources.length) errors.push('VIDEO_SOURCES_EMPTY');
  for (const source of manifest.sources) {
    if (!source.sceneId || !SHA256.test(source.sha256)) errors.push(`SOURCE_ID_OR_HASH_INVALID:${source.sceneId || 'unknown'}`);
    if (source.rightsStatus === 'unverified' || source.rightsStatus === 'prohibited' || source.rightsStatus === 'expired') {
      errors.push(`SOURCE_RIGHTS_NOT_USABLE:${source.sceneId}`);
    }
    if (source.rightsStatus === 'attribution_required' && (!source.attributionText || !source.sourcePageUrl || !source.licenseReference)) {
      errors.push(`SOURCE_ATTRIBUTION_INCOMPLETE:${source.sceneId}`);
    }
    if (source.claimRefs.some((claimRef) => !claimIds.has(claimRef))) errors.push(`SOURCE_UNKNOWN_CLAIM:${source.sceneId}`);
    if (PRODUCT_ROLES.has(source.sceneRole)) {
      if (source.sourceKind !== 'internal_product_media' || !source.internalMediaAssetId || !PRODUCT_PROVENANCE.has(source.provenance)) {
        errors.push(`PRODUCT_SCENE_REQUIRES_VERIFIED_INTERNAL_MEDIA:${source.sceneId}`);
      }
      if (source.referenceLabel) errors.push(`PRODUCT_SCENE_CANNOT_BE_REFERENCE:${source.sceneId}`);
    }
    if (source.sourceKind === 'licensed_broll' || source.sourceKind === 'public_archive') {
      if (source.sceneRole !== 'information_broll' || source.referenceLabel !== '참고 영상') {
        errors.push(`BROLL_REQUIRES_INFORMATION_ROLE_AND_LABEL:${source.sceneId}`);
      }
      if (!source.sourcePageUrl || !source.licenseReference) errors.push(`BROLL_PROVENANCE_INCOMPLETE:${source.sceneId}`);
    }
    if (source.sourceKind === 'generated_reference') {
      if (source.sceneRole !== 'information_broll' || source.referenceLabel !== 'AI 생성 참고 이미지' || source.claimRefs.length > 0) {
        errors.push(`GENERATED_MEDIA_CANNOT_BE_PRODUCT_EVIDENCE:${source.sceneId}`);
      }
    }
  }
  for (const claim of brief.claims) {
    if (!manifest.sources.some((source) => source.claimRefs.includes(claim.id))) {
      errors.push(`CLAIM_VISUAL_SUPPORT_MISSING:${claim.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateVideoDeliverableV1(
  brief: VideoBriefV1,
  deliverable: VideoDeliverableV1,
  pinnedOpenMontageCommit: string,
): VideoContractValidation {
  const errors: string[] = [];
  if (deliverable.version !== VIDEO_DELIVERABLE_VERSION || deliverable.briefId !== brief.id) errors.push('DELIVERABLE_IDENTITY_INVALID');
  if (![deliverable.sourceManifestSha256, ...Object.values(deliverable.artifacts)].every((value) => SHA256.test(value))) {
    errors.push('DELIVERABLE_HASH_INVALID');
  }
  if (deliverable.providers.orchestrator !== 'openmontage'
    || deliverable.providers.openMontageCommit !== pinnedOpenMontageCommit
    || deliverable.providers.tts !== 'piper'
    || !SHA256.test(deliverable.providers.ttsVoiceSha256)
    || !deliverable.providers.ttsVoiceLicense
    || deliverable.providers.paidHeroProvider !== null
    || deliverable.providers.costUsd !== 0) errors.push('DELIVERABLE_PROVIDER_POLICY_UNSAFE');
  if (deliverable.ffprobe.durationSeconds < 20 || deliverable.ffprobe.durationSeconds > 40
    || deliverable.ffprobe.width !== 1080 || deliverable.ffprobe.height !== 1920
    || deliverable.ffprobe.videoCodec !== 'h264' || deliverable.ffprobe.audioCodec !== 'aac') errors.push('DELIVERABLE_FORMAT_INVALID');
  const requiredQa = [
    deliverable.qa.factsPassed,
    deliverable.qa.rightsPassed,
    deliverable.qa.claimCoveragePassed,
    deliverable.qa.subtitleSafeAreaPassed,
    deliverable.qa.loudnessPassed,
    deliverable.qa.watermarkPassed,
    deliverable.qa.referenceLabelsPassed,
  ];
  if (requiredQa.some((passed) => !passed) || deliverable.qa.issues.length > 0) errors.push('DELIVERABLE_QA_FAILED');
  if (deliverable.status === 'approved_by_va' && (!deliverable.approvedBy || !deliverable.approvedAt)) errors.push('VA_APPROVAL_EVIDENCE_MISSING');
  if (deliverable.status === 'draft_pending_va' && (deliverable.approvedBy || deliverable.approvedAt)) errors.push('DRAFT_HAS_APPROVAL_EVIDENCE');
  return { ok: errors.length === 0, errors };
}
