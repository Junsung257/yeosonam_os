import { describe, expect, it } from 'vitest';

import { evaluateEntityMasterCandidatePublicGate } from './entity-master-candidate-public-gate';

describe('evaluateEntityMasterCandidatePublicGate', () => {
  it('does not hard-block unresolved attraction candidates by themselves', () => {
    expect(evaluateEntityMasterCandidatePublicGate({
      category: 'attraction',
      promotion_status: 'needs_review',
      auto_action: 'needs_review',
    })).toMatchObject({
      unresolved: true,
      hardBlocker: false,
      warning: true,
      reason: 'unmatched_entity_candidate_without_customer_claim',
    });
  });

  it('hard-blocks unresolved customer disclosure candidates', () => {
    expect(evaluateEntityMasterCandidatePublicGate({
      category: 'optional_tour',
      promotion_status: 'needs_review',
      auto_action: 'needs_review',
    })).toMatchObject({
      unresolved: true,
      hardBlocker: true,
      warning: false,
      reason: 'customer_disclosure_candidate_requires_review',
    });
  });

  it('ignores resolved candidates', () => {
    expect(evaluateEntityMasterCandidatePublicGate({
      category: 'notice',
      promotion_status: 'rejected_noise',
    })).toMatchObject({
      unresolved: false,
      hardBlocker: false,
      warning: false,
    });
  });

  it('does not hard-block customer disclosure rows already classified as terminal non-master fragments', () => {
    expect(evaluateEntityMasterCandidatePublicGate({
      category: 'optional_tour',
      promotion_status: 'candidate',
      auto_action: 'structure_non_master',
      auto_verification_status: 'structured_non_master',
    })).toMatchObject({
      unresolved: false,
      hardBlocker: false,
      warning: false,
      reason: 'terminal_non_master_or_noise',
    });
  });
});
