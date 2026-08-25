import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  updateEq: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('./blog-metrics-store', () => ({
  analyzePerformancePatterns: vi.fn(),
}));

import {
  buildAdaptiveThresholdProposal,
  getActiveThresholds,
  persistAdaptiveThresholds,
  type AdaptiveThresholds,
} from './blog-bayesian-optimizer';

describe('blog bayesian optimizer persistence', () => {
  beforeEach(() => {
    const { maybeSingle, eq, select, updateEq, update, from } = mocks;
    vi.clearAllMocks();
    eq.mockReturnValue({ maybeSingle });
    select.mockReturnValue({ eq });
    update.mockReturnValue({ eq: updateEq });
    from.mockReturnValue({ select, update });
  });

  it('reads adaptive thresholds from the global policy meta object', async () => {
    const { maybeSingle, select, eq } = mocks;
    maybeSingle.mockResolvedValue({
      data: { meta: { adaptive_thresholds: { infoMinReadability: 82 } } },
      error: null,
    });

    await expect(getActiveThresholds()).resolves.toMatchObject({
      infoMinReadability: 82,
      productMinLen: 1200,
    });
    expect(select).toHaveBeenCalledWith('meta');
    expect(eq).toHaveBeenCalledWith('scope', 'global');
  });

  it('merges thresholds into policy meta and never writes legacy key/value columns', async () => {
    const { maybeSingle, updateEq, update } = mocks;
    maybeSingle.mockResolvedValue({
      data: { meta: { preserve_me: true } },
      error: null,
    });
    updateEq.mockResolvedValue({ error: null });
    const thresholds: AdaptiveThresholds = {
      infoMinLen: 2500,
      productMinLen: 1200,
      infoMaxCliche: 8,
      productMaxCliche: 2,
      infoMaxKeywordDensity: 1.8,
      productMaxKeywordDensity: 2.5,
      infoMinReadability: 75,
      productMinReadability: 65,
      rationale: 'test',
    };

    await persistAdaptiveThresholds(thresholds, {
      actorId: 'editor-1',
      approvedAt: '2026-08-25T00:00:00.000Z',
      reason: '검토된 학습 제안 승인',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        preserve_me: true,
        adaptive_thresholds: thresholds,
      }),
    }));
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty('key');
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty('value');
    expect(updateEq).toHaveBeenCalledWith('scope', 'global');
  });

  it('throws on write failure so blog-learn cannot report a false success', async () => {
    const { maybeSingle, updateEq } = mocks;
    maybeSingle.mockResolvedValue({ data: { meta: {} }, error: null });
    updateEq.mockResolvedValue({ error: { message: 'database unavailable' } });

    await expect(persistAdaptiveThresholds({} as AdaptiveThresholds, {
      actorId: 'editor-1',
      approvedAt: '2026-08-25T00:00:00.000Z',
      reason: 'test',
    }))
      .rejects.toThrow('adaptive_threshold_write_failed:database unavailable');
  });

  it('requires approval before any adaptive threshold write', async () => {
    await expect(persistAdaptiveThresholds({} as AdaptiveThresholds))
      .rejects.toThrow('adaptive_threshold_approval_required');
  });

  it('builds a proposal without changing the active value', () => {
    const current = { infoMinReadability: 70 } as AdaptiveThresholds;
    const proposed = { infoMinReadability: 75 } as AdaptiveThresholds;
    expect(buildAdaptiveThresholdProposal(current, proposed, {
      dataSufficient: false,
      generatedAt: '2026-08-25T00:00:00.000Z',
    })).toMatchObject({
      status: 'proposed',
      recommendedAction: 'human_review',
      dataSufficient: false,
      current,
      proposed,
    });
  });
});
