import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLiveProviderEnv, parseLiveProvider } from './live-eval-config.mjs';

test('live provider parser accepts credential-free hosted model IDs', () => {
  assert.deepEqual(parseLiveProvider('google:gemini-2.5-flash'), {
    id: 'google:gemini-2.5-flash',
    family: 'google',
    model: 'gemini-2.5-flash',
  });
});

test('live provider parser rejects executable, file, URL, and embedded-secret providers', () => {
  for (const candidate of [
    'exec:printenv',
    'file://provider.js',
    'https://example.com/provider',
    'google:gemini?apiKey=secret',
    'google:../../provider',
  ]) {
    assert.throws(() => parseLiveProvider(candidate), /credential-free model ID/u);
  }
});

test('live provider child environment excludes unrelated application secrets', () => {
  const env = buildLiveProviderEnv({
    PATH: 'bin',
    GEMINI_API_KEY: 'provider-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-pass',
    VERCEL_TOKEN: 'must-not-pass',
  }, 'google');
  assert.equal(env.PATH, 'bin');
  assert.equal(env.GEMINI_API_KEY, 'provider-secret');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.VERCEL_TOKEN, undefined);
  assert.equal(env.PROMPTFOO_DISABLE_SHARING, '1');
});
