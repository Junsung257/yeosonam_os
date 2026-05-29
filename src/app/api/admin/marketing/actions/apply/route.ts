import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { applyMarketingAction } from '@/lib/marketing/action-runner';

export const dynamic = 'force-dynamic';

async function postHandler(request: NextRequest) {
  try {
    const body = await request.json();
    const actionId = typeof body?.action_id === 'string' ? body.action_id : '';
    const dryRun = body?.dry_run !== false;

    if (!actionId) {
      return NextResponse.json({ error: 'action_id is required' }, { status: 400 });
    }

    const plan = await applyMarketingAction(actionId, dryRun);
    return NextResponse.json({
      applied_at: new Date().toISOString(),
      plan,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply marketing action' },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
