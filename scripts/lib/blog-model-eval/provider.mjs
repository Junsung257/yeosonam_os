import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HARDENED_PROVIDERS = Object.freeze({
  'deepseek-champion': {
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-pro',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  'nvidia-nim-nemotron-super-49b-v1.5': {
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
  'openrouter-gpt-oss-120b': {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-oss-120b',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
});

const PROCESS_ENV = [
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec',
  'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'NODE_OPTIONS',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
];

export function loadBlogModelEvalPolicy(root) {
  const path = resolve(root, 'config/blog-model-evaluation-policy.json');
  const policy = JSON.parse(readFileSync(path, 'utf8'));
  if (policy.promptfoo?.version !== '0.122.2') throw new Error('PROMPTFOO_VERSION_NOT_PINNED');
  if (policy.fixture?.count !== 33 || policy.execution?.smokeCases !== 3 || policy.execution?.fullRuns !== 2) {
    throw new Error('BLOG_MODEL_EVAL_SUITE_SHAPE_INVALID');
  }
  for (const provider of policy.providers ?? []) {
    const hardened = HARDENED_PROVIDERS[provider.id];
    if (!hardened) throw new Error(`BLOG_MODEL_EVAL_PROVIDER_NOT_ALLOWED:${provider.id}`);
    if (provider.endpoint !== hardened.endpoint || provider.model !== hardened.model || provider.apiKeyEnv !== hardened.apiKeyEnv) {
      throw new Error(`BLOG_MODEL_EVAL_PROVIDER_DRIFT:${provider.id}`);
    }
    if (policy.forbiddenModelPatterns.some((pattern) => provider.model.toLowerCase().includes(pattern.toLowerCase()))) {
      throw new Error(`BLOG_MODEL_EVAL_DYNAMIC_MODEL_FORBIDDEN:${provider.id}`);
    }
  }
  if (policy.providers.length !== Object.keys(HARDENED_PROVIDERS).length) throw new Error('BLOG_MODEL_EVAL_PROVIDER_COUNT_INVALID');
  return policy;
}

export function getBlogModelEvalProvider(policy, providerId) {
  const provider = policy.providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`BLOG_MODEL_EVAL_PROVIDER_NOT_ALLOWED:${providerId}`);
  return provider;
}

export function buildBlogModelEvalChildEnv(source, policy, providerId, extra = {}) {
  const provider = getBlogModelEvalProvider(policy, providerId);
  const allowed = new Set([...PROCESS_ENV, provider.apiKeyEnv]);
  const env = {};
  for (const key of allowed) {
    if (typeof source[key] === 'string') env[key] = source[key];
  }
  return {
    ...env,
    ...extra,
    BLOG_MODEL_EVAL_PROVIDER_ID: providerId,
    PROMPTFOO_SELF_HOSTED: '1',
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_UPDATE: '1',
    PROMPTFOO_DISABLE_REMOTE_GENERATION: 'true',
    PROMPTFOO_DISABLE_SHARING: '1',
    PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS: 'true',
    FORCE_COLOR: '0',
  };
}

export function retryAfterMs(response, attempt, execution) {
  const raw = response.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, execution.backoffMaxMs);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), execution.backoffMaxMs);
  }
  return Math.min(execution.backoffBaseMs * (2 ** attempt), execution.backoffMaxMs);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function requestBody(provider, prompt, execution) {
  const body = {
    model: provider.model,
    messages: [{ role: 'user', content: String(prompt) }],
    temperature: 0,
    top_p: 1,
    max_tokens: execution.maxOutputTokens,
    stream: false,
  };
  if (provider.id === 'openrouter-gpt-oss-120b') {
    body.provider = {
      allow_fallbacks: false,
      data_collection: 'deny',
      require_parameters: true,
    };
  }
  if (provider.id === 'deepseek-champion') body.thinking = { type: 'disabled' };
  return body;
}

export async function callBlogModelProvider({
  policy,
  providerId,
  prompt,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
}) {
  const provider = getBlogModelEvalProvider(policy, providerId);
  if (!apiKey) throw new Error(`BLOG_MODEL_EVAL_KEY_MISSING:${provider.apiKeyEnv}`);
  const execution = policy.execution;
  let lastStatus = null;

  for (let attempt = 0; attempt <= execution.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), execution.timeoutMs);
    let response;
    try {
      response = await fetchImpl(provider.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...(provider.id === 'openrouter-gpt-oss-120b' ? { 'x-title': 'Yeosonam Blog Model Evaluation' } : {}),
        },
        body: JSON.stringify(requestBody(provider, prompt, execution)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    lastStatus = response.status;
    if (response.status === 429 && attempt < execution.maxRetries) {
      await sleepImpl(retryAfterMs(response, attempt, execution));
      continue;
    }
    if (!response.ok) throw new Error(`BLOG_MODEL_EVAL_PROVIDER_HTTP_${response.status}`);
    const payload = await response.json();
    const output = payload?.choices?.[0]?.message?.content;
    if (typeof output !== 'string' || output.trim() === '') throw new Error('BLOG_MODEL_EVAL_EMPTY_OUTPUT');
    const promptTokens = Number(payload?.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(payload?.usage?.completion_tokens ?? 0);
    const reportedCost = Number(payload?.usage?.cost);
    return {
      output,
      tokenUsage: {
        prompt: promptTokens,
        completion: completionTokens,
        total: Number(payload?.usage?.total_tokens ?? promptTokens + completionTokens),
      },
      ...(Number.isFinite(reportedCost) ? { cost: reportedCost } : {}),
      metadata: { provider_id: provider.id, model: provider.model },
    };
  }
  throw new Error(`BLOG_MODEL_EVAL_RETRY_EXHAUSTED:${lastStatus ?? 'unknown'}`);
}

export { HARDENED_PROVIDERS };
