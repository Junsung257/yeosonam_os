import { describe, expect, it } from 'vitest';
import {
  validateVideoBriefV1,
  validateVideoDeliverableV1,
  validateVideoSourceManifestV1,
  type VideoBriefV1,
  type VideoDeliverableV1,
  type VideoSourceManifestV1,
} from './contracts';

const SHA = 'a'.repeat(64);
const OPENMONTAGE_COMMIT = 'cd9f3c1f03368be87b140af494914b8ee4e3c7a4';

function brief(id: string): VideoBriefV1 {
  return {
    version: 'video-brief-v1', id,
    blog: { creativeId: `blog-${id}`, revision: 'rev-1', bodySha256: SHA, evidenceSha256: SHA, approvalStatus: 'approved' },
    durationSeconds: 30, aspectRatio: '9:16', width: 1080, height: 1920, language: 'ko-KR',
    claims: [{ id: 'claim-1', text: '승인된 정보성 주장', evidenceRefs: ['official-source-1'] }],
    policy: {
      factsFromApprovedBriefOnly: true, webResearch: 'source_discovery_only', ttsProvider: 'piper',
      ttsVoiceId: 'yeosonam-approved-ko-v1', ttsVoiceLicenseStatus: 'commercially_approved',
      paidHeroProvidersEnabled: false, uploadEnabled: false, databaseWritesEnabled: false, vaApprovalRequired: true,
    },
  };
}

function informationalManifest(id: string): VideoSourceManifestV1 {
  return {
    version: 'video-source-manifest-v1', briefId: id,
    sources: [{
      sceneId: 'scene-1', sceneRole: 'information_broll', sourceKind: 'public_archive', internalMediaAssetId: null,
      sha256: SHA, provenance: 'public_domain', rightsStatus: 'verified', sourcePageUrl: 'https://commons.wikimedia.org/example',
      licenseReference: 'Public domain', attributionText: null, referenceLabel: '참고 영상', claimRefs: ['claim-1'],
    }],
  };
}

describe('OpenMontage draft-worker contracts', () => {
  it.each(['tokyo-transit', 'osaka-etiquette', 'sapporo-season'])(
    'accepts approved informational brief %s with rights-bound B-roll',
    (id) => {
      const input = brief(id);
      expect(validateVideoBriefV1(input)).toEqual({ ok: true, errors: [] });
      expect(validateVideoSourceManifestV1(input, informationalManifest(id))).toEqual({ ok: true, errors: [] });
    },
  );

  it('blocks stock footage from replacing an actual hotel scene', () => {
    const input = brief('hotel-product');
    const manifest = informationalManifest(input.id);
    manifest.sources[0] = { ...manifest.sources[0], sceneRole: 'hotel', sourceKind: 'licensed_broll', provenance: 'licensed_stock' };
    expect(validateVideoSourceManifestV1(input, manifest).errors).toContain(
      'PRODUCT_SCENE_REQUIRES_VERIFIED_INTERNAL_MEDIA:scene-1',
    );
  });

  it('requires every factual claim to retain evidence', () => {
    const input = brief('missing-evidence');
    input.claims[0].evidenceRefs = [];
    expect(validateVideoBriefV1(input).errors).toContain('CLAIM_EVIDENCE_MISSING');
  });

  it('accepts only the pinned free-provider draft format before VA approval', () => {
    const input = brief('deliverable');
    const deliverable: VideoDeliverableV1 = {
      version: 'video-deliverable-v1', briefId: input.id, sourceManifestSha256: SHA,
      artifacts: { mp4Sha256: SHA, srtSha256: SHA, thumbnailSha256: SHA },
      providers: {
        orchestrator: 'openmontage', openMontageCommit: OPENMONTAGE_COMMIT, tts: 'piper',
        ttsVoiceSha256: SHA, ttsVoiceLicense: 'commercial-use-approved', paidHeroProvider: null, costUsd: 0,
      },
      ffprobe: { durationSeconds: 30, width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac' },
      qa: {
        factsPassed: true, rightsPassed: true, claimCoveragePassed: true, subtitleSafeAreaPassed: true,
        loudnessPassed: true, watermarkPassed: true, referenceLabelsPassed: true, issues: [],
      },
      status: 'draft_pending_va', approvedBy: null, approvedAt: null,
    };
    expect(validateVideoDeliverableV1(input, deliverable, OPENMONTAGE_COMMIT)).toEqual({ ok: true, errors: [] });
  });
});
