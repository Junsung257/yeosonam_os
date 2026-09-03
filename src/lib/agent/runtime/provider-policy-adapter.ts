import {
  resolveAiPolicyRuntime,
  type AiProvider,
} from '@/lib/ai-provider-policy';

export type ExistingProviderPolicySnapshot = {
  taskKey: 'research.technology_scout';
  provider: AiProvider;
  model: string;
  fallbackProvider: AiProvider | null;
  fallbackModel: string | null;
  timeoutMs: number | null;
  source: 'db' | 'env';
};

type ExistingPolicyResolver = typeof resolveAiPolicyRuntime;

export interface ExistingProviderPolicyAdapter {
  resolve(input: {
    taskKey: 'research.technology_scout';
    tier?: 'fast' | 'pro';
    explicitModel?: string;
  }): Promise<ExistingProviderPolicySnapshot>;
}

export function createExistingProviderPolicyAdapter(
  resolver: ExistingPolicyResolver = resolveAiPolicyRuntime,
): ExistingProviderPolicyAdapter {
  return Object.freeze({
    async resolve(input: {
      taskKey: 'research.technology_scout';
      tier?: 'fast' | 'pro';
      explicitModel?: string;
    }) {
      const resolved = await resolver(
        input.taskKey,
        input.tier ?? 'fast',
        input.explicitModel,
      );
      return Object.freeze({
        taskKey: input.taskKey,
        provider: resolved.provider,
        model: resolved.model,
        fallbackProvider: resolved.fallbackProvider,
        fallbackModel: resolved.fallbackModel,
        timeoutMs: resolved.timeoutMs,
        source: resolved.source,
      });
    },
  });
}
