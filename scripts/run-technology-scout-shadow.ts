import { createHash, randomUUID } from 'node:crypto';
import { attestTechnologyScoutRuntime, TECHNOLOGY_SCOUT_SOURCE_FIXTURES, buildTechnologyScoutPublicArtifacts, buildTechnologyScoutTaskInput } from '../src/lib/agent/pilot';
import { createCodexAppServerStdioFactory, createCodexSubscriptionRuntimeAdapter, type RuntimeCapabilityClaims } from '../src/lib/agent/runtime';
import { getTaskDefinition } from '../src/lib/agent/contracts';

async function main() {
  const fixture = TECHNOLOGY_SCOUT_SOURCE_FIXTURES[0];
  const runId = randomUUID();
  const taskId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60_000);
  const task = getTaskDefinition('research.technology_scout');
  if (!task) throw new Error('Technology Scout task contract is missing');

  const artifacts = [...buildTechnologyScoutPublicArtifacts(fixture)];
  const capabilityClaims: RuntimeCapabilityClaims = {
  mode: 'shadow_read_only',
  runId,
  taskId,
  tenantId: null,
  roleKey: 'research.technology_scout',
  taskKey: 'research.technology_scout',
  dataClassification: 'public',
  issuedAt: now.toISOString(),
  expiresAt: expiresAt.toISOString(),
  readableRoots: [process.cwd()],
  };

  const adapter = createCodexSubscriptionRuntimeAdapter({
  connectionFactory: createCodexAppServerStdioFactory(),
  capabilityVerifier: { verify: async () => capabilityClaims },
  inputArtifactSource: { readPublicArtifacts: async () => artifacts },
  artifactSink: {
    persistShadowOutput: async ({ payload }) => {
      const outputHash = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
      return { outputArtifactRef: `local-shadow:${fixture.caseId.toLowerCase()}:${runId}`, outputHash };
    },
  },
  healthWorkspaceRoot: process.cwd(),
  model: process.env.CODEX_AGENT_OFFICE_MODEL ?? 'gpt-5.4-mini',
  });

  const attestation = await attestTechnologyScoutRuntime({ workspaceRoot: process.cwd() });
  if (!attestation.restrictedReadableRootsSupported) {
  process.stdout.write(`${JSON.stringify({ status: 'blocked', attestation }, null, 2)}\n`);
  process.exitCode = 2;
  } else {
    const result = await adapter.start({
    runId,
    taskId,
    tenantId: null,
    roleKey: 'research.technology_scout',
    roleVersion: '1.0.0',
    taskKey: 'research.technology_scout',
    taskContractVersion: '1.0.0',
    runtimeKey: 'codex_subscription_worker',
    runtimeVersion: '1.0.0',
    toolProfileKey: 'research.technology_scout_no_tools',
    toolProfileVersion: '1.0.0',
    inputArtifactRefs: artifacts.map((artifact) => artifact.artifactRef),
    taskInput: buildTechnologyScoutTaskInput(fixture),
    workspaceRoot: process.cwd(),
    capabilityToken: `local-shadow-${randomUUID()}`,
    budgets: task.budgets,
    });
    process.stdout.write(`${JSON.stringify({
    status: result.outcome,
    runId,
    caseId: fixture.caseId,
    errorCode: result.errorCode,
    usage: result.usage,
    outputArtifactRef: result.outputArtifactRef,
    }, null, 2)}\n`);
    if (result.outcome !== 'succeeded') process.exitCode = 1;
  }
}

void main();
