import { describe, expect, it } from 'vitest';
import { buildTechnologyScoutPilotReadiness } from './readiness';

describe('Technology Scout pilot readiness', () => {
  it('reports the offline contract gate and keeps live execution disabled', () => {
    const readiness = buildTechnologyScoutPilotReadiness({ generatedAt: '2026-09-04T00:00:00.000Z' });
    expect(readiness.canStartLivePilot).toBe(false);
    expect(readiness.gates.contractFixtures).toEqual({ state: 'pass', passed: 30, total: 30 });
    expect(readiness.gates.productionRunsMigration).toMatchObject({ applied: false, state: 'blocked' });
    expect(readiness.gates.liveAcceptance.state).toBe('blocked');
    expect(readiness.nextActions.length).toBeGreaterThanOrEqual(3);
  });

  it('removes only the protocol blocker after a positive attestation', () => {
    const readiness = buildTechnologyScoutPilotReadiness({
      protocolAttestation: {
        schemaVersion: 'technology-scout-protocol-attestation-v1',
        codexVersion: 'codex-cli test',
        generatedSchemaHash: `sha256:${'a'.repeat(64)}`,
        authMode: 'chatgpt',
        restrictedReadableRootsSupported: true,
        permissionProfileId: ':read-only',
        networkAccessDisabled: true,
        ephemeralThreadSupported: true,
        optionalCapabilitySurfacesDisabled: true,
        errorCode: null,
        checkedAt: '2026-09-04T00:00:00.000Z',
      },
    });
    expect(readiness.gates.protocolAttestation.state).toBe('pass');
    expect(readiness.gates.liveAcceptance.blockingCodes).not.toContain('CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED');
    expect(readiness.canStartLivePilot).toBe(false);
  });
});
