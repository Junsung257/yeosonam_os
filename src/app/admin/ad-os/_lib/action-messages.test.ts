import { describe, expect, it } from 'vitest';
import {
  buildGuardedApplyMessage,
  buildPilotSetupMessage,
  buildPublishDraftsMessage,
  formatAdOsBlockers,
  formatAdOsNumber,
} from './action-messages';

describe('Ad OS action messages', () => {
  it('formats shared numbers and blocker lists', () => {
    expect(formatAdOsNumber(1234567)).toBe('1,234,567');
    expect(formatAdOsBlockers(['missing_policy', 'blocked_risk'])).toBe('missing_policy, blocked_risk');
    expect(formatAdOsBlockers([])).toBe('none');
    expect(formatAdOsBlockers(null)).toBe('none');
  });

  it('formats guarded apply summary counts', () => {
    expect(buildGuardedApplyMessage({
      summary: {
        applied_count: 1234,
        start_test_candidates: 56,
        blocked_by_guardrail: 7,
      },
    })).toBe('Guarded apply complete: applied 1,234 test candidates 56 blocked 7');
  });

  it('formats pilot setup summary counts', () => {
    expect(buildPilotSetupMessage({
      summary: {
        budget_channels_configured: 2,
        naver_keywords_approved: 30,
        internal_campaigns_created: 4,
        internal_creatives_created: 8,
      },
    })).toBe('Pilot setup complete: budget channels 2 naver keywords 30 campaigns 4 creatives 8 external spend 0');
  });

  it('formats publish draft summary counts', () => {
    expect(buildPublishDraftsMessage({
      summary: {
        created_campaigns: 3,
        created_creatives: 12,
        linked_keywords: 3456,
        blocked_groups: 1,
      },
    })).toBe('Publish drafts complete: created campaigns 3 created creatives 12 linked keywords 3,456 blocked groups 1');
  });
});
