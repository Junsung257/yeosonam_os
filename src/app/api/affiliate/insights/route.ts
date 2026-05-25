/**
 * API: 어필리에이터 콘텐츠 인사이트
 *
 * GET  /api/affiliate/insights?affiliate_id=xxx - 인사이트 목록 조회
 * POST /api/affiliate/insights - 인사이트 수동 생성/갱신
 * PATCH /api/affiliate/insights/:id/read - 읽음 처리
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  getAffiliateInsights,
  analyzeAndSaveInsights,
  markInsightAsRead,
} from '@/lib/card-news/affiliate-feedback';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** GET: 어필리에이터 인사이트 목록 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const affiliateId = request.nextUrl.searchParams.get('affiliate_id');
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10),
    100,
  );

  if (!affiliateId) {
    return NextResponse.json({ error: 'affiliate_id 필수' }, { status: 400 });
  }

  try {
    const insights = await getAffiliateInsights(affiliateId, limit);
    return NextResponse.json({ insights });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST: 인사이트 생성/갱신 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  let body: { affiliate_id: string; affiliate_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.affiliate_id) {
    return NextResponse.json({ error: 'affiliate_id 필수' }, { status: 400 });
  }

  try {
    const name = body.affiliate_name ?? '파트너';
    const insights = await analyzeAndSaveInsights(body.affiliate_id, name);
    return NextResponse.json({
      success: true,
      insights_generated: insights.length,
      insights,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
