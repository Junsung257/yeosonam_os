import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async () => {
  const smoke = buildAdOsStagingSmokeSummary();

  return NextResponse.json({
    ok: smoke.status === 'pass',
    checked_at: new Date().toISOString(),
    source: 'buildDanangAdOsE2ESmoke',
    smoke,
    safety: {
      ...smoke.safety,
      external_spend_krw: 0,
    },
  });
});
