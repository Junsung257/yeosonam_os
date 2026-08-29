import { NextResponse, type NextRequest } from 'next/server';

import { fetchPublicPackageSnapshotById } from '@/lib/package-publication/repository';
import {
  PRODUCT_REGISTRATION_V6_PROOF_COOKIE,
  productRegistrationV6ProofCookieOptions,
  verifyProductRegistrationV6ProofToken,
} from '@/lib/product-registration-v6/proof-token';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROOF_ROUTE_VERSION = 'v6-proof-cookie-20260829';

export async function GET(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await context.params;
  const token = request.headers.get('x-product-registration-v6-proof-token')
    || request.nextUrl.searchParams.get('token');
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return new NextResponse('Proof service unavailable', {
      status: 503,
      headers: { 'x-product-registration-proof-route': PROOF_ROUTE_VERSION },
    });
  }
  const snapshot = await fetchPublicPackageSnapshotById(supabase, snapshotId, { allowProofCopyIssues: true });
  const claims = snapshot
    ? verifyProductRegistrationV6ProofToken(token, {
        snapshotId,
        snapshotHash: snapshot.row.snapshot_hash,
        packageId: snapshot.row.package_id,
      })
    : null;
  if (!snapshot || !claims || !token) return new NextResponse('Not found', { status: 404 });
  const target = new URL(`/lp/${snapshot.row.package_id}`, request.nextUrl.origin);
  target.searchParams.set('__proof_snapshot', snapshotId);
  const response = NextResponse.redirect(target, 307);
  response.cookies.set(
    PRODUCT_REGISTRATION_V6_PROOF_COOKIE,
    token,
    productRegistrationV6ProofCookieOptions(claims, 'lp'),
  );
  response.headers.set('cache-control', 'private, no-store, max-age=0');
  response.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  response.headers.set('x-product-registration-proof-route', PROOF_ROUTE_VERSION);
  return response;
}
