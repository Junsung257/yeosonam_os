import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

/**
 * 특정 패키지의 그룹 내 순위/점수 조회 (어드민 운영 진단용).
 * 가장 최근 캐시된 score 1건 반환.
 */
const getHandler = async (_req: NextRequest, { params }: { params: { id: string } }) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  const { data, error } = await supabaseAdmin
    .from('package_scores')
    .select('*')
    .eq('package_id', params.id)
    .order('computed_at', { ascending: false })
    .limit(1);
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  if (!data || data.length === 0) {
    return apiResponse({ score: null, message: '점수 없음 (cron 미실행 또는 그룹 단독)' });
  }
  return apiResponse({ score: data[0] });
}

export const GET = withAdminGuard(getHandler);
