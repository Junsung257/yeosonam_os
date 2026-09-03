import { describe, expect, it } from 'vitest';

import { getAgentOfficeReadiness } from './agent-office-readiness';

describe('AI Office readiness', () => {
  it('attests the Foundation scope as shadow-only and non-mutating', () => {
    const readiness = getAgentOfficeReadiness();

    expect(readiness).toMatchObject({
      route: '/admin/agent-mas',
      phase: 'foundation-shadow',
      label: 'Foundation · Shadow 읽기 전용',
      canWrite: false,
      autonomousLoop: false,
      productionCommandCount: 0,
      externalInstallCount: 0,
      technologyScout: {
        roleKey: 'research.technology_scout',
        taskKey: 'research.technology_scout',
        runtimeKey: 'codex_subscription_worker',
        permissionProfile: ':read-only',
        executionEnabled: false,
      },
    });
  });
});
