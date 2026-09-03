import { z } from 'zod';

const CONTRACT_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u;
const CONTRACT_VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;

export const AgentContractKeySchema = z.string().trim().min(2).max(120).regex(CONTRACT_KEY);
export const AgentContractVersionSchema = z.string().trim().min(5).max(48).regex(CONTRACT_VERSION);
export const AgentSha256Schema = z.string().regex(SHA256);
export const AgentRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const AgentDepartmentSchema = z.enum([
  'executive',
  'product',
  'marketing',
  'sales',
  'operations',
  'finance',
  'engineering',
  'research',
  'improvement',
  'system',
]);

export const OpaqueAgentReferenceSchema = z.string()
  .trim()
  .min(2)
  .max(240)
  .regex(OPAQUE_REFERENCE)
  .refine((value) => !value.includes('..')
    && !value.includes('\\')
    && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(value), {
    message: 'reference must be opaque, not a URL or local path',
  });

export const AgentContractRefSchema = z.object({
  key: AgentContractKeySchema,
  version: AgentContractVersionSchema,
}).strict();

export const AgentSchemaRefSchema = z.object({
  schemaKey: AgentContractKeySchema,
  schemaVersion: AgentContractVersionSchema,
  schemaHash: AgentSha256Schema,
}).strict();

export const TaskObjectiveV1Schema = z.object({
  schemaVersion: z.literal('task-objective-v1'),
  objectiveRef: OpaqueAgentReferenceSchema.optional(),
  missionRef: OpaqueAgentReferenceSchema.optional(),
  officeObjective: z.string().trim().min(1).max(1_000),
  expectedOutcome: z.string().trim().min(1).max(1_000),
  businessMetricKey: AgentContractKeySchema.optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  stopConditions: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
}).strict();

export const TechnologyScoutTaskInputV1Schema = z.object({
  schemaVersion: z.literal('technology-scout-task-input-v1'),
  caseId: OpaqueAgentReferenceSchema,
  observedClaim: z.string().trim().min(1).max(1_200),
  officialProjectUrl: z.string().url().refine((value) => value.startsWith('https://'), {
    message: 'officialProjectUrl must use HTTPS',
  }),
  officialDocsUrls: z.array(z.string().url().refine((value) => value.startsWith('https://'), {
    message: 'officialDocsUrls must use HTTPS',
  })).max(20),
  evaluationQuestion: z.string().trim().min(1).max(1_000),
  yeosonamProblemRef: OpaqueAgentReferenceSchema,
  asOf: z.string().datetime({ offset: true }),
  objective: TaskObjectiveV1Schema,
  businessIdempotencyKey: z.string().trim().min(8).max(240),
}).strict();

const TechnologyRadarEvidenceV1Schema = z.object({
  claim: z.string().trim().min(1).max(2_000),
  sourceUrl: z.string().url().refine((value) => value.startsWith('https://'), {
    message: 'sourceUrl must use HTTPS',
  }),
  sourceType: z.enum([
    'official_docs',
    'official_repository',
    'official_release',
    'issue',
    'community',
  ]),
  retrievedAt: z.string().datetime({ offset: true }),
  supportsDecision: z.boolean(),
}).strict();

export const TechnologyRadarEntryV1Schema = z.object({
  schemaVersion: z.literal('technology-radar-entry-v1'),
  project: z.object({
    name: z.string().trim().min(1).max(200),
    canonicalUrl: z.string().url().refine((value) => value.startsWith('https://'), {
      message: 'canonicalUrl must use HTTPS',
    }),
    revision: z.string().trim().min(7).max(120),
    release: z.string().trim().max(120).nullable(),
    releaseDate: z.string().date().nullable(),
  }).strict(),
  problemFit: z.object({
    yeosonamProblem: z.string().trim().min(1).max(2_000),
    existingOverlap: z.array(z.string().trim().min(1).max(400)).max(30),
    uniqueCapability: z.array(z.string().trim().min(1).max(400)).max(30),
    switchingCost: z.array(z.string().trim().min(1).max(400)).max(30),
  }).strict(),
  supplyChain: z.object({
    licenseClass: z.enum([
      'permissive',
      'copyleft',
      'source_available',
      'commercial',
      'mixed',
      'unknown',
    ]),
    licenseEvidenceRefs: z.array(OpaqueAgentReferenceSchema).max(30),
    installSurfaces: z.array(z.string().trim().min(1).max(400)).max(50),
    secretNames: z.array(z.string().trim().min(1).max(120)).max(50),
    networkHosts: z.array(z.string().trim().min(1).max(253)).max(50),
    binaryOrHookRisk: z.array(z.string().trim().min(1).max(400)).max(50),
    dataHandling: z.array(z.string().trim().min(1).max(400)).max(50),
  }).strict(),
  evidence: z.array(TechnologyRadarEvidenceV1Schema).min(1).max(100),
  decision: z.enum(['ADOPT', 'TRIAL', 'ASSESS', 'HOLD', 'REJECT']),
  decisionReason: z.string().trim().min(1).max(2_000),
  safePrototype: z.object({
    allowed: z.boolean(),
    isolation: z.array(z.string().trim().min(1).max(400)).max(30),
    successMetrics: z.array(z.string().trim().min(1).max(400)).max(30),
    stopConditions: z.array(z.string().trim().min(1).max(400)).max(30),
  }).strict(),
  unknowns: z.array(z.string().trim().min(1).max(400)).max(50),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  if ((value.decision === 'ADOPT' || value.decision === 'TRIAL') && !value.safePrototype.allowed) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['safePrototype', 'allowed'],
      message: `${value.decision} requires an allowed, bounded prototype`,
    });
  }
  if (value.safePrototype.allowed && (
    value.safePrototype.isolation.length === 0
    || value.safePrototype.successMetrics.length === 0
    || value.safePrototype.stopConditions.length === 0
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['safePrototype'],
      message: 'an allowed prototype requires isolation, success metrics, and stop conditions',
    });
  }
  if (value.supplyChain.licenseClass === 'unknown' && value.decision === 'ADOPT') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decision'],
      message: 'unknown license cannot produce ADOPT',
    });
  }
});

