import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadProductRegistrationV5OperationalAudit } from '@/lib/product-registration-v4/operational-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ ok: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }

  const packageId = request.nextUrl.searchParams.get('packageId')?.trim() || null;
  if (packageId && packageId.length > 120) {
    return NextResponse.json({ ok: false, code: 'PACKAGE_ID_INVALID' }, { status: 400 });
  }
  const requested = Number(request.nextUrl.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 200)) : 100;

  try {
    const audit = await loadProductRegistrationV5OperationalAudit({
      supabase: supabaseAdmin,
      packageId,
      limit,
    });
    return NextResponse.json({ ok: true, audit }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V5] operational audit failed:', error);
    return NextResponse.json(
      { ok: false, code: 'V5_OPERATIONAL_AUDIT_FAILED' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const GET = withAdminGuard(getHandler);
