/**
 * API: 어필리에이터 콘텐츠 인사이트
 *
 * GET  /api/affiliate/insights?affiliate_id=xxx - 인사이트 목록 조회
 * POST /api/affiliate/insights - 인사이트 수동 생성/갱신
 * PATCH /api/affiliate/insights/:id/read - 읽음 처리
 */
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  getAffiliateInsights,
  analyzeAndSaveInsights,
} from '@/lib/card-news/affiliate-feedback';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** GET: 어필리에이터 인사이트 목록 */
const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  const affiliateId = request.nextUrl.searchParams.get('affiliate_id');
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10),
    100,
  );

  if (!affiliateId) {
    return apiResponse({ error: 'affiliate_id 필수' }, { status: 400 });
  }

  try {
    const insights = await getAffiliateInsights(affiliateId, limit);
    return apiResponse({ insights });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

/** POST: 인사이트 생성/갱신 */
const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  let body: { affiliate_id: string; affiliate_name?: string };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.affiliate_id) {
    return apiResponse({ error: 'affiliate_id 필수' }, { status: 400 });
  }

  try {
    const name = body.affiliate_name ?? '파트너';
    const insights = await analyzeAndSaveInsights(body.affiliate_id, name);
    return apiResponse({
      success: true,
      insights_generated: insights.length,
      insights,
    });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