export const WorkProductEnvelopeV1Schema = z.object({
  schemaVersion: z.literal('work-product-envelope-v1'),
  workProductId: OpaqueAgentReferenceSchema,
  workProductType: AgentContractKeySchema,
  taskId: OpaqueAgentReferenceSchema,
  taskKey: AgentContractKeySchema,
  taskContractVersion: AgentContractVersionSchema,
  producerRunId: OpaqueAgentReferenceSchema,
  producerRoleKey: AgentContractKeySchema,
  producerVersion: AgentContractVersionSchema,
  payloadSchema: AgentSchemaRefSchema,
  payload: z.record(z.unknown()),
  evidenceRefs: z.array(OpaqueAgentReferenceSchema).max(100),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(50),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(500)).max(50),
  confidence: z.number().min(0).max(1),
  contentHash: AgentSha256Schema,
  dataClassification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  retentionClass: z.enum(['ephemeral_7d', 'operational_90d', 'audit_1y', 'domain_owned']),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const INTERVENTION_REASON_CODES = [
  'missing_evidence',
  'conflicting_price',
  'supplier_confirmation_required',
  'customer_exception',
  'policy_missing',
  'low_confidence',
  'tool_failure',
  'workflow_gap',
  'legal_or_financial_risk',
] as const;

export const InterventionReasonCodeSchema = z.enum(INTERVENTION_REASON_CODES);

const ReviewCheckV1Schema = z.object({
  checkKey: AgentContractKeySchema,
  outcome: z.enum(['pass', 'warn', 'fail']),
  evidenceRefs: z.array(OpaqueAgentReferenceSchema).max(30),
  reasonCode: InterventionReasonCodeSchema.nullable(),
}).strict();

export const ReviewReceiptV1Schema = z.object({
  schemaVersion: z.literal('review-receipt-v1'),
  reviewId: OpaqueAgentReferenceSchema,
  workProductId: OpaqueAgentReferenceSchema,
  workProductHash: AgentSha256Schema,
  riskLevel: AgentRiskLevelSchema,
  producer: z.object({
    runId: OpaqueAgentReferenceSchema,
    roleKey: AgentContractKeySchema,
    actorId: OpaqueAgentReferenceSchema,
    sessionId: OpaqueAgentReferenceSchema,
  }).strict(),
  reviewer: z.object({
    runId: OpaqueAgentReferenceSchema,
    roleKey: AgentContractKeySchema,
    actorId: OpaqueAgentReferenceSchema,
    sessionId: OpaqueAgentReferenceSchema,
  }).strict(),
  decision: z.enum(['accepted', 'revision_required', 'rejected']),
  checks: z.array(ReviewCheckV1Schema).min(1).max(100),
  evidenceRefs: z.array(OpaqueAgentReferenceSchema).max(100),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  const distinctFields: Array<keyof typeof value.producer> = ['runId', 'actorId', 'sessionId'];
  for (const field of distinctFields) {
    if (value.producer[field] === value.reviewer[field]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewer', field],
        message: `reviewer ${field} must be independent from producer`,
      });
    }
  }
  if ((value.riskLevel === 'high' || value.riskLevel === 'critical')
    && value.producer.roleKey === value.reviewer.roleKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewer', 'roleKey'],
      message: 'high-risk review requires a distinct reviewer role',
    });
  }
});

const RuntimeUsageV1Schema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
}).strict();

