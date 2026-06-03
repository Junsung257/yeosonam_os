/**
 * PATCH /api/affiliate/insights/:id/read
 * 인사이트 읽음 처리
 */
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import { markInsightAsRead } from '@/lib/card-news/affiliate-feedback';

export const runtime = 'nodejs';

const patchHandler = async (
  _request: NextRequest,
  props: { params: Promise<{ id: string }> },
) => {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  const insightId = params.id;
  if (!insightId) {
    return apiResponse({ error: 'insight_id 필요' }, { status: 400 });
  }

  try {
    const success = await markInsightAsRead(insightId);
    if (!success) {
      return apiResponse({ error: '읽음 처리 실패' }, { status: 500 });
    }
    return apiResponse({ success: true });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const PATCH = withAdminGuard(patchHandler);
