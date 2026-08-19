import type { BlogContentOperationStage, BlogContentOperationStatus } from './types';

export const BLOG_CONTENT_FACTORY_FUNNEL_KEYS_V4 = [
  'demand',
  'verified_brief',
  'research_ready',
  'draft',
  'repairing',
  'human_review',
  'approved',
  'published',
  'indexed',
] as const;

export type BlogContentFactoryFunnelKeyV4 = (typeof BLOG_CONTENT_FACTORY_FUNNEL_KEYS_V4)[number];

export interface BlogContentFactoryFunnelV4 {
  counts: Record<BlogContentFactoryFunnelKeyV4, number>;
  skipReasons: Record<string, number>;
  approvedInventoryDays: number;
}

export function buildBlogContentFactoryFunnelV4(input: {
  demandClusterIds: string[];
  operations: Array<{
    id: string;
    currentStage: BlogContentOperationStage;
    status: BlogContentOperationStatus;
    creativeId?: string | null;
    skipReason?: string | null;
    failureCode?: string | null;
  }>;
  events: Array<{
    operationId: string;
    stage: string;
    status: string;
    failureCode?: string | null;
  }>;
  indexedCreativeIds: Iterable<string>;
  dailyInventoryTarget: number;
}): BlogContentFactoryFunnelV4 {
  const operationIdsByStage = new Map<string, Set<string>>();
  for (const event of input.events) {
    if (!['succeeded', 'started'].includes(event.status)) continue;
    const ids = operationIdsByStage.get(event.stage) ?? new Set<string>();
    ids.add(event.operationId);
    operationIdsByStage.set(event.stage, ids);
  }
  const currentStageIds = (stage: string) => new Set(
    input.operations.filter((operation) => operation.currentStage === stage).map((operation) => operation.id),
  );
  const unionSize = (...sets: Array<Set<string> | undefined>) => new Set(
    sets.flatMap((set) => [...(set ?? [])]),
  ).size;
  const indexed = new Set(input.indexedCreativeIds);
  const approvedCount = input.operations.filter((operation) => operation.status === 'approved_for_slot').length;
  const skipReasons: Record<string, number> = {};
  for (const operation of input.operations) {
    const reason = operation.failureCode || operation.skipReason;
    if (reason) skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  }
  for (const event of input.events) {
    if (!event.failureCode) continue;
    skipReasons[event.failureCode] = (skipReasons[event.failureCode] ?? 0) + 1;
  }

  return {
    counts: {
      demand: new Set(input.demandClusterIds).size,
      verified_brief: unionSize(operationIdsByStage.get('brief_verified'), currentStageIds('brief_verified')),
      research_ready: unionSize(operationIdsByStage.get('research_ready'), currentStageIds('research_ready')),
      draft: unionSize(operationIdsByStage.get('drafting'), operationIdsByStage.get('evaluating'), currentStageIds('drafting'), currentStageIds('evaluating')),
      repairing: unionSize(operationIdsByStage.get('repairing'), currentStageIds('repairing')),
      human_review: input.operations.filter((operation) => operation.status === 'human_review').length,
      approved: approvedCount,
      published: input.operations.filter((operation) => ['published', 'indexed'].includes(operation.status)).length,
      indexed: input.operations.filter((operation) => operation.creativeId && indexed.has(operation.creativeId)).length,
    },
    skipReasons,
    approvedInventoryDays: input.dailyInventoryTarget > 0
      ? Math.round((approvedCount / input.dailyInventoryTarget) * 100) / 100
      : 0,
  };
}
