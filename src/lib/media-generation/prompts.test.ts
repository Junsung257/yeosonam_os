import { describe, expect, it } from 'vitest';
import { buildConceptualMediaPrompt } from './prompts';
import { MEDIA_BRIEF_VERSION } from './types';

describe('conceptual media prompt', () => {
  it('encodes the reality boundary and bans generated labels and logos', () => {
    const prompt = buildConceptualMediaPrompt({
      version: MEDIA_BRIEF_VERSION,
      ownerType: 'home',
      ownerId: 'homepage',
      purpose: 'home_campaign_hero',
      assetClass: 'conceptual_allowed',
      locale: 'ko-KR',
      subject: '여행 출발의 설렘',
      destination: '베트남',
      stylePreset: 'yeosonam_campaign',
      aspectRatio: '16:9',
      disclosureRequired: true,
    });
    expect(prompt).toContain('never documentary proof');
    expect(prompt).toContain('Do not invent or closely imitate');
    expect(prompt).toContain('no text');
    expect(prompt).toContain('no logo');
    expect(prompt).toContain('central 60 percent');
  });
});
