import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrendStyleContext, refreshTrendStyleFingerprints } from './trend-style-engine';

const mocks = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.fromMock,
  },
}));

class QueryMock {
  constructor(private readonly response: unknown) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  not() { return this; }
  gte() { return this; }
  order() { return this; }
  limit() { return this; }
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.response).then(resolve, reject);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertMock.mockResolvedValue({ error: null });
});

describe('trend-style-engine', () => {
  it('builds prompt context from stored trend fingerprints', async () => {
    mocks.fromMock.mockImplementation((table: string) => {
      if (table === 'trend_style_fingerprints') {
        return new QueryMock({
          data: [{
            platform: 'threads',
            destination: 'Bohol',
            audience: 'family',
            hook_type: 'question',
            style_key: 'short_hook',
            source_type: 'external_trend',
            sample_count: 8,
            avg_score: 0.41,
            avg_er: 0.08,
            avg_hook_words: 7,
            avg_posting_hour: 21,
            avg_emoji_count: 1,
            avg_hashtag_count: 1,
            sample_first_lines: ['Bohol in 4 nights, worth it?'],
            source_breakdown: {},
            latest_captured_at: '2026-06-03T00:00:00.000Z',
          }],
          error: null,
        });
      }
      return new QueryMock({ data: [], error: null });
    });

    const context = await getTrendStyleContext({ destination: 'Bohol', audience: 'family' });

    expect(context.promptBlock).toContain('Learned Threads trend/style signals');
    expect(context.promptBlock).toContain('question');
    expect(context.sources[0]).toMatchObject({
      source_type: 'external_trend',
      destination: 'Bohol',
      hook_type: 'question',
      sample_count: 8,
    });
  });

  it('returns curated fallback context when no trend rows exist', async () => {
    mocks.fromMock.mockImplementation(() => new QueryMock({ data: [], error: null }));

    const context = await getTrendStyleContext({ destination: 'Bohol', audience: 'family' });

    expect(context.promptBlock).toContain('Curated Threads fallback patterns');
    expect(context.sources[0]).toMatchObject({
      source_type: 'fallback_curated',
      destination: 'global',
      sample_count: 0,
    });
  });

  it('refreshes fingerprints from external and owned Threads signals', async () => {
    mocks.fromMock.mockImplementation((table: string) => {
      if (table === 'external_trend_posts') {
        return new QueryMock({
          data: [
            {
              platform: 'threads',
              related_destination: 'Bohol',
              hook_type: 'question',
              performance_score: 0.4,
              engagement_rate: 0.08,
              hook_words: 7,
              hashtag_count: 1,
              emoji_count: 1,
              hook_first_line: 'Bohol in 4 nights, worth it?',
              keyword: 'Bohol',
              captured_at: '2026-06-03T00:00:00.000Z',
            },
            {
              platform: 'threads',
              related_destination: 'Bohol',
              hook_type: 'question',
              performance_score: 0.5,
              engagement_rate: 0.1,
              hook_words: 8,
              hashtag_count: 1,
              emoji_count: 0,
              hook_first_line: 'Would you spend 4 nights in Bohol?',
              keyword: 'Bohol',
              captured_at: '2026-06-03T01:00:00.000Z',
            },
          ],
          error: null,
        });
      }
      if (table === 'threads_learning_signals_14d') {
        return new QueryMock({
          data: [{
            audience: 'family',
            destination: 'Bohol',
            hook_type: 'question',
            style_key: 'personal_story',
            sample_count: 1,
            avg_score: 0.2,
            avg_er: 0.04,
            avg_posting_hour: 22,
            latest_captured_at: '2026-06-03T02:00:00.000Z',
          }],
          error: null,
        });
      }
      if (table === 'trend_style_fingerprints') {
        return { upsert: mocks.upsertMock };
      }
      return new QueryMock({ data: [], error: null });
    });

    const result = await refreshTrendStyleFingerprints('threads');

    expect(result).toEqual({ refreshed: 2, external: 1, owned: 1 });
    expect(mocks.upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'threads',
          destination: 'Bohol',
          hook_type: 'question',
          source_type: 'external_trend',
          sample_count: 2,
        }),
        expect.objectContaining({
          source_type: 'owned_performance',
          sample_count: 1,
        }),
      ]),
      expect.objectContaining({ onConflict: 'platform,destination,audience,hook_type,style_key,source_type' }),
    );
  });
});
