import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { generatePredictiveInsights } from '@/lib/predictive-marketing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: false, message: 'Supabase가 구성되지 않았습니다.' }, { status: 503 });
  }

  try {
    const result = await generatePredictiveInsights();
    return NextResponse.json({
      success: true,
      message: result.status === 'ready' ? '예측 인사이트가 생성되었습니다.' : '일별 시계열 데이터가 부족합니다.',
      data: {
        status: result.status,
        insights_generated: result.insights.length,
        reason: result.status === 'data_insufficient' ? result.reason : null,
        downstream_mutations_allowed: false,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `처리 중 오류: ${err instanceof Error ? err.message : '알 수 없음'}` },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
