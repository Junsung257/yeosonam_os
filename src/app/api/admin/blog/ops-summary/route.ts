import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { buildBlogOpsSummary } from '@/lib/blog-ops-summary';
import { probeBlogRuntimeSchemaWithSupabaseV3 } from '@/lib/blog-runtime-readiness-v3';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (_request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  try {
    const [summary, runtimeSchema] = await Promise.all([
      buildBlogOpsSummary(supabaseAdmin),
      probeBlogRuntimeSchemaWithSupabaseV3(supabaseAdmin),
    ]);
    return apiResponse({ ...summary, runtime_schema: runtimeSchema });
  } catch (error) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(error, '블로그 운영 상태 조회 실패') },
      { status: 500 },
    );
  }
});
