/**
 * POST /api/admin/ads-automation/keyword-toggle
 *
 * 사장님이 어드민 페이지에서 키워드 1-click PAUSE/RESUME.
 * - DB 상태 즉시 변경
 * - 외부 광고 플랫폼은 isXxxAdsConfigured + 사장님 확인 시에만
 *
 * Body: { keywordId: string, action: 'PAUSE' | 'RESUME' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  pauseNaverKeyword,
  pauseGoogleKeyword,
  isNaverAdsConfigured,
  isGoogleAdsConfigured,
} from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  let body: { keywordId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }
  const { keywordId, action } = body;
  if (!keywordId || (action !== 'PAUSE' && action !== 'RESUME')) {
    return NextResponse.json({ error: 'keywordId + action(PAUSE|RESUME) 필수' }, { status: 400 });
  }

  // 현재 row 조회 (platform + 기존 status)
  const { data, error } = await supabaseAdmin
    .from('keyword_performances')
    .select('id, platform, keyword, status, pause_count, permanently_paused')
    .eq('id', keywordId)
    .limit(1);
  if (error || !data?.[0]) {
    return NextResponse.json({ error: '키워드 조회 실패' }, { status: 404 });
  }
  const kw = data[0] as {
    id: string;
    platform: 'naver' | 'google' | 'meta';
    keyword: string;
    status: string;
    pause_count?: number;
    permanently_paused?: boolean;
  };

  const externalResults: { platform: string; ok: boolean; reason?: string }[] = [];

  if (action === 'PAUSE') {
    await supabaseAdmin
      .from('keyword_performances')
      .update({
        status: 'PAUSED',
        last_paused_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', keywordId);

    // 외부 플랫폼도 동기화 (키 설정된 경우만)
    if (kw.platform === 'naver' && isNaverAdsConfigured()) {
      const ok = await pauseNaverKeyword(kw.id);
      externalResults.push({ platform: 'naver', ok });
    } else if (kw.platform === 'google' && isGoogleAdsConfigured()) {
      const ok = await pauseGoogleKeyword(kw.id);
      externalResults.push({ platform: 'google', ok });
    } else {
      externalResults.push({
        platform: kw.platform,
        ok: true,
        reason: 'API 키 미설정 — DB 만 반영',
      });
    }
  } else {
    // RESUME: 영구 PAUSE 해제 + status='ACTIVE'
    await supabaseAdmin
      .from('keyword_performances')
      .update({
        status: 'ACTIVE',
        permanently_paused: false,
        last_reactivation_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', keywordId);

    // 외부 RESUME 은 다음 ad-optimizer 사이클에서 자동 적용 (ROAS 기준 재평가)
    externalResults.push({
      platform: kw.platform,
      ok: true,
      reason: '외부 RESUME 은 다음 ad-optimizer cron 사이클에서 자동 (ROAS 재측정 후)',
    });
  }

  return NextResponse.json({
    ok: true,
    keyword: kw.keyword,
    platform: kw.platform,
    previousStatus: kw.status,
    newStatus: action === 'PAUSE' ? 'PAUSED' : 'ACTIVE',
    externalResults,
  });
}
