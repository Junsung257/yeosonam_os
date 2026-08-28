import { afterEach, describe, expect, it } from 'vitest';
import {
  assertConceptualGenerationAllowed,
  assertDeterministicRenderingAllowed,
  isStableRolloutParticipant,
  MediaPolicyError,
} from './policy';
import { MEDIA_BRIEF_VERSION, type MediaBriefV1 } from './types';

const conceptualBrief: MediaBriefV1 = {
  version: MEDIA_BRIEF_VERSION,
  ownerType: 'blog',
  ownerId: 'blog-1',
  purpose: 'blog_cover',
  assetClass: 'conceptual_allowed',
  locale: 'ko-KR',
  subject: '여행 준비의 설렘',
  stylePreset: 'yeosonam_editorial',
  aspectRatio: '16:9',
  disclosureRequired: true,
};

describe('media generation policy', () => {
  afterEach(() => delete process.env.MEDIA_CODEX_BLOG_ROLLOUT_PERCENT);

  it('blocks generative use for evidence-bearing reality assets', () => {
    expect(() => assertConceptualGenerationAllowed({ ...conceptualBrief, assetClass: 'reality_required' }))
      .toThrow(MediaPolicyError);
  });

  it('requires public disclosure for conceptual AI media', () => {
    expect(() => assertConceptualGenerationAllowed({ ...conceptualBrief, disclosureRequired: false }))
      .toThrow('public disclosure');
  });

  it('rejects personal identifiers before they can enter a provider prompt', () => {
    expect(() => assertConceptualGenerationAllowed({
      ...conceptualBrief,
      subject: '여행자 010-1234-5678을 넣은 개인 배너',
    })).toThrow('personal or sensitive identifiers');
  });

  it('keeps code rendering limited to deterministic graphics', () => {
    expect(() => assertDeterministicRenderingAllowed(conceptualBrief)).toThrow('deterministic_graphic');
    expect(() => assertDeterministicRenderingAllowed({
      ...conceptualBrief,
      purpose: 'blog_inline_summary',
      assetClass: 'deterministic_graphic',
      disclosureRequired: false,
    })).not.toThrow();
  });

  it('uses a stable, bounded rollout switch', () => {
    process.env.MEDIA_CODEX_BLOG_ROLLOUT_PERCENT = '0';
    expect(isStableRolloutParticipant('blog-1', 'blog')).toBe(false);
    process.env.MEDIA_CODEX_BLOG_ROLLOUT_PERCENT = '100';
    expect(isStableRolloutParticipant('blog-1', 'blog')).toBe(true);
  });
});
