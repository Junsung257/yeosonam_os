import { describe, expect, it } from 'vitest';
import { decideExternalPublishStaging } from './ad-os-v161-v180';

describe('Ad OS V161-V180 external publish staging', () => {
  it('does not mark approved external requests applied when no external write happened', () => {
    const decision = decideExternalPublishStaging({
      apply: true,
      canPublish: true,
      requests: [{ id: 'cr-1' }, { id: 'cr-2' }],
      externalApiWrite: false,
    });

    expect(decision.can_stage_for_executor).toBe(true);
    expect(decision.staged_request_ids).toEqual(['cr-1', 'cr-2']);
    expect(decision.mark_change_request_applied).toBe(false);
    expect(decision.applied_request_ids).toEqual([]);
    expect(decision.external_api_write).toBe(false);
    expect(decision.blockers).toContain('external_api_write_not_performed');
  });

  it('keeps dry-run requests unstaged', () => {
    const decision = decideExternalPublishStaging({
      apply: false,
      canPublish: true,
      requests: [{ id: 'cr-1' }],
      externalApiWrite: false,
    });

    expect(decision.can_stage_for_executor).toBe(false);
    expect(decision.staged_request_ids).toEqual([]);
    expect(decision.blockers).toContain('dry_run_only');
  });

  it('requires explicit external result confirmation before applying a request', () => {
    const unconfirmed = decideExternalPublishStaging({
      apply: true,
      canPublish: true,
      requests: [{ id: 'cr-1' }],
      externalApiWrite: true,
    });
    const confirmed = decideExternalPublishStaging({
      apply: true,
      canPublish: true,
      requests: [{ id: 'cr-1' }],
      externalApiWrite: true,
      confirmExternalResult: true,
    });

    expect(unconfirmed.mark_change_request_applied).toBe(false);
    expect(unconfirmed.blockers).toContain('external_result_confirmation_required');
    expect(confirmed.mark_change_request_applied).toBe(true);
    expect(confirmed.applied_request_ids).toEqual(['cr-1']);
  });
});
