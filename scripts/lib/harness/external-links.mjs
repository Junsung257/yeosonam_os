import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const TEMPORARY_STATUS = new Set([401, 403, 408, 425, 429]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function isPublicAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
      || a >= 224);
  }
  if (version === 6) {
    const value = address.toLowerCase();
    const mappedIpv4 = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    if (mappedIpv4) return isPublicAddress(mappedIpv4);
    const first = Number.parseInt(value.split(':')[0] || '0', 16);
    return value !== '::'
      && value !== '::1'
      && !value.startsWith('2001:db8:')
      && Number.isFinite(first)
      && first >= 0x2000
      && first <= 0x3fff;
  }
  return false;
}

function validateDestination(url) {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('External audit only permits credential-free HTTPS destinations');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('External audit rejected a local destination');
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('External audit rejected a non-public address');
  return hostname;
}

async function resolvePinnedAddress(hostname, resolveImpl) {
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolveImpl(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) throw new Error('External audit DNS returned no addresses');
  if (records.some((record) => !isPublicAddress(record.address))) {
    throw new Error('External audit DNS returned a non-public address');
  }
  return records[0];
}

function nativeRequest(url, { method, headers, timeoutMs, pinnedAddress }) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method,
      headers,
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [pinnedAddress]);
        else callback(null, pinnedAddress.address, pinnedAddress.family);
      },
    }, (response) => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers });
      response.destroy();
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })));
    request.on('error', reject);
    request.end();
  });
}

async function requestWithValidatedRedirects(startUrl, method, options) {
  let current = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const hostname = validateDestination(current);
    const pinnedAddress = await resolvePinnedAddress(hostname, options.resolveImpl);
    const response = await options.requestImpl(current, {
      method,
      timeoutMs: options.timeoutMs,
      pinnedAddress,
      headers: {
        'user-agent': options.userAgent,
        accept: method === 'HEAD' ? '*/*' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        ...(method === 'GET' ? { range: 'bytes=0-1023' } : {}),
      },
    });
    const location = response.headers?.location;
    if (!REDIRECT_STATUS.has(response.status) || !location) return { response, finalUrl: current.href };
    if (redirectCount === MAX_REDIRECTS) throw new Error('External audit redirect limit exceeded');
    current = new URL(Array.isArray(location) ? location[0] : location, current);
  }
  throw new Error('External audit redirect limit exceeded');
}

export async function checkExternalUrl(url, {
  requestImpl = nativeRequest,
  resolveImpl = dnsLookup,
  timeoutMs = 10_000,
  userAgent = 'yeosonam-doc-harness/1.0',
} = {}) {
  let parsed;
  try {
    parsed = new URL(url);
    validateDestination(parsed);
  } catch (error) {
    return { ok: false, kind: 'unsafe', status: null, method: null, finalUrl: null, message: String(error?.message ?? error) };
  }

  const options = { requestImpl, resolveImpl, timeoutMs, userAgent };
  try {
    let method = 'HEAD';
    let result = await requestWithValidatedRedirects(parsed, method, options);
    if ([405, 501].includes(result.response.status)) {
      method = 'GET';
      result = await requestWithValidatedRedirects(parsed, method, options);
    }
    const status = result.response.status;
    if (status >= 200 && status < 300) return { ok: true, kind: 'ok', status, method, finalUrl: result.finalUrl, message: 'Reachable' };
    if (TEMPORARY_STATUS.has(status) || status >= 500) {
      return { ok: false, kind: 'temporary', status, method, finalUrl: result.finalUrl, message: `Temporary or access-controlled HTTP ${status}` };
    }
    return { ok: false, kind: 'terminal', status, method, finalUrl: result.finalUrl, message: `HTTP ${status}` };
  } catch (error) {
    const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    const unsafe = /(?:non-public|local destination|credential-free HTTPS)/iu.test(String(error?.message ?? error));
    return {
      ok: false,
      kind: unsafe ? 'unsafe' : timedOut ? 'temporary' : 'network',
      status: null,
      method: null,
      finalUrl: null,
      message: timedOut ? 'Request timed out' : String(error?.message ?? error),
    };
  }
}

export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}
