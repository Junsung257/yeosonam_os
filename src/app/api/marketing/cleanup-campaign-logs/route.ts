import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { withCronGuard } from '@/lib/cron-auth';
import { refreshSegmentCampaignLog } from '@/lib/rfm-email-campaign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { success: false, message: 'Supabase가 구성되지 않았습니다.' },
      { status: 503 },
    );
  }

  try {
    await refreshSegmentCampaignLog();
    return NextResponse.json({ success: true, message: '캠페인 로그 정리 완료 (90일 초과 삭제)' });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: `로그 정리 중 오류: ${err instanceof Error ? err.message : '알 수 없음'}`,
      },
      { status: 500 },
    );
  }
};

export const POST = withCronGuard(handler);
