import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { runMarketingIntegrationProbes } from '@/lib/marketing/integration-probes';

export const dynamic = 'force-dynamic';

async function getHandler(_request: NextRequest) {
  const probes = await runMarketingIntegrationProbes();
  const ok = probes.every((probe) => probe.status === 'ok' || probe.status === 'skipped');
  return NextResponse.json({
    ok,
    checked_at: new Date().toISOString(),
    probes,
  });
}

export const GET = withAdminGuard(getHandler);
