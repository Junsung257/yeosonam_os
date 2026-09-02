import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import {
  buildBlogModelEvalChildEnv,
  callBlogModelProvider,
  loadBlogModelEvalPolicy,
} from './provider.mjs';

const root = resolve(import.meta.dirname, '../../..');
const policy = loadBlogModelEvalPolicy(root);

function response(status, payload, retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => payload,
  };
}

test('child environment carries only the selected provider key and process essentials', () => {
  const env = buildBlogModelEvalChildEnv({
    PATH: 'bin',
    NVIDIA_API_KEY: 'nim-secret',
    DEEPSEEK_API_KEY: 'must-not-pass',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-pass',
  }, policy, 'nvidia-nim-nemotron-super-49b-v1.5');
  assert.equal(env.NVIDIA_API_KEY, 'nim-secret');
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.PROMPTFOO_DISABLE_SHARING, '1');
});

test('429 responses back off twice and preserve the fixed OpenRouter model and no-fallback policy', async () => {
  const calls = [];
  const waits = [];
  const replies = [
    response(429, {}, '1'),
    response(429, {}),
    response(200, {
      choices: [{ message: { content: '{"passed":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
  ];
  const result = await callBlogModelProvider({
    policy,
    providerId: 'openrouter-gpt-oss-120b',
    prompt: 'test',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return replies.shift();
    },
    sleepImpl: async (ms) => waits.push(ms),
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(body.provider, { allow_fallbacks: false, data_collection: 'deny', require_parameters: true });
  assert.deepEqual(result.tokenUsage, { prompt: 10, completion: 4, total: 14 });
});

test('DeepSeek matches the production non-thinking judge endpoint and token ceiling', async () => {
  let request;
  await callBlogModelProvider({
    policy,
    providerId: 'deepseek-champion',
    prompt: 'test',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return response(200, { choices: [{ message: { content: '{"passed":true}' } }] });
    },
  });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.body.max_tokens, 1200);
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
});

test('a third 429 fails without an unbounded retry', async () => {
  let calls = 0;
  await assert.rejects(() => callBlogModelProvider({
    policy,
    providerId: 'deepseek-champion',
    prompt: 'test',
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return response(429, {}); },
    sleepImpl: async () => {},
  }), /PROVIDER_HTTP_429/u);
  assert.equal(calls, 3);
});
