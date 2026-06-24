import { describe, expect, it } from 'vitest';
import { queueUploadAttractionReviewCandidates } from './unmatched-queue';

describe('queueUploadAttractionReviewCandidates', () => {
  it('falls back to package-scoped unmatched upsert when the RPC is unavailable', async () => {
    const rpcCalls: unknown[] = [];
    const upserts: unknown[] = [];
    const fakeSupabase = {
      rpc: async (name: string, payload: unknown) => {
        rpcCalls.push({ name, payload });
        return name === 'upsert_unmatched_activity'
          ? { error: { message: 'rpc unavailable' } }
          : { error: null };
      },
      from: (table: string) => ({
        upsert: async (payload: unknown, options: unknown) => {
          upserts.push({ table, payload, options });
          return { error: null };
        },
      }),
    };

    const result = await queueUploadAttractionReviewCandidates({
      supabaseAdmin: fakeSupabase as never,
      unmatchedRows: [{
        activity: '디 하이츠 18홀 라운딩',
        package_id: '00000000-0000-0000-0000-000000000001',
        package_title: 'Clark package',
        day_number: 2,
        country: '클락',
      }],
      extractedCandidateRows: [],
      matchedCanonicalNames: [],
      activeAttractions: [],
      fallbackPackageId: null,
      fallbackPackageTitle: null,
    });

    expect(result.unmatchedQueued).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    expect(upserts).toEqual([
      expect.objectContaining({
        table: 'unmatched_activities',
        options: { onConflict: 'unmatched_scope_key,activity' },
      }),
    ]);
  });

  it('queues only unknown extracted candidates and keeps existing attractions as mention counts', async () => {
    const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const fakeSupabase = {
      rpc: async (name: string, payload: Record<string, unknown>) => {
        rpcCalls.push({ name, payload });
        return { error: null };
      },
      from: () => ({
        upsert: async () => ({ error: null }),
      }),
    };

    const result = await queueUploadAttractionReviewCandidates({
      supabaseAdmin: fakeSupabase as never,
      unmatchedRows: [],
      extractedCandidateRows: [
        { activity: '이미있는관광지', destination: '클락' },
        { activity: '새 후보 관광지', destination: '클락' },
      ],
      matchedCanonicalNames: ['이미있는관광지'],
      activeAttractions: [{ id: 'a1', name: '이미있는관광지' } as never],
      fallbackPackageId: '00000000-0000-0000-0000-000000000001',
      fallbackPackageTitle: 'Clark package',
    });

    expect(result.mentionCounted).toBe(1);
    expect(result.newCandidateQueued).toBe(1);
    expect(rpcCalls.map(call => call.name)).toEqual([
      'increment_mention_count',
      'upsert_unmatched_activity',
    ]);
    expect(rpcCalls[1].payload).toMatchObject({
      p_activity: '새 후보 관광지',
      p_package_id: '00000000-0000-0000-0000-000000000001',
      p_raw_label: expect.any(String),
      p_segment_kind_guess: 'attraction',
    });
  });
});
