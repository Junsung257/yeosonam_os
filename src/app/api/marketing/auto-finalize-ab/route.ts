import { type NextResponse } from 'next/server';
import { autoFinalizeExperiments } from '@/lib/ab-test-engine';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse(
      { success: false, message: 'Supabase가 설정되지 않았습니다.' },
      { status: 503 },
    );
  }

  try {
    const result = await autoFinalizeExperiments();
    return apiResponse({
      success: true,
      message: 'A/B 테스트 자동 종료가 완료되었습니다.',
      data: result,
    });
  } catch (err) {
    console.error('[marketing/auto-finalize-ab] failed:', sanitizeDbError(err));
    return apiResponse(
      { success: false, message: 'A/B 테스트 자동 종료 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
