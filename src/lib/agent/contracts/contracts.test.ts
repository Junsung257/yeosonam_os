import { createHash } from 'node:crypto';

import { zodToJsonSchema } from 'zod-to-json-schema';
import { describe, expect, it } from 'vitest';

import {
  AGENT_CONTRACT_REGISTRY,
  AGENT_CONTRACT_SCHEMA_REGISTRY,
  COMMAND_REGISTRY,
  INTERVENTION_REASON_CODES,
  CommandReceiptV1Schema,
  ReviewReceiptV1Schema,
  RuntimeResultV1Schema,
  TechnologyRadarEntryV1Schema,
  TechnologyScoutTaskInputV1Schema,
  WorkProductEnvelopeV1Schema,
  fromLegacyAgentIdentity,
  getCommandDefinition,
  getLegacyActionCommandView,
  getRoleDefinition,
  getRuntimeProfile,
  getTaskDefinition,
  getToolProfile,
  listLegacyActionCommandViews,
  parseAgentContractSchema,
  toLegacyAgentIdentity,
  validateAgentContractRegistry,
  type CommandReceiptV1,
} from './index';

const SHA = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-09-03T00:00:00.000Z';

function schemaHash(schemaKey: string, schema: Parameters<typeof zodToJsonSchema>[0]): string {
  const jsonSchema = zodToJsonSchema(schema, {
    name: schemaKey,
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
  return `sha256:${createHash('sha256').update(JSON.stringify(jsonSchema)).digest('hex')}`;
}

function baseCommandReceipt(outcome: CommandReceiptV1['outcome']): CommandReceiptV1 {
  return {
    schemaVersion: 'command-receipt-v1',
    receiptId: `receipt-${outcome}`,
    commandKey: 'finance.example_command',
    commandVersion: '1.0.0',
    targetType: 'booking.record',
    targetId: 'booking-1',
    idempotencyKey: `example:${outcome}:booking-1`,
    argumentsHash: SHA,
    schemaHash: SHA,
    artifactHash: null,
    policyVersion: '1.0.0',
    executionStartedAt: NOW,
    executionCompletedAt: NOW,
    outcome,
    providerReference: null,
    resultHash: SHA,
    actor: {
      actorType: 'human',
      actorId: 'operator-1',
      sessionId: 'session-1',
    },
    approvalId: 'approval-1',
    reconciliationOfReceiptId: null,
    reconciliationRequired: false,
    createdAt: NOW,
  };
}

describe('Agent Office PR-01A contract registry', () => {
  it('has valid, closed cross-references', () => {
    expect(validateAgentContractRegistry()).toEqual([]);
    expect(Object.keys(AGENT_CONTRACT_REGISTRY.roles)).toEqual(['research.technology_scout']);
    expect(Object.keys(AGENT_CONTRACT_REGISTRY.tasks)).toEqual(['research.technology_scout']);
  });

  it('keeps the repository contract separate from the disabled operational binding', () => {
    expect(getRoleDefinition('research.technology_scout')).toMatchObject({
      department: 'research',
      contractStatus: 'active',
    });
    expect(AGENT_CONTRACT_REGISTRY.bindings['research.technology_scout']).toMatchObject({
      state: 'contract_only',
      executionEnabled: false,
    });
  });

  it('maps the new role to a legacy-compatible identity without claiming unrelated legacy tasks', () => {
    expect(toLegacyAgentIdentity('research.technology_scout')).toEqual({
      agentType: 'system',
      specialistId: 'research.technology_scout',
    });
    expect(fromLegacyAgentIdentity({
      agentType: 'system',
      specialistId: 'research.technology_scout',
    })).toBe('research.technology_scout');
    expect(fromLegacyAgentIdentity({ agentType: 'system', specialistId: 'system.policy_audit' })).toBeNull();
    expect(toLegacyAgentIdentity('marketing.blog_writer')).toBeNull();
  });

  it('keeps the first task manual, bounded, review-required, and side-effect free', () => {
    expect(getTaskDefinition('research.technology_scout')).toMatchObject({
      triggerMode: 'manual',
      businessIdempotency: { required: true, strategy: 'caller_supplied_domain_key' },
      reviewerPolicy: {
        required: true,
        distinctRun: true,
        distinctActor: true,
        distinctSession: true,
      },
      sideEffectPolicy: { mode: 'forbidden', allowedCommandRefs: [] },
    });
  });

  it('defines only a contract-only runtime and an empty tool capability set', () => {
    expect(getRuntimeProfile('codex_subscription_worker')).toMatchObject({
      implementationStatus: 'contract_only',
      productionAccess: false,
      rawPromptTrace: false,
      rawToolArgumentTrace: false,
      capabilities: { resume: false, streaming: false, subagents: false },
    });
    expect(getToolProfile('research.technology_scout_no_tools')).toMatchObject({
      toolNames: [],
      commandRefs: [],
      credentialMode: 'none',
      repositoryWrites: false,
      externalWrites: false,
      productionAccess: false,
      destructiveOperations: false,
    });
  });

  it('registers zero Office commands, including cancel_task', () => {
    expect(Object.keys(COMMAND_REGISTRY)).toHaveLength(0);
    expect(getCommandDefinition('office.cancel_task')).toBeNull();
  });

  it('exposes current agent actions as compatibility-only, never as Office commands', () => {
    const matchPayment = getLegacyActionCommandView('match_payment');
    expect(matchPayment).toMatchObject({
      source: 'legacy_agent_action_registry',
      riskLevel: 'critical',
      requiresApproval: true,
      agentOfficeCommandRegistered: false,
      agentOfficeExecutionAllowed: false,
    });
    expect(listLegacyActionCommandViews().length).toBeGreaterThan(0);
    expect(getLegacyActionCommandView('office.cancel_task')).toBeNull();
  });

  it('pins every schema reference to its generated JSON Schema hash', () => {
    for (const definition of Object.values(AGENT_CONTRACT_SCHEMA_REGISTRY)) {
      expect(definition.ref.schemaHash).toBe(schemaHash(definition.ref.schemaKey, definition.schema));
    }
  });

  it('rejects unregistered or hash-mismatched schema references', () => {
    const registered = AGENT_CONTRACT_SCHEMA_REGISTRY.runtimeResult.ref;
    expect(parseAgentContractSchema(registered, {
      schemaVersion: 'runtime-result-v1',
      runId: 'run-1',
      runtimeKey: 'codex_subscription_worker',
      runtimeVersion: '1.0.0',
      providerKey: null,
      modelKey: null,
      outputArtifactRef: null,
      outputHash: null,
      usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0, elapsedMs: 0, costUsd: null },
      outcome: 'cancelled',
      errorCode: null,
    }).success).toBe(true);
    expect(parseAgentContractSchema({ ...registered, schemaHash: SHA }, {}).success).toBe(false);
  });
});

describe('Agent Office PR-01A data contracts', () => {
  it('accepts the bounded Technology Scout task input and rejects unknown fields', () => {
    const input = {
      schemaVersion: 'technology-scout-task-input-v1',
      caseId: 'TS-001',
      observedClaim: 'A public post claims a project can replace the control plane.',
      officialProjectUrl: 'https://github.com/example/project',
      officialDocsUrls: ['https://example.com/docs'],
      evaluationQuestion: 'Should Yeosonam assess this capability?',
      yeosonamProblemRef: 'agent-office.runtime-gap',
      asOf: NOW,
      objective: {
        schemaVersion: 'task-objective-v1',
        officeObjective: 'Assess one public technology candidate.',
        expectedOutcome: 'A review-only Technology Radar candidate.',
        stopConditions: ['Stop if the official project cannot be verified.'],
      },
      businessIdempotencyKey: 'technology-scout:TS-001:2026-09-03',
    } as const;

    expect(TechnologyScoutTaskInputV1Schema.safeParse(input).success).toBe(true);
    expect(TechnologyScoutTaskInputV1Schema.safeParse({ ...input, executeInstall: true }).success).toBe(false);
    expect(TechnologyScoutTaskInputV1Schema.safeParse({ ...input, officialProjectUrl: 'http://example.com' }).success).toBe(false);
  });

  it('blocks ADOPT when license evidence is unknown', () => {
    const radarEntry = {
      schemaVersion: 'technology-radar-entry-v1',
      project: {
        name: 'Example',
        canonicalUrl: 'https://github.com/example/project',
        revision: 'abcdef1234567890',
        release: null,
        releaseDate: null,
      },
      problemFit: {
        yeosonamProblem: 'A verified repository problem.',
        existingOverlap: [],
        uniqueCapability: ['One narrow capability'],
        switchingCost: [],
      },
      supplyChain: {
        licenseClass: 'unknown',
        licenseEvidenceRefs: [],
        installSurfaces: [],
        secretNames: [],
        networkHosts: [],
        binaryOrHookRisk: [],
        dataHandling: [],
      },
      evidence: [{
        claim: 'The repository exists.',
        sourceUrl: 'https://github.com/example/project',
        sourceType: 'official_repository',
        retrievedAt: NOW,
        supportsDecision: true,
      }],
      decision: 'ADOPT',
      decisionReason: 'Adopt it.',
      safePrototype: {
        allowed: true,
        isolation: ['No production credentials'],
        successMetrics: ['20 cases pass'],
        stopConditions: ['Stop on any write attempt'],
      },
      unknowns: ['License is not verified'],
      confidence: 0.4,
    } as const;

    expect(TechnologyRadarEntryV1Schema.safeParse(radarEntry).success).toBe(false);
    expect(TechnologyRadarEntryV1Schema.safeParse({
      ...radarEntry,
      decision: 'HOLD',
      safePrototype: { allowed: false, isolation: [], successMetrics: [], stopConditions: [] },
    }).success).toBe(true);
  });

  it('requires opaque evidence references instead of raw URLs or local paths in Work Products', () => {
    const product = {
      schemaVersion: 'work-product-envelope-v1',
      workProductId: 'work-product-1',
      workProductType: 'research.technology_radar_entry',
      taskId: 'task-1',
      taskKey: 'research.technology_scout',
      taskContractVersion: '1.0.0',
      producerRunId: 'run-1',
      producerRoleKey: 'research.technology_scout',
      producerVersion: '1.0.0',
      payloadSchema: AGENT_CONTRACT_SCHEMA_REGISTRY.technologyRadarEntry.ref,
      payload: { decision: 'HOLD' },
      evidenceRefs: ['evidence:official-source-1'],
      assumptions: [],
      unresolvedQuestions: [],
      confidence: 0.9,
      contentHash: SHA,
      dataClassification: 'public',
      retentionClass: 'operational_90d',
      createdAt: NOW,
    } as const;

    expect(WorkProductEnvelopeV1Schema.safeParse(product).success).toBe(true);
    expect(WorkProductEnvelopeV1Schema.safeParse({
      ...product,
      evidenceRefs: ['C:\\private\\evidence.json'],
    }).success).toBe(false);
    expect(WorkProductEnvelopeV1Schema.safeParse({
      ...product,
      evidenceRefs: ['https://example.com/signed?token=secret'],
    }).success).toBe(false);
    expect(WorkProductEnvelopeV1Schema.safeParse({
      ...product,
      evidenceRefs: ['https://example.com/evidence'],
    }).success).toBe(false);
  });

  it('requires a distinct run, actor, and session for every review', () => {
    const receipt = {
      schemaVersion: 'review-receipt-v1',
      reviewId: 'review-1',
      workProductId: 'work-product-1',
      workProductHash: SHA,
      riskLevel: 'medium',
      producer: {
        runId: 'run-producer', roleKey: 'research.technology_scout', actorId: 'actor-1', sessionId: 'session-1',
      },
      reviewer: {
        runId: 'run-reviewer', roleKey: 'research.technology_scout', actorId: 'actor-2', sessionId: 'session-2',
      },
      decision: 'accepted',
      checks: [{ checkKey: 'research.evidence_quality', outcome: 'pass', evidenceRefs: ['evidence:1'], reasonCode: null }],
      evidenceRefs: ['evidence:1'],
      reviewedAt: NOW,
    } as const;

    expect(ReviewReceiptV1Schema.safeParse(receipt).success).toBe(true);
    expect(ReviewReceiptV1Schema.safeParse({
      ...receipt,
      reviewer: { ...receipt.reviewer, sessionId: receipt.producer.sessionId },
    }).success).toBe(false);
  });

  it('requires a different role for high-risk review', () => {
    const result = ReviewReceiptV1Schema.safeParse({
      schemaVersion: 'review-receipt-v1',
      reviewId: 'review-high',
      workProductId: 'work-product-1',
      workProductHash: SHA,
      riskLevel: 'high',
      producer: { runId: 'run-1', roleKey: 'research.technology_scout', actorId: 'actor-1', sessionId: 'session-1' },
      reviewer: { runId: 'run-2', roleKey: 'research.technology_scout', actorId: 'actor-2', sessionId: 'session-2' },
      decision: 'rejected',
      checks: [{ checkKey: 'research.license', outcome: 'fail', evidenceRefs: ['evidence:1'], reasonCode: 'missing_evidence' }],
      evidenceRefs: ['evidence:1'],
      reviewedAt: NOW,
    });
    expect(result.success).toBe(false);
  });

  it('requires content-addressed output on a successful Runtime Result', () => {
    const result = {
      schemaVersion: 'runtime-result-v1',
      runId: 'run-1',
      runtimeKey: 'codex_subscription_worker',
      runtimeVersion: '1.0.0',
      providerKey: null,
      modelKey: null,
      outputArtifactRef: 'artifact:work-product-1',
      outputHash: SHA,
      usage: { inputTokens: 10, outputTokens: 20, toolCalls: 0, elapsedMs: 30, costUsd: null },
      outcome: 'succeeded',
      errorCode: null,
    } as const;
    expect(RuntimeResultV1Schema.safeParse(result).success).toBe(true);
    expect(RuntimeResultV1Schema.safeParse({ ...result, outputHash: null }).success).toBe(false);
  });

  it('keeps intervention reasons closed and auditable', () => {
    expect(INTERVENTION_REASON_CODES).toEqual([
      'missing_evidence',
      'conflicting_price',
      'supplier_confirmation_required',
      'customer_exception',
      'policy_missing',
      'low_confidence',
      'tool_failure',
      'workflow_gap',
      'legal_or_financial_risk',
    ]);
  });
});

describe('CommandReceiptV1 design-only invariants', () => {
  it('accepts a content-addressed successful receipt', () => {
    expect(CommandReceiptV1Schema.safeParse(baseCommandReceipt('succeeded')).success).toBe(true);
  });

  it('keeps failed_before_effect free from provider/result claims', () => {
    const receipt = baseCommandReceipt('failed_before_effect');
    receipt.resultHash = null;
    expect(CommandReceiptV1Schema.safeParse(receipt).success).toBe(true);
    expect(CommandReceiptV1Schema.safeParse({ ...receipt, providerReference: 'provider-ref-1' }).success).toBe(false);
  });

  it('represents unknown outcome without treating it as retryable failure', () => {
    const receipt = baseCommandReceipt('unknown_outcome');
    receipt.executionCompletedAt = null;
    receipt.resultHash = null;
    receipt.reconciliationRequired = true;
    expect(CommandReceiptV1Schema.safeParse(receipt).success).toBe(true);
    expect(CommandReceiptV1Schema.safeParse({ ...receipt, reconciliationRequired: false }).success).toBe(false);
  });

  it.each(['reconciled', 'compensated'] as const)(
    'requires the prior receipt and final result for %s',
    (outcome) => {
      const receipt = baseCommandReceipt(outcome);
      expect(CommandReceiptV1Schema.safeParse(receipt).success).toBe(false);
      receipt.reconciliationOfReceiptId = 'receipt-unknown';
      expect(CommandReceiptV1Schema.safeParse(receipt).success).toBe(true);
    },
  );
});
