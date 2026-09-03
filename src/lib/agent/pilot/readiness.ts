import {
  buildTechnologyScoutFoundationPreflightReport,
  type TechnologyScoutProtocolAttestationV1,
} from './technology-scout-eval';

export type PilotGateState = 'pass' | 'blocked' | 'not_checked';

export type TechnologyScoutPilotReadiness = {
  schemaVersion: 'technology-scout-pilot-readiness-v1';
  generatedAt: string;
  canStartLivePilot: false;
  gates: {
    contractFixtures: { state: 'pass'; passed: number; total: number } | { state: 'blocked'; passed: number; total: number };
    protocolAttestation: {
      state: PilotGateState;
      restrictedReadableRootsSupported: boolean;
      codexVersion: string | null;
      checkedAt: string | null;
      errorCode: string | null;
    };
    productionRunsMigration: {
      state: 'blocked';
      applied: false;
      reason: 'PRODUCTION_AGENT_RUNS_MIGRATION_NOT_APPROVED';
    };
    liveAcceptance: {
      state: 'blocked';
      blockingCodes: readonly string[];
    };
  };
  nextActions: readonly string[];
  /** Runtime availability is reported by the API route; the pure projection has no environment access. */
  execution?: {
    mode: 'production' | 'preview' | 'local';
    enabled: boolean;
    code: string;
  };
};

/** Pure, non-I/O readiness projection for the operator surface. */
export function buildTechnologyScoutPilotReadiness(options?: {
  protocolAttestation?: TechnologyScoutProtocolAttestationV1 | null;
  generatedAt?: string;
}): TechnologyScoutPilotReadiness {
  const report = buildTechnologyScoutFoundationPreflightReport();
  const attestation = options?.protocolAttestation ?? null;
  const contractPassed = report.evidence.contractFixturesPassed;
  const contractTotal = report.evidence.contractFixturesTotal;
  const protocolState: PilotGateState = attestation
    ? attestation.restrictedReadableRootsSupported ? 'pass' : 'blocked'
    : 'not_checked';
  const blockingCodes = [...report.acceptance.blockingCodes];
  if (attestation?.restrictedReadableRootsSupported) {
    const index = blockingCodes.indexOf('CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED');
    if (index >= 0) blockingCodes.splice(index, 1);
  }
  return Object.freeze({
    schemaVersion: 'technology-scout-pilot-readiness-v1' as const,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    canStartLivePilot: false as const,
    gates: {
      contractFixtures: {
        state: contractPassed === contractTotal ? 'pass' as const : 'blocked' as const,
        passed: contractPassed,
        total: contractTotal,
      },
      protocolAttestation: {
        state: protocolState,
        restrictedReadableRootsSupported: attestation?.restrictedReadableRootsSupported ?? false,
        codexVersion: attestation?.codexVersion ?? null,
        checkedAt: attestation?.checkedAt ?? null,
        errorCode: attestation?.errorCode ?? null,
      },
      productionRunsMigration: {
        state: 'blocked' as const,
        applied: false as const,
        reason: 'PRODUCTION_AGENT_RUNS_MIGRATION_NOT_APPROVED' as const,
      },
      liveAcceptance: {
        state: 'blocked' as const,
        blockingCodes: Object.freeze(blockingCodes),
      },
    },
    nextActions: Object.freeze([
      '로컬 격리 환경에서 npm run attest:technology-scout-runtime 실행',
      '공식 출처 20건 이상을 3회 독립 실행하고 사람 검토 영수증을 저장',
      'agent_runs Preview 마이그레이션 검증 후 Production 적용을 별도 승인',
    ]),
  });
}
