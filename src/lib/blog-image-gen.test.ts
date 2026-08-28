import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renderDeterministicMedia: vi.fn(),
  enabled: vi.fn(() => true),
}));

vi.mock('@/lib/media-generation', () => ({
  MEDIA_BRIEF_VERSION: 'media-brief-v1',
  renderDeterministicMedia: mocks.renderDeterministicMedia,
  isMediaCodexEnabled: mocks.enabled,
}));

import {
  buildGeneratedBlogImagePrompt,
  buildSearchQuery,
  extractGeminiInteractionImage,
  generateSectionImage,
  isGeneratedBlogImageUrl,
} from './blog-image-gen';

describe('blog image generation contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.renderDeterministicMedia.mockResolvedValue({ url: 'https://cdn.test/media-assets/code_rendered/blog/fallback.webp' });
  });

  it('keeps the destination mapping for legacy manual search tooling', () => {
    expect(buildSearchQuery('월별 날씨와 옷차림', '광저우', '광저우 월별 날씨'))
      .toContain('Guangzhou China Canton Tower');
  });

  it('retains the historical Gemini fixture parser without using Gemini at runtime', () => {
    expect(extractGeminiInteractionImage({
      steps: [{ type: 'model_output', content: [{ type: 'image', data: 'base64-image', mime_type: 'image/jpeg' }] }],
    })).toEqual({ data: 'base64-image', mimeType: 'image/jpeg' });
  });

  it('keeps prompt policy free of text overlays and documentary claims', () => {
    const prompt = buildGeneratedBlogImagePrompt('Guangzhou seasonal travel scene');
    expect(prompt).toContain('No text');
    expect(prompt).toContain('not documentary proof');
    expect(prompt).toContain('not a collage');
    expect(prompt).toContain('no menu prices');
  });

  it('publishes with an immutable code-rendered cover before the asynchronous Codex job', async () => {
    const url = await generateSectionImage('월별 날씨와 옷차림', '광저우 월별 날씨', '광저우', {
      ownerId: 'blog-123',
      purpose: 'blog_cover',
    });

    expect(url).toContain('/code_rendered/blog/');
    expect(mocks.renderDeterministicMedia).toHaveBeenCalledWith(
      expect.objectContaining({ brief: expect.objectContaining({ ownerId: 'blog-123' }) }),
    );
  });

  it('does not need an API key or rollout decision to create the publication fallback', async () => {
    const url = await generateSectionImage('준비물', '다낭 여행', '다낭');

    expect(url).toContain('/code_rendered/blog/');
    expect(mocks.renderDeterministicMedia).toHaveBeenCalledWith(
      expect.objectContaining({ brief: expect.objectContaining({ assetClass: 'deterministic_graphic' }) }),
    );
  });

  it('recognizes only persisted public AI generated-image URLs', () => {
    expect(isGeneratedBlogImageUrl(
      'https://project.supabase.co/storage/v1/object/public/media-assets/openai_generated/blog/cover.webp',
    )).toBe(true);
    expect(isGeneratedBlogImageUrl('data:image/jpeg;base64,abc')).toBe(false);
  });
});
