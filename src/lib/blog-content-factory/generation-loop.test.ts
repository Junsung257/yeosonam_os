import { describe, expect, it } from 'vitest';

import { decideBlogContentGenerationPassV4 } from './generation-loop';

describe('Blog V4 durable generation pass routing', () => {
  it('continues queued DeepSeek repair passes through pass five', () => {
    for (const completedPasses of [1, 2, 3, 4]) {
      expect(decideBlogContentGenerationPassV4({ status: 'rewrite_queued', completedPasses }))
        .toBe('continue');
    }
    expect(decideBlogContentGenerationPassV4({ status: 'rewrite_queued', completedPasses: 5 }))
      .toBe('finalize');
  });

  it('retries time-budget deferrals without consuming a model pass', () => {
    expect(decideBlogContentGenerationPassV4({ status: 'deferred_buffer', completedPasses: 2 }))
      .toBe('retry');
    expect(decideBlogContentGenerationPassV4({ status: 'deferred_time_budget', completedPasses: 2 }))
      .toBe('retry');
  });

  it('finalizes approved, review, and hard-failure results', () => {
    for (const status of ['approved_for_slot', 'pending_review', 'human_review', 'quarantined', 'error']) {
      expect(decideBlogContentGenerationPassV4({ status, completedPasses: 1 })).toBe('finalize');
    }
  });
});
