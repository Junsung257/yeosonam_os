import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  ROLE_OPERATIONAL_BINDINGS,
  getTaskDefinition,
} from '@/lib/agent/contracts';

import {
  buildCodexAppServerArguments,
  buildCodexWorkerEnvironment,
  createCodexSubscriptionRuntimeAdapter,
  createExistingProviderPolicyAdapter,
  type CodexAppServerConnection,
  type CodexAppServerConnectionFactory,
  type CodexAppServerMessage,
  type RuntimeCapabilityClaims,
  type RuntimeStartInput,
} from './index';

const NOW = '2026-09-03T03:00:00.000Z';
const EXPIRES_AT = '2026-09-03T03:15:00.000Z';
const SHA = `sha256:${'a'.repeat(64)}`;
const PUBLIC_EVIDENCE = 'Official repository evidence captured for the bounded fixture.';
const PUBLIC_EVIDENCE_HASH = 'sha256:540bc9e652424c2826ce3de1391cd9dc31543656f8226c106e25cd300517ed74';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const WORKSPACE_ROOT = process.cwd();

const RADAR_ENTRY = {
  schemaVersion: 'technology-radar-entry-v1',
  project: {
    name: 'Example Project',
    canonicalUrl: 'https://github.com/example/project',
    revision: 'abcdef1234567890',
    release: 'v1.0.0',
    releaseDate: '2026-09-01',
  },
  problemFit: {
    yeosonamProblem: 'One bounded runtime gap.',
    existingOverlap: ['Existing Agent Office contracts'],
    uniqueCapability: ['One read-only capability'],
    switchingCost: ['Requires an isolated pilot'],
  },
  supplyChain: {
    licenseClass: 'permissive',
    licenseEvidenceRefs: ['evidence:license'],
    installSurfaces: [],
    secretNames: [],
    networkHosts: [],
    binaryOrHookRisk: [],
    dataHandling: ['Public evidence only'],
  },
  evidence: [{
    claim: 'The official repository exists.',
    sourceUrl: 'https://github.com/example/project',
    sourceType: 'official_repository',
    retrievedAt: NOW,
    supportsDecision: true,
  }],
  decision: 'ASSESS',
  decisionReason: 'More isolated evaluation is required.',
  safePrototype: {
    allowed: false,
    isolation: [],
    successMetrics: [],
    stopConditions: [],
  },
  unknowns: ['Maintenance evidence is incomplete.'],
  confidence: 0.75,
} as const;

function taskInput() {
  return {
    schemaVersion: 'technology-scout-task-input-v1',
    caseId: 'TS-001',
    observedClaim: 'A public claim about one open-source project.',
    officialProjectUrl: 'https://github.com/example/project',
    officialDocsUrls: ['https://example.com/docs'],
    evaluationQuestion: 'Should Yeosonam assess this project?',
    yeosonamProblemRef: 'agent-office.runtime-gap',
    asOf: NOW,
    objective: {
      schemaVersion: 'task-objective-v1',
      officeObjective: 'Assess one public technology candidate.',
      expectedOutcome: 'A review-only Technology Radar candidate.',
      stopConditions: ['Stop if official evidence is missing.'],
    },
    businessIdempotencyKey: 'technology-scout:TS-001:2026-09-03',
  } as const;
}

function validStartInput(): RuntimeStartInput {
  const task = getTaskDefinition('research.technology_scout');
  if (!task) throw new Error('test contract missing');
  return {
    runId: RUN_ID,
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    roleKey: 'research.technology_scout',
    roleVersion: '1.0.0',
    taskKey: 'research.technology_scout',
    taskContractVersion: '1.0.0',
    runtimeKey: 'codex_subscription_worker',
    runtimeVersion: '1.0.0',
    toolProfileKey: 'research.technology_scout_no_tools',
    toolProfileVersion: '1.0.0',
    inputArtifactRefs: ['evidence:public-bundle-1'],
    taskInput: taskInput(),
    workspaceRoot: WORKSPACE_ROOT,
    capabilityToken: 'capability-token-that-never-leaves-the-host',
    budgets: { ...task.budgets },
  };
}

