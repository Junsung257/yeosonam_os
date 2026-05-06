import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/content-hub
 * content_hub 통합 뷰 조회 (card_news + blog)
 *
 * Query params:
 *   tenant_id  - 테넌트 필터 (필수)
 *   type       - 'card_news' | 'blog' | 'all' (기본 'all')
 *   status     - 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'all'
 *   days       - 조회 기간 (기본 30)
 *   page       - 페이지 (기본 1)
 *   limit      - 페이지당 건수 (기본 20, 최대 100)
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [], total: 0 });

  const { searchParams } = request.nextUrl;
  const tenantId  = searchParams.get('tenant_id');
  const type      = searchParams.get('type') ?? 'all';
  const status    = searchParams.get('status') ?? 'all';
  const days      = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 365);
  const page      = Math.max(parseInt(searchParams.get('page') ?? '1', 10), 1);
  const limit     = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const offset    = (page - 1) * limit;

  try {
    let query = supabaseAdmin
      .from('content_hub')
      .select('*', { count: 'exact' })
      .gte('created_at', new Date(Date.now() - days * 86400_000).toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (type !== 'all') query = query.eq('content_type', type);
    if (status !== 'all') query = query.eq('status', status);

    const { data, count, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data, total: count ?? 0, page, limit });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
