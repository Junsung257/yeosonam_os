import type { SupabaseClient } from '@supabase/supabase-js';

const HASH_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_TIMEOUT_MS = 10_000;

type ConvergenceStatus = 'pending' | 'stale' | 'converged' | 'failed';

export type ProductRegistrationV5ConvergenceObservation = {
  id: string;
  package_id: string;
  snapshot_hash: string;
  surface: string;
  route: string;
  status: ConvergenceStatus;
  observed_snapshot_hash: string | null;
  error_detail: string | null;
};

type ConvergenceRow = {
  id: string;
  package_id: string;
  snapshot_hash: string;
  surface: string;
  route: string;
  status: 'pending' | 'stale' | 'failed';
};

type ObservationResult = {
  status: 'converged' | 'stale' | 'failed';
  observedSnapshotHash: string | null;
  errorDetail: string | null;
};

function normalizeHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return HASH_RE.test(normalized) ? normalized : null;
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
}

export function extractProductRegistrationV5SnapshotHashFromHtml(html: string): string | null {
  if (!html) return null;
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = parseHtmlAttributes(tag);
    if (attributes.name?.toLowerCase() !== 'product-registration-v5-snapshot-hash') continue;
    const hash = normalizeHash(attributes.content);
    if (hash) return hash;
  }
  return null;
}

export function classifyProductRegistrationV5Observation(input: {
  expectedSnapshotHash: string;
  httpStatus: number;
  observedSnapshotHash?: string | null;
}): ObservationResult {
  const expected = normalizeHash(input.expectedSnapshotHash);
  const observed = normalizeHash(input.observedSnapshotHash);
  if (!expected) {
    return {
      status: 'failed',
      observedSnapshotHash: observed,
      errorDetail: 'EXPECTED_SNAPSHOT_HASH_INVALID',
    };
  }
  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return {
      status: 'failed',
      observedSnapshotHash: observed,
      errorDetail: `HTTP_${input.httpStatus}`,
    };
  }
  if (!observed) {
    return {
      status: 'failed',
      observedSnapshotHash: null,
      errorDetail: 'SNAPSHOT_MARKER_MISSING',
    };
  }
  if (observed === expected) {
    return { status: 'converged', observedSnapshotHash: observed, errorDetail: null };
  }
  return {
    status: 'stale',
    observedSnapshotHash: observed,
    errorDetail: `SNAPSHOT_HASH_MISMATCH expected=${expected} observed=${observed}`,
  };
}

function routeWithCacheBust(route: string, snapshotHash: string): string {
  const separator = route.includes('?') ? '&' : '?';
  return `${route}${separator}__v5_convergence=${encodeURIComponent(snapshotHash.slice(0, 16))}`;
}

async function observeRoute(input: {
  baseUrl: string;
  row: ConvergenceRow;
  timeoutMs?: number;
}): Promise<ObservationResult> {
  if (!input.row.route.startsWith('/')) {
    return { status: 'failed', observedSnapshotHash: null, errorDetail: 'ROUTE_MUST_BE_RELATIVE' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const url = new URL(routeWithCacheBust(input.row.route, input.row.snapshot_hash), input.baseUrl);
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      headers: {
        accept: input.row.surface === 'og' || input.row.surface === 'affiliate'
          ? 'image/avif,image/webp,image/*,*/*;q=0.8'
          : 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
      },
      signal: controller.signal,
    });

    let observedSnapshotHash = normalizeHash(response.headers.get('x-product-registration-v5-snapshot-hash'));
    if (!observedSnapshotHash && response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      observedSnapshotHash = extractProductRegistrationV5SnapshotHashFromHtml(await response.text());
    }
    return classifyProductRegistrationV5Observation({
      expectedSnapshotHash: input.row.snapshot_hash,
      httpStatus: response.status,
      observedSnapshotHash,
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === 'AbortError'
      ? 'REQUEST_TIMEOUT'
      : `REQUEST_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { status: 'failed', observedSnapshotHash: null, errorDetail: detail.slice(0, 1000) };
  } finally {
    clearTimeout(timeout);
  }
}

async function updateObservation(input: {
  supabase: SupabaseClient;
  row: ConvergenceRow;
  result: ObservationResult;
}): Promise<boolean> {
  const { data, error } = await input.supabase
    .from('product_registration_v5_cache_convergence_runs')
    .update({
      status: input.result.status,
      observed_snapshot_hash: input.result.observedSnapshotHash,
      observed_at: new Date().toISOString(),
      error_detail: input.result.errorDetail,
    })
    .eq('id', input.row.id)
    .eq('status', input.row.status)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function observeProductRegistrationV5ConvergenceBatch(input: {
  supabase: SupabaseClient;
  baseUrl: string;
  limit?: number;
  timeoutMs?: number;
  snapshotHashes?: string[];
}): Promise<ProductRegistrationV5ConvergenceObservation[]> {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 10), 50));
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  let query = input.supabase
    .from('product_registration_v5_cache_convergence_runs')
    .select('id,package_id,snapshot_hash,surface,route,status')
    .in('status', ['pending', 'stale', 'failed'])
    .order('created_at', { ascending: true })
    .limit(limit);
  const hashes = [...new Set(input.snapshotHashes ?? [])].filter(hash => HASH_RE.test(hash));
  if (hashes.length > 0) query = query.in('snapshot_hash', hashes);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as ConvergenceRow[];
  const results: ProductRegistrationV5ConvergenceObservation[] = [];
  for (const row of rows) {
    const result = await observeRoute({ baseUrl, row, timeoutMs: input.timeoutMs });
    const updated = await updateObservation({ supabase: input.supabase, row, result });
    if (!updated) continue;
    results.push({
      id: row.id,
      package_id: row.package_id,
      snapshot_hash: row.snapshot_hash,
      surface: row.surface,
      route: row.route,
      status: result.status,
      observed_snapshot_hash: result.observedSnapshotHash,
      error_detail: result.errorDetail,
    });
  }
  return results;
}
