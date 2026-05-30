/**
 * @file revalidate-helper.ts
 *
 * 2026-05-17 박제 (ERR-dev-revalidate-누락):
 *   매 PR 머지 후 사장님 dev3001 revalidate 빠뜨림 → 사장님 페이지 옛 캐시 → "사고" 인식.
 *   prod (yeosonam.com) + dev (localhost:3001) 동시 revalidate 보장.
 *
 * 환경변수:
 *   REVALIDATE_SECRET     — prod / dev 공통 secret
 *   DEV_REVALIDATE_URL    — 사장님 dev 서버 (default: http://localhost:3001)
 *   PROD_REVALIDATE_URL   — prod (default: https://yeosonam.com)
 *
 * 호출 (server context 외부 backfill 스크립트):
 *   await revalidatePackagePaths(packageId)
 */

import { getSecret } from '@/lib/secret-registry';

const DEFAULT_DEV = process.env.DEV_REVALIDATE_URL || 'http://localhost:3001';
const DEFAULT_PROD = process.env.PROD_REVALIDATE_URL || 'https://yeosonam.com';

export interface RevalidateResult {
  prod: { ok: boolean; status?: number; error?: string };
  dev: { ok: boolean; status?: number; error?: string };
}

/**
 * 패키지 1개의 PC + 모바일 detail 경로 revalidate.
 * server context 내부면 revalidatePath 직접 호출 (Next.js fast).
 * server context 외부 (backfill 스크립트) 면 fetch API 호출.
 */
export async function revalidatePackagePaths(
  packageId: string,
  options: {
    skipDev?: boolean;
    skipProd?: boolean;
    alsoServerContext?: boolean;
    /** `/lp/{shortCode}` 경로 — 미전달 시 DB 조회 시도 */
    shortCode?: string | null;
    skipShortCodeLookup?: boolean;
  } = {},
): Promise<RevalidateResult> {
  let shortCode = options.shortCode ?? null;
  if (!options.skipShortCodeLookup && shortCode == null) {
    shortCode = await resolvePackageShortCode(packageId);
  }

  const paths = buildPackageSurfacePaths(packageId, shortCode);
  const secret = getSecret('REVALIDATE_SECRET');
  const result: RevalidateResult = {
    prod: { ok: false },
    dev: { ok: false },
  };

  // server context 내부 호출 (Next.js fast, no fetch)
  if (options.alsoServerContext) {
    try {
      const { revalidatePath } = await import('next/cache');
      for (const p of paths) revalidatePath(p);
      const { revalidateLandingPagesForPackage } = await import('./revalidate-lp-package');
      revalidateLandingPagesForPackage(packageId, shortCode);
    } catch { /* not in server context */ }
  }

  if (!secret) {
    return { prod: { ok: false, error: 'REVALIDATE_SECRET 미설정' }, dev: { ok: false, error: 'REVALIDATE_SECRET 미설정' } };
  }

  // 병렬 호출
  const [prodRes, devRes] = await Promise.allSettled([
    options.skipProd ? Promise.resolve(null) : callRevalidate(DEFAULT_PROD, paths, secret),
    options.skipDev ? Promise.resolve(null) : callRevalidate(DEFAULT_DEV, paths, secret),
  ]);

  if (prodRes.status === 'fulfilled' && prodRes.value) {
    result.prod = prodRes.value;
  } else if (prodRes.status === 'rejected') {
    result.prod = { ok: false, error: String(prodRes.reason).slice(0, 100) };
  } else {
    result.prod = { ok: true };  // skip
  }

  if (devRes.status === 'fulfilled' && devRes.value) {
    result.dev = devRes.value;
  } else if (devRes.status === 'rejected') {
    result.dev = { ok: false, error: String(devRes.reason).slice(0, 100) };
  } else {
    result.dev = { ok: true };  // skip
  }

  return result;
}

function buildPackageSurfacePaths(packageId: string, shortCode?: string | null): string[] {
  const paths = [`/packages/${packageId}`, `/m/packages/${packageId}`, `/lp/${packageId}`];
  if (shortCode && shortCode !== packageId) {
    paths.push(`/lp/${shortCode}`);
  }
  return paths;
}

async function resolvePackageShortCode(packageId: string): Promise<string | null> {
  try {
    const { supabaseAdmin, isSupabaseConfigured } = await import('./supabase');
    if (!isSupabaseConfigured) return null;
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('short_code')
      .eq('id', packageId)
      .maybeSingle();
    return (data as { short_code?: string | null } | null)?.short_code ?? null;
  } catch {
    return null;
  }
}

async function callRevalidate(baseUrl: string, paths: string[], secret: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const r = await fetch(`${baseUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, secret }),
    });
    if (!r.ok) return { ok: false, status: r.status, error: `${r.status} ${r.statusText}` };
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 100) : String(e).slice(0, 100) };
  }
}
