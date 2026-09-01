import assert from 'node:assert/strict';
import test from 'node:test';

import { checkExternalUrl } from './external-links.mjs';

const PUBLIC_DNS = async () => [{ address: '93.184.216.34', family: 4 }];

function responder(routes, observed = []) {
  return async (url, options) => {
    observed.push({ url: url.href, address: options.pinnedAddress.address, method: options.method });
    return routes[`${options.method} ${url.href}`] ?? routes[url.href] ?? { status: 404, headers: {} };
  };
}

test('external checker accepts a reachable HTTPS document with a pinned public address', async () => {
  const observed = [];
  const result = await checkExternalUrl('https://docs.example/page', {
    resolveImpl: PUBLIC_DNS,
    requestImpl: responder({ 'https://docs.example/page': { status: 200, headers: {} } }, observed),
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'HEAD');
  assert.deepEqual(observed, [{ url: 'https://docs.example/page', address: '93.184.216.34', method: 'HEAD' }]);
});

test('external checker falls back to GET when HEAD is unsupported', async () => {
  const result = await checkExternalUrl('https://docs.example/page', {
    resolveImpl: PUBLIC_DNS,
    requestImpl: responder({
      'HEAD https://docs.example/page': { status: 405, headers: {} },
      'GET https://docs.example/page': { status: 200, headers: {} },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'GET');
});

test('external checker distinguishes terminal and temporary failures', async () => {
  const requestImpl = responder({
    'https://docs.example/gone': { status: 404, headers: {} },
    'https://docs.example/retry': { status: 503, headers: {} },
  });
  assert.equal((await checkExternalUrl('https://docs.example/gone', { resolveImpl: PUBLIC_DNS, requestImpl })).kind, 'terminal');
  assert.equal((await checkExternalUrl('https://docs.example/retry', { resolveImpl: PUBLIC_DNS, requestImpl })).kind, 'temporary');
});

test('external checker rejects local, private DNS, and private redirect destinations', async () => {
  assert.equal((await checkExternalUrl('http://127.0.0.1/')).kind, 'unsafe');
  assert.equal((await checkExternalUrl('https://private.example/', {
    resolveImpl: async () => [{ address: '169.254.169.254', family: 4 }],
    requestImpl: responder({}),
  })).kind, 'unsafe');
  assert.equal((await checkExternalUrl('https://docs.example/redirect', {
    resolveImpl: PUBLIC_DNS,
    requestImpl: responder({
      'https://docs.example/redirect': { status: 302, headers: { location: 'https://127.0.0.1/metadata' } },
    }),
  })).kind, 'unsafe');
});
