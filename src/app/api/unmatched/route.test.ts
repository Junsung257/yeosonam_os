import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  rateLimitMutationMock: vi.fn(),
  resweepMock: vi.fn(),
  reEnrichMock: vi.fn(),
  canCreateMock: vi.fn(),
  reconcilePlaceNameMock: vi.fn(),
  supabaseAdminMock: { from: vi.fn() as unknown },
}));

type FromHandlers = {
  unmatchedSingle?: () => Promise<{ data: unknown; error: null }>;
  unmatchedUpdate?: () => Promise<{ error: null }>;
  attractionMaybeSingle?: () => Promise<{ data: unknown; error: null }>;
  attractionUpdate?: () => Promise<{ error: null }>;
};

function createSupabaseMock(handlers: FromHandlers) {
  return {
    from(table: string) {
      if (table === 'unmatched_activities') {
        return {
          select() {
            return {
              eq() {
                return {
                  single: handlers.unmatchedSingle ?? (async () => ({ data: null, error: null })),
                };
              },
            };
          },
          update() {
            return {
              eq: handlers.unmatchedUpdate ?? (async () => ({ error: null })),
            };
          },
        };
      }
      if (table === 'attractions') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: handlers.attractionMaybeSingle ?? (async () => ({ data: null, error: null })),
                };
              },
            };
          },
          update() {
            return {
              eq: handlers.attractionUpdate ?? (async () => ({ error: null })),
            };
          },
        };
      }
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({ data: null, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: mocked.supabaseAdminMock,
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimitMutation: mocked.rateLimitMutationMock,
}));

vi.mock('@/lib/unmatched-resweep', () => ({
  resweepUnmatchedActivities: mocked.resweepMock,
}));

vi.mock('@/lib/package-reenrich-on-attraction-change', () => ({
  reEnrichAffectedPackages: mocked.reEnrichMock,
}));

vi.mock('@/lib/unmatched-policy', () => ({
  canCreateAttractionViaReconcileAction: mocked.canCreateMock,
}));

vi.mock('@/lib/wikidata-reconcile', () => ({
  reconcilePlaceName: mocked.reconcilePlaceNameMock,
}));

vi.mock('@/lib/parser/attraction-category', () => ({
  inferCategory: vi.fn(() => 'sightseeing'),
}));

import { PATCH } from './route';

describe('PATCH /api/unmatched policy guard', () => {
  beforeEach(() => {
    mocked.rateLimitMutationMock.mockReset();
    mocked.resweepMock.mockReset();
    mocked.reEnrichMock.mockReset();
    mocked.canCreateMock.mockReset();
    mocked.reconcilePlaceNameMock.mockReset();
    mocked.rateLimitMutationMock.mockResolvedValue(null);
    Object.assign(mocked.supabaseAdminMock, createSupabaseMock({}));
  });

  it('reconcile_auto_insert blocks creation when policy disallows', async () => {
    Object.assign(mocked.supabaseAdminMock, createSupabaseMock({
      unmatchedSingle: async () => ({
        data: { id: 'u1', activity: '테스트 관광지', region: '나트랑', country: 'VN' },
        error: null,
      }),
      attractionMaybeSingle: async () => ({ data: null, error: null }),
    }));
    mocked.reconcilePlaceNameMock.mockResolvedValue([
      { qid: 'Q1', confidence: 0.9, label_ko: '테스트 관광지', label_en: 'Test', aliases: [], image_url: null, description: null, type_qid: 'Q570' },
    ]);
    mocked.canCreateMock.mockReturnValue(false);

    const req = new Request('http://localhost/api/unmatched', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'u1', action: 'reconcile_auto_insert' }),
    }) as never;

    const res = await PATCH(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(String(body.error ?? '')).toContain('허용되지 않습니다');
  });

  it('reconcile_auto_insert links alias when qid already exists', async () => {
    const attractionUpdateEq = vi.fn(async () => ({ error: null }));
    const unmatchedUpdateEq = vi.fn(async () => ({ error: null }));
    Object.assign(mocked.supabaseAdminMock, createSupabaseMock({
      unmatchedSingle: async () => ({
        data: { id: 'u1', activity: '테스트 관광지', region: '나트랑', country: 'VN' },
        error: null,
      }),
      attractionMaybeSingle: async () => ({ data: { id: 'a1', aliases: ['기존별칭'] }, error: null }),
      attractionUpdate: attractionUpdateEq,
      unmatchedUpdate: unmatchedUpdateEq,
    }));
    mocked.reconcilePlaceNameMock.mockResolvedValue([
      { qid: 'Q1', confidence: 0.95, label_ko: '테스트 관광지', label_en: 'Test', aliases: [], image_url: null, description: null, type_qid: 'Q570' },
    ]);
    mocked.canCreateMock.mockReturnValue(false);

    const req = new Request('http://localhost/api/unmatched', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'u1', action: 'reconcile_auto_insert' }),
    }) as never;
    const res = await PATCH(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(attractionUpdateEq).toHaveBeenCalled();
    expect(unmatchedUpdateEq).toHaveBeenCalled();
  });
});
