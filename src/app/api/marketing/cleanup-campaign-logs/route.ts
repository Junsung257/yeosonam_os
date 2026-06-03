import { type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { refreshSegmentCampaignLog } from '@/lib/rfm-email-campaign';
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
    await refreshSegmentCampaignLog();
    return apiResponse({ success: true, message: '캠페인 로그 정리가 완료되었습니다.' });
  } catch (err) {
    console.error('[marketing/cleanup-campaign-logs] failed:', sanitizeDbError(err));
    return apiResponse(
      { success: false, message: '캠페인 로그 정리 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
};

export const POST = withCronGuard(handler);