function validClaims(overrides: Partial<RuntimeCapabilityClaims> = {}): RuntimeCapabilityClaims {
  return {
    mode: 'shadow_read_only',
    runId: RUN_ID,
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    roleKey: 'research.technology_scout',
    taskKey: 'research.technology_scout',
    dataClassification: 'public',
    issuedAt: NOW,
    expiresAt: EXPIRES_AT,
    readableRoots: [WORKSPACE_ROOT],
    ...overrides,
  };
}

class FakeConnection implements CodexAppServerConnection {
  readonly messages: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(message: CodexAppServerMessage) => void>();
  accountType: 'chatgpt' | 'apiKey' = 'chatgpt';
  turnMode: 'success' | 'unsafe' | 'pending' | 'server_request' | 'foreign_event' | 'unknown_item' = 'success';
  inputTokens = 120;
  outputTokens = 80;
  closed = false;

  async request(method: string, params: unknown): Promise<unknown> {
    this.messages.push({ method, params });
    if (method === 'initialize') return { userAgent: 'fake' };
    if (method === 'account/read') {
      return { account: { type: this.accountType }, requiresOpenaiAuth: true };
    }
    if (method === 'thread/start') return { thread: { id: 'thread-1', ephemeral: true } };
    if (method === 'turn/start') {
      setTimeout(() => {
        if (this.turnMode === 'unsafe') {
          this.emit({
            method: 'item/started',
            params: { item: { type: 'commandExecution', id: 'item-1' }, threadId: 'thread-1', turnId: 'turn-1' },
          });
          this.emit({
            method: 'turn/completed',
            params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
          });
        } else if (this.turnMode === 'server_request') {
          this.emit({ id: 99, method: 'future/write/request', params: { threadId: 'thread-1', turnId: 'turn-1' } });
          this.emit({
            method: 'turn/completed',
            params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
          });
        } else if (this.turnMode === 'foreign_event') {
          this.emit({
            method: 'item/completed',
            params: {
              item: { type: 'agentMessage', text: JSON.stringify(RADAR_ENTRY), phase: 'final_answer' },
              threadId: 'thread-other',
              turnId: 'turn-other',
            },
          });
          this.emit({
            method: 'turn/completed',
            params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
          });
        } else if (this.turnMode === 'unknown_item') {
          this.emit({
            method: 'item/started',
            params: { item: { type: 'futureCapability' }, threadId: 'thread-1', turnId: 'turn-1' },
          });
          this.emit({
            method: 'turn/completed',
            params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
          });
        } else if (this.turnMode === 'success') {
          this.emit({
            method: 'thread/tokenUsage/updated',
            params: {
              tokenUsage: { last: { inputTokens: this.inputTokens, outputTokens: this.outputTokens } },
              threadId: 'thread-1',
              turnId: 'turn-1',
            },
          });
          this.emit({
            method: 'item/completed',
            params: {
              item: { type: 'agentMessage', text: JSON.stringify(RADAR_ENTRY), phase: 'final_answer' },
              threadId: 'thread-1',
              turnId: 'turn-1',
            },
          });
          this.emit({
            method: 'turn/completed',
            params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
          });
        }
      }, 0);
      return { turn: { id: 'turn-1', status: 'inProgress' } };
    }
    if (method === 'turn/interrupt') {
      if (this.turnMode === 'pending') {
        setTimeout(() => this.emit({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
        }), 0);
      }
      return {};
    }
    throw new Error(`unexpected fake method ${method}`);
  }

  notify(method: string, params: unknown): void {
    this.messages.push({ method, params });
  }

