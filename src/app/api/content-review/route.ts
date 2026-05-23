import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import {
  submitReview,
  getReviewHistory,
  getPendingReviews,
} from '@/lib/content-review-workflow';

// ─── POST: 검토 결정 제출 ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      creative_id,
      status,
      review_note,
      rejection_category,
      rejection_reason,
      suggested_changes,
    } = body as {
      creative_id?: string;
      status?: string;
      review_note?: string;
      rejection_category?: string;
      rejection_reason?: string;
      suggested_changes?: string;
    };

    if (!creative_id || !status) {
      return NextResponse.json(
        { error: 'creative_id와 status는 필수입니다' },
        { status: 400 },
      );
    }

    if (!['approved', 'rejected', 'changes_requested'].includes(status)) {
      return NextResponse.json(
        { error: 'status는 approved, rejected, changes_requested 중 하나여야 합니다' },
        { status: 400 },
      );
    }

    // 리뷰어 확인 (access_token 기반)
    const token = request.cookies.get('sb-access-token')?.value;
    let reviewerId = 'unknown';

    if (token) {
      const { verifySupabaseAccessToken } = await import(
        '@/lib/supabase-jwt-verify'
      );
      const result = await verifySupabaseAccessToken(token);
      if (result.ok && result.payload?.sub) reviewerId = result.payload.sub;
    }

    const result = await submitReview({
      creativeId: creative_id,
      reviewerId,
      status: status as 'approved' | 'rejected' | 'changes_requested',
      reviewNote: review_note,
      rejectionReason: rejection_reason,
      rejectionCategory: rejection_category as
        | 'quality_low'
        | 'fact_error'
        | 'seo_issue'
        | 'brand_violation'
        | 'duplicate'
        | 'inappropriate_tone'
        | 'legal_issue'
        | 'other'
        | undefined,
      suggestedChanges: suggested_changes,
    });

    return NextResponse.json({ review_id: result.reviewId }, { status: 200 });
  } catch (error) {
    console.error('[api/content-review] POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '검토 제출 실패' },
      { status: 500 },
    );
  }
}

// ─── GET: 검토 이력 또는 큐 조회 ─────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const creativeId = searchParams.get('creative_id');
    const queue = searchParams.get('queue');

    // 큐 조회
    if (queue === 'true' || queue === '1') {
      const limit = parseInt(searchParams.get('limit') ?? '50');
      const priorityMin = parseInt(
        searchParams.get('priority_min') ?? '1',
      );
      const items = await getPendingReviews({ limit, priorityMin });
      return NextResponse.json({ queue: items });
    }

    // 특정 creative 의 검토 이력
    if (creativeId) {
      const [creativeResult, history] = await Promise.all([
        supabaseAdmin
          .from('content_creatives')
          .select('id, title, status, review_status, channel, blog_html')
          .eq('id', creativeId)
          .maybeSingle(),
        getReviewHistory(creativeId),
      ]);

      if (!creativeResult.data) {
        return NextResponse.json(
          { error: '콘텐츠를 찾을 수 없습니다' },
          { status: 404 },
        );
      }

      return NextResponse.json({
        creative: creativeResult.data,
        history,
      });
    }

    // 전체 큐 조회 (기본)
    const items = await getPendingReviews();
    return NextResponse.json({ queue: items });
  } catch (error) {
    console.error('[api/content-review] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '조회 실패' },
      { status: 500 },
    );
  }
}
