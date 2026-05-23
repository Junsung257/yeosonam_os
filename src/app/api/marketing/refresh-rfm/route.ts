import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { refreshAllRFM } from '@/lib/customer-segmentation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: false, message: 'Supabase가 구성되지 않았습니다.' }, { status: 503 });
  }

  try {
    const result = await refreshAllRFM();
    return NextResponse.json({
      success: true,
      message: 'RFM 점수가 재계산되었습니다.',
      data: result,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `처리 중 오류: ${err instanceof Error ? err.message : '알 수 없음'}` },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
