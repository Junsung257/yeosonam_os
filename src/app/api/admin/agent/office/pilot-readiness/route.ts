import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requirePlatformAdminRequest } from '@/lib/admin-guard';
import { resolveTechnologyScoutShadowPilotEnvironment } from '@/lib/agent/pilot/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hostedReadiness() {
  return {
    schemaVersion: 'technology-scout-pilot-readiness-v1' as const,
    generatedAt: new Date().toISOString(),
    canStartLivePilot: false as const,
    gates: {
      contractFixtures: { state: 'pass' as const, passed: 30, total: 30 },
      protocolAttestation: {
        state: 'not_checked' as const,
        restrictedReadableRootsSupported: false,
        codexVersion: null,
        checkedAt: null,
        errorCode: 'CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED',
      },
      productionRunsMigration: {
        state: 'blocked' as const,
        applied: false as const,
        reason: 'PRODUCTION_AGENT_RUNS_MIGRATION_NOT_APPROVED' as const,
      },
      liveAcceptance: {
        state: 'blocked' as const,
        blockingCodes: [
          'OFFICIAL_SOURCE_CASES_BELOW_20',
          'LIVE_RESEARCH_CASES_BELOW_20',
          'IDENTICAL_INPUT_TRIALS_BELOW_3',
          'LIVE_RESULTS_NOT_FULLY_REPRODUCIBLE',
          'LIVE_RESULT_EVIDENCE_INCOMPLETE',
          'HUMAN_REVIEW_EVIDENCE_INCOMPLETE',
          'CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED',
        ] as const,
      },
    },
    nextActions: [
      '로컬 격리 환경에서 npm run attest:technology-scout-runtime 실행',
      '공식 출처 20건 이상을 3회 독립 실행하고 사람 검토 영수증을 저장',
      'agent_runs Preview 마이그레이션 검증 후 Production 적용을 별도 승인',
    ] as const,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;

  // Live process attestation is intentionally local/preview-only. Production
  // must not spawn a subscription worker from a dashboard read request.
  const response = apiResponse({
    ...hostedReadiness(),
    execution: resolveTechnologyScoutShadowPilotEnvironment(),
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
