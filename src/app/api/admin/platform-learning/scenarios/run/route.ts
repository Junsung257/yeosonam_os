import { type NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import { runActiveQaLearningScenarios } from '@/lib/qa-scenario-regression';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return apiResponse({ error: 'admin required' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = typeof body.limit === 'number' ? body.limit : undefined;
    const result = await runActiveQaLearningScenarios({ limit });

    return apiResponse(result);
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to run learning scenarios') },
      { status: 500 },
    );
  }
}