export const RuntimeResultV1Schema = z.object({
  schemaVersion: z.literal('runtime-result-v1'),
  runId: OpaqueAgentReferenceSchema,
  runtimeKey: AgentContractKeySchema,
  runtimeVersion: AgentContractVersionSchema,
  providerKey: AgentContractKeySchema.nullable(),
  modelKey: z.string().trim().min(1).max(160).nullable(),
  outputArtifactRef: OpaqueAgentReferenceSchema.nullable(),
  outputHash: AgentSha256Schema.nullable(),
  usage: RuntimeUsageV1Schema,
  outcome: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned']),
  errorCode: z.string().trim().min(2).max(120).nullable(),
}).strict().superRefine((value, context) => {
  if (value.outcome === 'succeeded' && (!value.outputArtifactRef || !value.outputHash || value.errorCode)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outcome'],
      message: 'successful runtime result requires output reference/hash and no error',
    });
  }
  if (['failed', 'timed_out', 'orphaned'].includes(value.outcome) && !value.errorCode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['errorCode'],
      message: `${value.outcome} requires an error code`,
    });
  }
});

export const CommandReceiptOutcomeSchema = z.enum([
  'succeeded',
  'failed_before_effect',
  'unknown_outcome',
  'reconciled',
  'compensated',
]);

export const CommandReceiptV1Schema = z.object({
  schemaVersion: z.literal('command-receipt-v1'),
  receiptId: OpaqueAgentReferenceSchema,
  commandKey: AgentContractKeySchema,
  commandVersion: AgentContractVersionSchema,
  targetType: AgentContractKeySchema,
  targetId: OpaqueAgentReferenceSchema,
  idempotencyKey: z.string().trim().min(8).max(240),
  argumentsHash: AgentSha256Schema,
  schemaHash: AgentSha256Schema,
  artifactHash: AgentSha256Schema.nullable(),
  policyVersion: AgentContractVersionSchema,
  executionStartedAt: z.string().datetime({ offset: true }),
  executionCompletedAt: z.string().datetime({ offset: true }).nullable(),
  outcome: CommandReceiptOutcomeSchema,
  providerReference: OpaqueAgentReferenceSchema.nullable(),
  resultHash: AgentSha256Schema.nullable(),
  actor: z.object({
    actorType: z.enum(['human', 'service']),
    actorId: OpaqueAgentReferenceSchema,
    sessionId: OpaqueAgentReferenceSchema.nullable(),
  }).strict(),
  approvalId: OpaqueAgentReferenceSchema,
  reconciliationOfReceiptId: OpaqueAgentReferenceSchema.nullable(),
  reconciliationRequired: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  const completedOutcome = ['succeeded', 'failed_before_effect', 'reconciled', 'compensated'].includes(value.outcome);
  if (completedOutcome && !value.executionCompletedAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executionCompletedAt'],
      message: `${value.outcome} requires a completion timestamp`,
    });
  }
  if (value.outcome === 'unknown_outcome') {
    if (!value.reconciliationRequired || value.executionCompletedAt || value.resultHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'unknown_outcome must remain incomplete and require reconciliation',
      });
    }
  } else if (value.reconciliationRequired) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reconciliationRequired'],
      message: 'only unknown_outcome may require reconciliation',
    });
  }
  if (value.outcome === 'succeeded' && !value.resultHash) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resultHash'],
      message: 'succeeded requires a result hash',
    });
  }
  if (value.outcome === 'failed_before_effect' && (value.providerReference || value.resultHash)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outcome'],
      message: 'failed_before_effect cannot claim a provider reference or result',
    });
  }
  if ((value.outcome === 'reconciled' || value.outcome === 'compensated')
    && (!value.reconciliationOfReceiptId || !value.resultHash)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reconciliationOfReceiptId'],
      message: `${value.outcome} requires the prior receipt and a result hash`,
    });
  }
});

export type AgentContractRef = z.infer<typeof AgentContractRefSchema>;
export type AgentSchemaRef = z.infer<typeof AgentSchemaRefSchema>;
export type TaskObjectiveV1 = z.infer<typeof TaskObjectiveV1Schema>;
export type TechnologyScoutTaskInputV1 = z.infer<typeof TechnologyScoutTaskInputV1Schema>;
export type TechnologyRadarEntryV1 = z.infer<typeof TechnologyRadarEntryV1Schema>;
export type WorkProductEnvelopeV1 = z.infer<typeof WorkProductEnvelopeV1Schema>;
export type ReviewReceiptV1 = z.infer<typeof ReviewReceiptV1Schema>;
export type RuntimeResultV1 = z.infer<typeof RuntimeResultV1Schema>;
export type InterventionReasonCode = z.infer<typeof InterventionReasonCodeSchema>;
export type CommandReceiptV1 = z.infer<typeof CommandReceiptV1Schema>;
