import { type NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import { applyMarketingAction } from '@/lib/marketing/action-runner';

export const dynamic = 'force-dynamic';

async function postHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse(
      {
        error: 'Supabase 연동이 설정되지 않아 마케팅 추천 액션을 적용할 수 없습니다.',
        degraded: true,
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const actionId = typeof body?.action_id === 'string' ? body.action_id : '';
    const dryRun = body?.dry_run !== false;

    if (!actionId) {
      return apiResponse({ error: 'action_id is required' }, { status: 400 });
    }

    const plan = await applyMarketingAction(actionId, dryRun);
    return apiResponse({
      applied_at: new Date().toISOString(),
      plan,
    });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to apply marketing action') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
