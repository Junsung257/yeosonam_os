/**
 * ══════════════════════════════════════════════════════════
 * 최적화 로그 API
 * ══════════════════════════════════════════════════════════
 *
 * GET /api/admin/optimization/logs
 *   - 최적화 실행 로그 목록 (최신순)
 *   - 쿼리: platform, limit (기본 50)
 *   - 인증: 관리자 세션 또는 CRON_SECRET/SUPABASE_SERVICE_ROLE_KEY Bearer
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { createClient } from '@supabase/supabase-js';
import { isAdminRequest } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 인증
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = getSecret('CRON_SECRET');
  const serviceKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  const isBearerAuthorized =
    authHeader.startsWith('Bearer ') &&
    (authHeader.slice(7) === cronSecret || authHeader.slice(7) === serviceKey);

  if (!isBearerAuthorized && !(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);

  try {
    const url = getSecret('NEXT_PUBLIC_SUPABASE_URL');
    const key = getSecret('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }
    const supabase = createClient(url, key);

    let query = supabase
      .from('optimization_log')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(limit);

    if (platform && platform !== 'all') {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
