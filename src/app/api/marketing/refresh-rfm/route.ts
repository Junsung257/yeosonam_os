import { type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { refreshAllRFM } from '@/lib/customer-segmentation';
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
    const result = await refreshAllRFM();
    return apiResponse({
      success: true,
      message: 'RFM 점수 재계산이 완료되었습니다.',
      data: result,
    });
  } catch (err) {
    console.error('[marketing/refresh-rfm] failed:', sanitizeDbError(err));
    return apiResponse(
      { success: false, message: 'RFM 점수 재계산 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