  subscribe(listener: (message: CodexAppServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emit(message: CodexAppServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
}

function adapterFixture(connection = new FakeConnection(), claims = validClaims()) {
  const factory: CodexAppServerConnectionFactory = {
    open: vi.fn(async () => connection),
  };
  const verify = vi.fn(async () => claims);
  const readPublicArtifacts = vi.fn(async () => [{
    artifactRef: 'evidence:public-bundle-1',
    contentHash: PUBLIC_EVIDENCE_HASH,
    dataClassification: 'public' as const,
    content: PUBLIC_EVIDENCE,
  }]);
  const persistShadowOutput = vi.fn(async () => ({
    outputArtifactRef: 'artifact:technology-radar-1',
    outputHash: SHA,
  }));
  const adapter = createCodexSubscriptionRuntimeAdapter({
    connectionFactory: factory,
    capabilityVerifier: { verify },
    inputArtifactSource: { readPublicArtifacts },
    artifactSink: { persistShadowOutput },
    healthWorkspaceRoot: WORKSPACE_ROOT,
    model: 'gpt-test-codex',
    now: () => new Date(NOW),
  });
  return { adapter, connection, verify, readPublicArtifacts, persistShadowOutput };
}

describe('PR-01C Codex App Server boundary', () => {
  it('sanitizes the child environment and disables optional capability surfaces', () => {
    const env = buildCodexWorkerEnvironment({
      PATH: 'safe-path',
      USERPROFILE: 'safe-profile',
      SUPABASE_SERVICE_ROLE_KEY: 'forbidden',
      OPENAI_API_KEY: 'forbidden',
      DEEPSEEK_API_KEY: 'forbidden',
      VERCEL_TOKEN: 'forbidden',
    });
    expect(env).toEqual({ PATH: 'safe-path', USERPROFILE: 'safe-profile' });

    const args = buildCodexAppServerArguments();
    expect(args.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://']);
    expect(args).toContain('mcp_servers={}');
    expect(args).not.toContain('--enable');
    for (const feature of ['apps', 'plugins', 'hooks', 'skill_search', 'multi_agent', 'shell_tool']) {
      expect(args).toContain(feature);
    }
  });

  it('accepts only ChatGPT subscription auth during health checks', async () => {
    const healthy = adapterFixture();
    await expect(healthy.adapter.health()).resolves.toMatchObject({
      status: 'healthy',
      detailCode: 'CHATGPT_SUBSCRIPTION_READY',
    });
    expect(healthy.connection.closed).toBe(true);

    const apiConnection = new FakeConnection();
    apiConnection.accountType = 'apiKey';
    await expect(adapterFixture(apiConnection).adapter.health()).resolves.toMatchObject({
      status: 'unavailable',
      detailCode: 'RUNTIME_UNAVAILABLE',
    });
  });

  it('uses ephemeral, read-only, no-network execution and returns schema-checked output', async () => {
    const fixture = adapterFixture();
    const result = await fixture.adapter.start(validStartInput());

    expect(result).toMatchObject({
      outcome: 'succeeded',
      providerKey: null,
      modelKey: 'gpt-test-codex',
      outputArtifactRef: 'artifact:technology-radar-1',
      outputHash: SHA,
      usage: { inputTokens: 120, outputTokens: 80, toolCalls: 0 },
    });
    expect(fixture.persistShadowOutput).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      tenantId: TENANT_ID,
      payload: RADAR_ENTRY,
    }));
    expect(fixture.readPublicArtifacts).toHaveBeenCalledWith({
      runId: RUN_ID,
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      artifactRefs: ['evidence:public-bundle-1'],
    });

    const threadStart = fixture.connection.messages.find((message) => message.method === 'thread/start');
    const turnStart = fixture.connection.messages.find((message) => message.method === 'turn/start');
    expect(threadStart?.params).toMatchObject({
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    expect(turnStart?.params).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'readOnly',
        networkAccess: false,
        access: { type: 'restricted', readableRoots: [WORKSPACE_ROOT] },
      },
    });
    expect(JSON.stringify(fixture.connection.messages)).not.toContain(validStartInput().capabilityToken);
    expect(ROLE_OPERATIONAL_BINDINGS['research.technology_scout']).toMatchObject({
      state: 'contract_only',
      executionEnabled: false,
    });
  });

  it('fails closed on any Tool activity and never persists the output', async () => {
    const connection = new FakeConnection();
    connection.turnMode = 'unsafe';
    const fixture = adapterFixture(connection);
    await expect(fixture.adapter.start(validStartInput())).resolves.toMatchObject({
      outcome: 'failed',
      errorCode: 'RUNTIME_TOOL_ACTIVITY_FORBIDDEN',
    });
    expect(connection.messages.some((message) => message.method === 'turn/interrupt')).toBe(true);
    expect(fixture.persistShadowOutput).not.toHaveBeenCalled();

    const unknownConnection = new FakeConnection();
    unknownConnection.turnMode = 'unknown_item';
    const unknownFixture = adapterFixture(unknownConnection);
    await expect(unknownFixture.adapter.start(validStartInput())).resolves.toMatchObject({
      outcome: 'failed',
      errorCode: 'RUNTIME_TOOL_ACTIVITY_FORBIDDEN',
    });
    expect(unknownFixture.persistShadowOutput).not.toHaveBeenCalled();
  });

  it('fails closed on unknown server requests and foreign turn events', async () => {
    const requestConnection = new FakeConnection();
    requestConnection.turnMode = 'server_request';
    const requestFixture = adapterFixture(requestConnection);
    await expect(requestFixture.adapter.start(validStartInput())).resolves.toMatchObject({
      outcome: 'failed',
      errorCode: 'RUNTIME_SERVER_REQUEST_FORBIDDEN',
    });
    expect(requestFixture.persistShadowOutput).not.toHaveBeenCalled();

    const foreignConnection = new FakeConnection();
    foreignConnection.turnMode = 'foreign_event';
    const foreignFixture = adapterFixture(foreignConnection);
    await expect(foreignFixture.adapter.start(validStartInput())).resolves.toMatchObject({
      outcome: 'failed',
      errorCode: 'RUNTIME_EVENT_SCOPE_MISMATCH',
    });
    expect(foreignFixture.persistShadowOutput).not.toHaveBeenCalled();
  });

  it('interrupts output that exceeds the registered token budget', async () => {
    const connection = new FakeConnection();
    connection.outputTokens = 12_001;
    const fixture = adapterFixture(connection);
    await expect(fixture.adapter.start(validStartInput())).resolves.toMatchObject({
      outcome: 'failed',
      errorCode: 'RUNTIME_TOKEN_BUDGET_EXCEEDED',
    });
    expect(connection.messages.some((message) => message.method === 'turn/interrupt')).toBe(true);
    expect(fixture.persistShadowOutput).not.toHaveBeenCalled();
  });

  it('binds capabilities to the exact tenant and rejects overlong TTLs', async () => {
    const wrongTenant = adapterFixture(new FakeConnection(), validClaims({ tenantId: null }));
    await expect(wrongTenant.adapter.start(validStartInput())).rejects.toMatchObject({
      code: 'RUNTIME_CAPABILITY_BOUNDARY_VIOLATION',
    });

    const longTtl = adapterFixture(new FakeConnection(), validClaims({
      expiresAt: '2026-09-03T03:15:00.001Z',
    }));
    await expect(longTtl.adapter.start(validStartInput())).rejects.toMatchObject({
      code: 'RUNTIME_CAPABILITY_BOUNDARY_VIOLATION',
    });
  });

  it('normalizes capability verifier and artifact sink failures', async () => {
    const verifierFailure = adapterFixture();
    verifierFailure.verify.mockRejectedValueOnce(new Error('secret verifier detail'));
    await expect(verifierFailure.adapter.start(validStartInput())).rejects.toMatchObject({
      code: 'RUNTIME_CAPABILITY_VERIFICATION_FAILED',
    });

    const sinkFailure = adapterFixture();
    sinkFailure.persistShadowOutput.mockRejectedValueOnce(new Error('storage detail'));
    await expect(sinkFailure.adapter.start(validStartInput())).resolves.toMatchObject({
      outcome: 'failed',
      errorCode: 'RUNTIME_ARTIFACT_PERSIST_FAILED',
    });
  });

  it('rejects workspace roots outside the verifier grant', async () => {
    const fixture = adapterFixture(new FakeConnection(), validClaims({
      readableRoots: [resolve('docs')],
    }));
    const input = validStartInput();
    input.workspaceRoot = resolve('src');
    await expect(fixture.adapter.start(input)).rejects.toMatchObject({ code: 'RUNTIME_WORKSPACE_NOT_GRANTED' });
  });

  it('rejects input artifact substitution before opening App Server', async () => {
    const fixture = adapterFixture();
    fixture.readPublicArtifacts.mockResolvedValueOnce([{
      artifactRef: 'evidence:different-bundle',
      contentHash: PUBLIC_EVIDENCE_HASH,
      dataClassification: 'public',
      content: PUBLIC_EVIDENCE,
    }]);
    await expect(fixture.adapter.start(validStartInput())).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_ARTIFACT_SET_MISMATCH',
    });
    expect(fixture.connection.messages).toEqual([]);
  });

  it('rejects input artifact hash drift before opening App Server', async () => {
    const fixture = adapterFixture();
    fixture.readPublicArtifacts.mockResolvedValueOnce([{
      artifactRef: 'evidence:public-bundle-1',
      contentHash: SHA,
      dataClassification: 'public',
      content: PUBLIC_EVIDENCE,
    }]);
    await expect(fixture.adapter.start(validStartInput())).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_ARTIFACT_HASH_MISMATCH',
    });
    expect(fixture.connection.messages).toEqual([]);
  });

  it('interrupts only the active Runtime turn and never mutates Task state', async () => {
    const connection = new FakeConnection();
    connection.turnMode = 'pending';
    const fixture = adapterFixture(connection);
    const startPromise = fixture.adapter.start(validStartInput());
    await vi.waitFor(() => {
      expect(connection.messages.some((message) => message.method === 'turn/start')).toBe(true);
    });
    await expect(fixture.adapter.start(validStartInput())).rejects.toMatchObject({
      code: 'RUNTIME_DUPLICATE_RUN_START',
    });
    await expect(fixture.adapter.cancel?.(RUN_ID)).resolves.toEqual({
      runId: RUN_ID,
      outcome: 'interrupt_requested',
      errorCode: null,
    });
    await expect(startPromise).resolves.toMatchObject({ outcome: 'cancelled' });
    await expect(fixture.adapter.cancel?.('missing-run')).resolves.toEqual({
      runId: 'missing-run',
      outcome: 'not_running',
      errorCode: null,
    });
  });
});

describe('PR-01C existing Provider policy wrapper', () => {
  it('returns a credential-free snapshot without widening AiProvider', async () => {
    const resolver = vi.fn(async () => ({
      provider: 'deepseek' as const,
      model: 'deepseek-v4-flash',
      fallbackProvider: 'gemini' as const,
      fallbackModel: 'gemini-2.5-flash',
      timeoutMs: 30_000,
      source: 'db' as const,
    }));
    const adapter = createExistingProviderPolicyAdapter(resolver);
    const snapshot = await adapter.resolve({ taskKey: 'research.technology_scout' });
    expect(snapshot).toEqual({
      taskKey: 'research.technology_scout',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      fallbackProvider: 'gemini',
      fallbackModel: 'gemini-2.5-flash',
      timeoutMs: 30_000,
      source: 'db',
    });
    expect(Object.keys(snapshot)).not.toContain('apiKey');
    expect(resolver).toHaveBeenCalledWith('research.technology_scout', 'fast', undefined);
  });
});
