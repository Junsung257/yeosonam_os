import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { ALL_RULES } from '@/lib/booking-tasks/rules';
import { runAllRules } from '@/lib/booking-tasks/runner';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';

export const maxDuration = 60;

const postHandler = async (_request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    const result = await runAllRules(ALL_RULES, { isForce: true });
    return apiResponse({ ok: true, ...result });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
