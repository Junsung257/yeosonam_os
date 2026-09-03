import { type NextRequest } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';

import { apiResponse } from '@/lib/api-response';
import {
  requirePlatformAdminRequest,
  resolveAdminActorLabel,
} from '@/lib/admin-guard';
import {
  createCodexAppServerStdioFactory,
  createCodexSubscriptionRuntimeAdapter,
  RuntimeCapabilityClaimsSchema,
  type RuntimeCapabilityClaims,
} from '@/lib/agent/runtime';
import {
  buildTechnologyScoutPublicArtifacts,
  TECHNOLOGY_SCOUT_SOURCE_FIXTURES,
} from '@/lib/agent/pilot/technology-scout-fixtures';
import {
  createTechnologyScoutShadowPilotDependencies,
  createShadowOutputRef,
  hashShadowPayload,
  resolveTechnologyScoutShadowPilotEnvironment,
  runTechnologyScoutShadowPilot,
} from '@/lib/agent/pilot/technology-scout-shadow';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fixtureIds: ReadonlySet<string> = new Set(TECHNOLOGY_SCOUT_SOURCE_FIXTURES.map((fixture) => fixture.caseId));

function blockedResponse(code: string, message: string, status = 403) {
  return apiResponse({ code, error: message }, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function safeRecentRow(row: Record<string, unknown>) {
  const result = row.result_payload && typeof row.result_payload === 'object'
    ? row.result_payload as Record<string, unknown>
    : null;
  const payload = result?.payload && typeof result.payload === 'object'
    ? result.payload as Record<string, unknown>
    : null;
  const project = payload?.project && typeof payload.project === 'object'
    ? payload.project as Record<string, unknown>
    : null;
  return {
    taskId: typeof row.id === 'string' ? row.id : null,
    caseId: typeof result?.caseId === 'string' ? result.caseId : null,
    status: typeof row.status === 'string' ? row.status : 'unknown',
    shadowOnly: result?.shadowOnly === true,
    decision: typeof payload?.decision === 'string' ? payload.decision : null,
    projectName: typeof project?.name === 'string' ? project.name : null,
    outputHash: typeof result?.outputHash === 'string' ? result.outputHash : null,
    errorCode: typeof row.last_error === 'string' ? row.last_error : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;
  const environment = resolveTechnologyScoutShadowPilotEnvironment();
  const admin = getSupabaseAdmin();
  if (!admin || !isSupabaseAdminConfigured) {
    return blockedResponse('SHADOW_PILOT_DATABASE_UNAVAILABLE', 'Preview Supabase가 구성되지 않았습니다.', 503);
  }
  const { data, error } = await admin
    .from('agent_tasks')
    .select('id, status, result_payload, last_error, updated_at')
    .eq('specialist_id', 'research.technology_scout')
    .order('updated_at', { ascending: false })
    .limit(12);
  if (error) {
    return blockedResponse('AGENT_TASKS_UNAVAILABLE', 'Technology Scout 작업 원장을 읽지 못했습니다.', 503);
  }
  return apiResponse({
    execution: environment,
    recentCases: (data ?? []).map((row) => safeRecentRow(row as Record<string, unknown>)),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function hasShadowRunMigration(): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin || !isSupabaseAdminConfigured) return false;
  const { error } = await admin.from('agent_runs').select('id').limit(1);
  return !error;
}

export async function POST(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;

  const environment = resolveTechnologyScoutShadowPilotEnvironment();
  if (!environment.enabled) {
    return blockedResponse(
      environment.code,
      environment.mode === 'production'
        ? 'Production에서는 Technology Scout 실행을 영구적으로 차단합니다.'
        : 'Preview 또는 로컬에서 AGENT_OFFICE_SHADOW_PILOT_ENABLED=1일 때만 실행할 수 있습니다.',
    );
  }
  if (!isSupabaseAdminConfigured || !getSupabaseAdmin()) {
    return blockedResponse('SHADOW_PILOT_DATABASE_UNAVAILABLE', 'Preview Supabase가 구성되지 않았습니다.', 503);
  }
  if (!await hasShadowRunMigration()) {
    return blockedResponse(
      'AGENT_RUN_MIGRATION_NOT_APPLIED',
      'agent_runs Shadow migration이 Preview에 적용되지 않아 실행을 잠갔습니다.',
      409,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return blockedResponse('SHADOW_PILOT_REQUEST_INVALID', 'JSON 요청 본문이 필요합니다.', 422);
  }
  const caseId = typeof body === 'object' && body !== null && 'caseId' in body
    ? (body as { caseId?: unknown }).caseId
    : undefined;
  if (typeof caseId !== 'string' || !fixtureIds.has(caseId)) {
    return blockedResponse('TECHNOLOGY_SCOUT_CASE_NOT_FOUND', '허용된 Technology Scout fixture caseId가 필요합니다.', 422);
  }

  const actorLabel = await resolveAdminActorLabel(request);
  // agent_runs intentionally stores an opaque, constraint-safe actor id. The
  // human label is not copied into the shadow trace or task payload.
  const actorId = `admin:${createHash('sha256').update(actorLabel, 'utf8').digest('hex').slice(0, 32)}`;
  const actorSessionId = `office-shadow-session:${randomUUID()}`;
  const workspaceRoot = process.env.AGENT_OFFICE_SHADOW_WORKSPACE_ROOT?.trim() || process.cwd();
  const model = process.env.CODEX_AGENT_OFFICE_MODEL?.trim() || 'gpt-5.4-mini';
  const capabilities = new Map<string, RuntimeCapabilityClaims>();
  const outputPayloads = new Map<string, unknown>();
  const artifactsByRef = new Map(
    TECHNOLOGY_SCOUT_SOURCE_FIXTURES.flatMap((fixture) => buildTechnologyScoutPublicArtifacts(fixture))
      .map((artifact) => [artifact.artifactRef, artifact] as const),
  );

  const runtime = createCodexSubscriptionRuntimeAdapter({
    connectionFactory: createCodexAppServerStdioFactory(),
    capabilityVerifier: {
      verify: async ({ capabilityToken, runId, taskId, tenantId }) => {
        const claims = capabilities.get(capabilityToken);
        if (!claims || claims.runId !== runId || claims.taskId !== taskId || claims.tenantId !== tenantId) {
          throw new Error('RUNTIME_CAPABILITY_TOKEN_MISMATCH');
        }
        return RuntimeCapabilityClaimsSchema.parse(claims);
      },
    },
    inputArtifactSource: {
      readPublicArtifacts: async ({ artifactRefs }) => artifactRefs.map((ref) => {
        const artifact = artifactsByRef.get(ref);
        if (!artifact) throw new Error('RUNTIME_INPUT_ARTIFACT_NOT_ALLOWLISTED');
        return artifact;
      }),
    },
    artifactSink: {
      persistShadowOutput: async ({ runId, taskId, payload }) => {
        outputPayloads.set(runId, payload);
        return {
          outputArtifactRef: createShadowOutputRef(taskId, runId),
          outputHash: hashShadowPayload(payload),
        };
      },
    },
    healthWorkspaceRoot: workspaceRoot,
    model,
  });

  const health = await runtime.health();
  if (health.status !== 'healthy') {
    return blockedResponse('RUNTIME_UNAVAILABLE', 'Preview Codex read-only Runtime을 확인하지 못했습니다.', 503);
  }

  const dependencies = createTechnologyScoutShadowPilotDependencies({
    runtime,
    registerCapability: ({ token, claims }) => capabilities.set(token, claims),
    getOutputPayload: (runId) => outputPayloads.get(runId) ?? null,
  });
  if (!dependencies) {
    return blockedResponse('SHADOW_PILOT_DATABASE_UNAVAILABLE', 'Preview 서비스 자격 증명을 확인하지 못했습니다.', 503);
  }

  const result = await runTechnologyScoutShadowPilot({
    caseId: caseId as `TS-${string}`,
    actorId,
    actorSessionId,
    workspaceRoot,
    model,
  }, { ...dependencies, environment });

  return apiResponse({
    ...result,
    executionMode: 'shadow_read_only',
    productionAccess: false,
    commandAccess: false,
    externalWrites: false,
  }, {
    status: result.status === 'succeeded' || result.status === 'duplicate' ? 200 : 422,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
