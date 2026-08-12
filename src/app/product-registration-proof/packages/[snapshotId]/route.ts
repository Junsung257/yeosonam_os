import { NextResponse, type NextRequest } from 'next/server';

import { fetchPublicPackageSnapshotById } from '@/lib/package-publication/repository';
import { verifyProductRegistrationV6ProofToken } from '@/lib/product-registration-v6/proof-token';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await context.params;
  const token = request.headers.get('x-product-registration-v6-proof-token')
    || request.nextUrl.searchParams.get('token');
  const supabase = getSupabaseAdmin();
  if (!supabase) return new NextResponse('Proof service unavailable', { status: 503 });
  const snapshot = await fetchPublicPackageSnapshotById(supabase, snapshotId);
  if (!snapshot || !verifyProductRegistrationV6ProofToken(token, {
    snapshotId,
    snapshotHash: snapshot.row.snapshot_hash,
    packageId: snapshot.row.package_id,
  })) return new NextResponse('Not found', { status: 404 });
  const currentRendererBuildId = process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.NEXT_PUBLIC_BUILD_ID
    ?? 'local-v6-renderer';
  if (snapshot.row.renderer_build_id && snapshot.row.renderer_build_id !== currentRendererBuildId) {
    return new NextResponse('Snapshot renderer mismatch', { status: 409 });
  }

  const target = new URL(`/packages/${snapshot.row.package_id}`, request.nextUrl.origin);
  target.searchParams.set('__proof_snapshot', snapshotId);
  const protectionBypass = request.headers.get('x-vercel-protection-bypass')
    || process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const response = await fetch(target, {
    headers: {
      'x-product-registration-v6-proof-token': token!,
      'user-agent': request.headers.get('user-agent') || 'YeosonamV6Proof/1.0',
      ...(protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : {}),
    },
    cache: 'no-store',
  });
  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'text/html; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'x-product-registration-snapshot-hash': snapshot.row.snapshot_hash,
      'x-product-registration-renderer-build-id': currentRendererBuildId,
    },
  });
}
