import { describe, expect, it } from 'vitest';
import { buildBlogContentFactoryFunnelV4 } from './funnel';

describe('Blog V4 operations funnel', () => {
  it('derives stage counts from ledger evidence and indexing truth', () => {
    const result = buildBlogContentFactoryFunnelV4({
      demandClusterIds: ['d1', 'd2', 'd2'],
      operations: [
        { id: 'o1', currentStage: 'approved_for_slot', status: 'approved_for_slot', creativeId: 'c1' },
        { id: 'o2', currentStage: 'published', status: 'published', creativeId: 'c2' },
        { id: 'o3', currentStage: 'human_review', status: 'human_review', failureCode: 'high_risk_human_approval_required' },
      ],
      events: [
        { operationId: 'o1', stage: 'brief_verified', status: 'succeeded' },
        { operationId: 'o1', stage: 'research_ready', status: 'succeeded' },
        { operationId: 'o1', stage: 'drafting', status: 'started' },
        { operationId: 'o2', stage: 'repairing', status: 'succeeded' },
      ],
      indexedCreativeIds: ['c2'],
      dailyInventoryTarget: 3,
    });
    expect(result.counts).toEqual({
      demand: 2,
      verified_brief: 1,
      research_ready: 1,
      draft: 1,
      repairing: 1,
      human_review: 1,
      approved: 1,
      published: 1,
      indexed: 1,
    });
    expect(result.approvedInventoryDays).toBe(0.33);
    expect(result.skipReasons).toEqual({ high_risk_human_approval_required: 1 });
  });
});
