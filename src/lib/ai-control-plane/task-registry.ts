import type { AiModelClass, AiProvider } from './types';

export interface AiTaskPolicy {
  workload: string;
  task: string;
  provider: AiProvider;
  modelClass: AiModelClass;
  maxProviderCalls: 1;
  allowFallback: false;
  allowAdvisor: false;
}

const BLOG_POLICIES: Record<string, AiTaskPolicy> = {
  'informational-draft': {
    workload: 'blog-production', task: 'informational-draft', provider: 'deepseek',
    modelClass: 'flash', maxProviderCalls: 1, allowFallback: false, allowAdvisor: false,
  },
  'targeted-repair': {
    workload: 'blog-production', task: 'targeted-repair', provider: 'deepseek',
    modelClass: 'pro', maxProviderCalls: 1, allowFallback: false, allowAdvisor: false,
  },
  'targeted-repair-max': {
    workload: 'blog-production', task: 'targeted-repair-max', provider: 'deepseek',
    modelClass: 'pro', maxProviderCalls: 1, allowFallback: false, allowAdvisor: false,
  },
};

export function getAiTaskPolicy(workload: string, task: string): AiTaskPolicy | null {
  const policy = BLOG_POLICIES[task];
  if (!policy || policy.workload !== workload) return null;
  return policy;
}

export function assertRegisteredAiTask(workload: string, task: string): AiTaskPolicy {
  const policy = getAiTaskPolicy(workload, task);
  if (!policy) throw new Error(`ai_task_not_registered:${workload}:${task}`);
  return policy;
}

export function listRegisteredAiTasks(): AiTaskPolicy[] {
  return Object.values(BLOG_POLICIES);
}
