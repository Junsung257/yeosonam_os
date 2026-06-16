import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { buildBlogOpsSummary } from '@/lib/blog-ops-summary';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (_request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  try {
    const summary = await buildBlogOpsSummary(supabaseAdmin);
    return apiResponse(summary);
  } catch (error) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(error, '블로그 운영 상태 조회 실패') },
      { status: 500 },
    );
  }
});
