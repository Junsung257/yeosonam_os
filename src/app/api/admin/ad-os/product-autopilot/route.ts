import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { runAdOsProductAutopilot } from '@/lib/ad-os-product-autopilot';

export const dynamic = 'force-dynamic';

type ProductAutopilotBody = {
  package_id?: string;
  mode?: 'dry_run' | 'guarded' | 'full';
  apply?: boolean;
  tenant_id?: string | null;
};

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as ProductAutopilotBody;
  if (!body.package_id) {
    return NextResponse.json({ ok: false, error: 'package_id is required' }, { status: 400 });
  }

  const result = await runAdOsProductAutopilot({
    packageId: body.package_id,
    mode: body.mode ?? 'dry_run',
    apply: Boolean(body.apply),
    tenantId: body.tenant_id ?? null,
    source: 'admin_api',
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
});
