import { NextRequest } from 'next/server';
import { apiResponse, cacheHeader } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { logAndSanitize } from '@/lib/error-sanitizer';

// GET: 감사 로그 타임라인 조회
const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const targetType = searchParams.get('targetType'); // 'booking' | 'affiliate' | 'settlement'
  const targetId = searchParams.get('targetId');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const supabase = supabaseAdmin;

  try {
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (targetType) query = query.eq('target_type', targetType);
    if (targetId) query = query.eq('target_id', targetId);

    const { data, error } = await query;
    if (error) throw error;

    return apiResponse({ logs: data || [] }, { headers: cacheHeader(60) });
  } catch (err) {
    return apiResponse({ error: logAndSanitize('audit-logs-get', err, '조회 실패') }, { status: 500 });
  }
};

// POST: 감사 로그 기록
const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const supabase = supabaseAdmin;

  try {
    const body = await request.json();
    const { action, targetType, targetId, description, beforeValue, afterValue, userId } = body;

    if (!action) return apiResponse({ error: 'action이 필요합니다.' }, { status: 400 });

    const { data, error } = await supabase
      .from('audit_logs')
      .insert([{
        user_id: userId || null,
        action,
        target_type: targetType || null,
        target_id: targetId || null,
        description: description || null,
        before_value: beforeValue || null,
        after_value: afterValue || null,
      }])
      .select()
      .single();

    if (error) throw error;

    return apiResponse({ log: data }, { status: 201 });
  } catch (err) {
    return apiResponse({ error: logAndSanitize('audit-logs-post', err, '로그 기록 실패') }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
