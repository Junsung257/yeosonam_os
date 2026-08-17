import { NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function postHandler() {
  return NextResponse.json({
    ok: false,
    code: 'LEGACY_PUBLICATION_AUTHORITY_RETIRED',
    error: 'V5 수동 공개 경로는 폐기되었습니다. Registration Kernel의 proof-bound CAS 공개만 허용됩니다.',
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = withAdminGuard(postHandler);
