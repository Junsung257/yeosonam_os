import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  from: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: mocked.from,
  },
}));

import { resweepUnmatchedActivities } from './unmatched-resweep';

function createSelectChain(data: unknown[]) {
  return {
    select: vi.fn(() => ({
      order: vi.fn(() => ({
        range: vi.fn(async () => ({ data, error: null })),
      })),
      in: vi.fn(async () => ({ data, error: null })),
      eq: vi.fn(() => ({
        range: vi.fn(async () => ({ data, error: null })),
      })),
      is: vi.fn(() => ({
        order: vi.fn(() => ({
          range: vi.fn(async () => ({ data, error: null })),
        })),
      })),
    })),
  };
}

describe('resweepUnmatchedActivities', () => {
  beforeEach(() => {
    mocked.from.mockReset();
    mocked.updates.length = 0;
  });

  it('marks matched pending rows as added', async () => {
    mocked.from.mockImplementation((table: string) => {
      if (table === 'attractions') {
        return createSelectChain([
          { id: 'a1', name: '오타루 운하', aliases: ['Otaru Canal'], region: '홋카이도', country: 'JP' },
        ]);
      }
      if (table === 'unmatched_activities') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                order: vi.fn(() => ({
                  range: vi.fn(async () => ({
                    data: [{ id: 'u1', activity: '오타루 운하 산책', region: '홋카이도', country: 'JP' }],
                    error: null,
                  })),
                })),
              })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            mocked.updates.push(payload);
            return {
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    select: vi.fn(async () => ({ data: [{ id: 'u1' }], error: null })),
                  })),
                })),
              })),
            };
          }),
        };
      }
      return createSelectChain([]);
    });

    const result = await resweepUnmatchedActivities();

    expect(result.matched).toBe(1);
    expect(mocked.updates[0]).toMatchObject({
      status: 'added',
      resolved_kind: 'auto_resweep',
      resolved_attraction_id: 'a1',
    });
  });
});
