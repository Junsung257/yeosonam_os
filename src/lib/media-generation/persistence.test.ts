import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));

import { buildMediaIdempotencyKey, digestMediaBrief, findPersistedMediaAsset } from './persistence';
import { MEDIA_BRIEF_VERSION, type MediaBriefV1 } from './types';

const brief: MediaBriefV1 = {
  version: MEDIA_BRIEF_VERSION,
  ownerType: 'home',
  ownerId: 'homepage',
  purpose: 'home_campaign_hero',
  assetClass: 'conceptual_allowed',
  locale: 'ko-KR',
  subject: '여행의 설렘',
  stylePreset: 'yeosonam_campaign',
  aspectRatio: '16:9',
  disclosureRequired: true,
};

function manifestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    public_url: 'https://cdn.test/replacement.webp',
    variants: { og: 'https://cdn.test/replacement-og.webp' },
    source_kind: 'openai_generated',
    provider: 'codex_builtin',
    model: 'chatgpt-imagegen-builtin',
    width: 1536,
    height: 864,
    mime_type: 'image/webp',
    sha256: 'a'.repeat(64),
    prompt_version: 'yeosonam-editorial-v1',
    brief_digest: 'b'.repeat(64),
    cost_usd: 0,
    disclosure: 'AI 생성 참고 이미지',
    status: 'approved',
    qa_report: {
      version: 'media-qa-v1',
      passed: true,
      checks: {
        decoded: true,
        allowedMime: true,
        minimumDimensions: true,
        maximumBytes: true,
        expectedAspectRatio: true,
      },
      issues: [],
    },
    superseded_by: null,
    ...overrides,
  };
}

describe('media persistence identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('produces stable digests and prompt-versioned idempotency keys', () => {
    expect(digestMediaBrief(brief)).toMatch(/^[0-9a-f]{64}$/);
    expect(buildMediaIdempotencyKey(brief, 'v1')).toBe(buildMediaIdempotencyKey({ ...brief }, 'v1'));
    expect(buildMediaIdempotencyKey(brief, 'v1')).not.toBe(buildMediaIdempotencyKey(brief, 'v2'));
  });

  it('follows an approved replacement after the original is superseded', async () => {
    const responses = [
      {
        data: manifestRow({
          id: '11111111-1111-4111-8111-111111111111',
          public_url: null,
          status: 'superseded',
          superseded_by: '22222222-2222-4222-8222-222222222222',
        }),
        error: null,
      },
      { data: manifestRow(), error: null },
    ];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(async () => responses.shift());
    mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) });

    const result = await findPersistedMediaAsset('c'.repeat(64));
    expect(result?.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(result?.url).toBe('https://cdn.test/replacement.webp');
    expect(builder.maybeSingle).toHaveBeenCalledTimes(2);
  });
});
