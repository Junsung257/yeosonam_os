import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sendSegmentCampaign, runAllSegmentCampaigns, refreshSegmentCampaignLog } from '@/lib/rfm-email-campaign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunCampaignBody {
  segment?: string;
  limit?: number;
  cleanup?: boolean;
}

const handler = async (req: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { success: false, message: 'Supabase가 구성되지 않았습니다.' },
      { status: 503 },
    );
  }

  try {
    const body: RunCampaignBody = await req.json().catch(() => ({}));

    // 로그 정리 요청
    if (body.cleanup) {
      await refreshSegmentCampaignLog();
      return NextResponse.json({ success: true, message: '캠페인 로그 정리 완료 (90일 초과 삭제)' });
    }

    // 단일 세그먼트 또는 전체 실행
    if (body.segment) {
      const validSegments = [
        'champions', 'loyal', 'potential_loyalists',
        'new_customers', 'at_risk', 'hibernating', 'lost',
      ];
      if (!validSegments.includes(body.segment)) {
        return NextResponse.json(
          {
            success: false,
            message: `유효하지 않은 세그먼트: "${body.segment}". 유효값: ${validSegments.join(', ')}`,
          },
          { status: 400 },
        );
      }

      const result = await sendSegmentCampaign(body.segment, body.limit);
      return NextResponse.json({
        success: true,
        segment: body.segment,
        sent: result.sent,
        failed: result.failed,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 10),
      });
    }

    // 전체 세그먼트 실행
    const results = await runAllSegmentCampaigns();
    const totalSent = results.reduce((s, r) => s + r.sent, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);

    return NextResponse.json({
      success: true,
      message: `${results.length}개 세그먼트 캠페인 완료 (발송 ${totalSent}, 실패 ${totalFailed})`,
      segments: results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: `처리 중 오류: ${err instanceof Error ? err.message : '알 수 없음'}`,
      },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(handler);
