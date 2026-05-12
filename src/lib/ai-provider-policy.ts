export type AiProvider = 'deepseek' | 'claude' | 'gemini';
import { getAiProviderSecret } from '@/lib/secret-registry';

type ProviderOverrideMap = Record<string, AiProvider>;
type ModelOverrideMap = Record<string, string>;

interface RuntimePolicyRow {
  task: string;
  provider: AiProvider;
  model: string | null;
  fallback_provider: AiProvider | null;
  fallback_model: string | null;
  timeout_ms: number | null;
}

const DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, { fast: string; pro: string }> = {
  deepseek: { fast: 'deepseek-v4-flash', pro: 'deepseek-v4-pro' },
  claude: { fast: 'claude-sonnet-4-6', pro: 'claude-sonnet-4-6' },
  gemini: { fast: 'gemini-2.5-flash', pro: 'gemini-2.5-flash' },
};

function normalizeProvider(input?: string | null): AiProvider | null {
  const v = (input || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'deepseek' || v === 'claude' || v === 'gemini') return v;
  return null;
}

function parseProviderOverrides(raw?: string): ProviderOverrideMap {
  if (!raw?.trim()) return {};
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<ProviderOverrideMap>((acc, entry) => {
      const [task, provider] = entry.split(':').map((p) => p?.trim());
      const normalized = normalizeProvider(provider);
      if (task && normalized) acc[task] = normalized;
      return acc;
    }, {});
}

function parseModelOverrides(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [task, model] = entry.split(':').map((p) => p?.trim());
      if (task && model) acc[task] = model;
      return acc;
    }, {});
}

let runtimePolicyCache: RuntimePolicyRow[] = [];
let runtimePolicyCacheExpiry = 0;
const RUNTIME_POLICY_TTL_MS = 60_000;

export function getAiDefaultProvider(): AiProvider {
  const fromEnv = normalizeProvider(process.env.AI_DEFAULT_PROVIDER);
  return fromEnv ?? 'deepseek';
}

export function resolveAiPolicy(
  task: string,
  tier: 'fast' | 'pro' = 'fast',
  explicitModel?: string,
): { provider: AiProvider; model: string } {
  const overrides = parseProviderOverrides(process.env.AI_TASK_PROVIDER_OVERRIDES);
  const modelOverrides = parseModelOverrides(process.env.AI_TASK_MODEL_OVERRIDES);
  const defaultProvider = getAiDefaultProvider();
  const provider = overrides[task] ?? defaultProvider;
  const model = explicitModel || modelOverrides[task] || DEFAULT_MODEL_BY_PROVIDER[provider][tier];
  return { provider, model };
}

function getDefaultModelByProvider(provider: AiProvider, tier: 'fast' | 'pro') {
  return DEFAULT_MODEL_BY_PROVIDER[provider][tier];
}

async function getRuntimePolicyRows(): Promise<RuntimePolicyRow[]> {
  if (Date.now() < runtimePolicyCacheExpiry) return runtimePolicyCache;
  try {
    const { isSupabaseConfigured, supabaseAdmin } = await import('@/lib/supabase');
    if (!isSupabaseConfigured) return runtimePolicyCache;

    const { data, error } = await supabaseAdmin
      .from('system_ai_policies')
      .select('task,provider,model,fallback_provider,fallback_model,timeout_ms')
      .eq('enabled', true)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    runtimePolicyCache = ((data ?? []) as RuntimePolicyRow[]).filter((row) => !!normalizeProvider(row.provider));
    runtimePolicyCacheExpiry = Date.now() + RUNTIME_POLICY_TTL_MS;
  } catch {
    // fail-open: DB 조회 실패 시 마지막 캐시 또는 env 정책으로 동작
  }
  return runtimePolicyCache;
}

export function invalidateAiPolicyCache() {
  runtimePolicyCacheExpiry = 0;
}

function getEnvPolicy(task: string, tier: 'fast' | 'pro', explicitModel?: string) {
  const overrides = parseProviderOverrides(process.env.AI_TASK_PROVIDER_OVERRIDES);
  const modelOverrides = parseModelOverrides(process.env.AI_TASK_MODEL_OVERRIDES);
  const defaultProvider = getAiDefaultProvider();
  const provider = overrides[task] ?? defaultProvider;
  const model = explicitModel || modelOverrides[task] || getDefaultModelByProvider(provider, tier);
  return { provider, model, fallbackProvider: null as AiProvider | null, fallbackModel: null as string | null, timeoutMs: null as number | null };
}

function toLookupMap(rows: RuntimePolicyRow[]) {
  const taskMap = new Map<string, RuntimePolicyRow>();
  for (const row of rows) {
    if (!taskMap.has(row.task)) taskMap.set(row.task, row);
  }
  return taskMap;
}

export async function resolveAiPolicyRuntime(
  task: string,
  tier: 'fast' | 'pro' = 'fast',
  explicitModel?: string,
): Promise<{
  provider: AiProvider;
  model: string;
  fallbackProvider: AiProvider | null;
  fallbackModel: string | null;
  timeoutMs: number | null;
  source: 'db' | 'env';
}> {
  const rows = await getRuntimePolicyRows();
  const map = toLookupMap(rows);
  const taskRow = map.get(task);
  const globalRow = map.get('*');

  if (!taskRow && !globalRow) {
    const envPolicy = getEnvPolicy(task, tier, explicitModel);
    return { ...envPolicy, source: 'env' };
  }

  const applied = taskRow ?? globalRow!;
  const provider = normalizeProvider(applied.provider) ?? getAiDefaultProvider();
  const envModels: ModelOverrideMap = parseModelOverrides(process.env.AI_TASK_MODEL_OVERRIDES);
  const model = explicitModel || envModels[task] || applied.model || getDefaultModelByProvider(provider, tier);
  const fallbackProvider = normalizeProvider(applied.fallback_provider ?? undefined);
  const fallbackModel = applied.fallback_model || (fallbackProvider ? getDefaultModelByProvider(fallbackProvider, 'fast') : null);
  const timeoutMs = typeof applied.timeout_ms === 'number' && applied.timeout_ms > 0 ? applied.timeout_ms : null;

  return {
    provider,
    model,
    fallbackProvider,
    fallbackModel,
    timeoutMs,
    source: 'db',
  };
}

export function getProviderApiKey(provider: AiProvider): string | null {
  return getAiProviderSecret(provider);
}

