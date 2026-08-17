import { createHash } from 'node:crypto';

const SHA256_RE = /^[a-f0-9]{64}$/i;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2_500;

export interface ImmutableRemoteSnapshotConfigV3 {
  url: string;
  sha256: string;
}

export type ImmutableRemoteSnapshotLoadResultV3<T> =
  | { state: 'found'; value: T }
  | { state: 'unconfigured'; value: null }
  | { state: 'invalid_config'; value: null }
  | { state: 'unavailable'; value: null };

export function readImmutableRemoteSnapshotConfigV3(input: {
  url?: string | null;
  sha256?: string | null;
}): ImmutableRemoteSnapshotConfigV3 | null {
  const url = input.url?.trim() || '';
  const sha256 = input.sha256?.trim().toLowerCase() || '';
  if (!url && !sha256) return null;
  if (!url || !SHA256_RE.test(sha256)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    // A content-addressed URL prevents an operator from silently replacing the
    // object while callers continue to call it "last-known-good".
    if (!parsed.href.toLowerCase().includes(sha256)) return null;
  } catch {
    return null;
  }
  return { url, sha256 };
}

export async function loadImmutableRemoteJsonSnapshotV3<T>(input: {
  url?: string | null;
  sha256?: string | null;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<ImmutableRemoteSnapshotLoadResultV3<T>> {
  const hasAnyConfig = Boolean(input.url?.trim() || input.sha256?.trim());
  const config = readImmutableRemoteSnapshotConfigV3(input);
  if (!config) {
    return hasAnyConfig
      ? { state: 'invalid_config', value: null }
      : { state: 'unconfigured', value: null };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const maximumBytes = Math.max(1, Math.min(input.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetchImpl(config.url, {
      method: 'GET',
      cache: 'force-cache',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { state: 'unavailable', value: null };
    const advertisedLength = Number(response.headers.get('content-length') || 0);
    if (advertisedLength > maximumBytes) return { state: 'unavailable', value: null };
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maximumBytes) return { state: 'unavailable', value: null };
    const observed = createHash('sha256').update(body).digest('hex');
    if (observed !== config.sha256) return { state: 'unavailable', value: null };
    try {
      return { state: 'found', value: JSON.parse(body) as T };
    } catch {
      return { state: 'unavailable', value: null };
    }
  } catch {
    return { state: 'unavailable', value: null };
  } finally {
    clearTimeout(timeout);
  }
}
