/**
 * GET /api/cron/meta-token-refresh
 *
 * 매일 09:00 UTC. Meta long-lived access token 만료 전 자동 갱신.
 *
 * 배경:
 *   - Meta long-lived user/page token = 60일 유효
 *   - 매일 사용하면 refresh 자격 있음 (active use rule)
 *   - 55일차 이전에 갱신 API 호출 권장
 *
 * 전략:
 *   - env META_ACCESS_TOKEN 이 long-lived token
 *   - 매일 debug_token 으로 expires_at 확인
 *   - 만료 ≤ 5일이면 새 토큰 발급 요청
 *   - **주의**: Vercel env 는 런타임에서 쓰기 불가 → 새 토큰을 DB `system_secrets` 테이블에 저장.
 *     publish-instagram · threads-publisher 등이 env 우선, DB 폴백 구조로 읽도록 구성.
 *
 * env:
 *   - META_APP_ID
 *   - META_APP_SECRET
 *   - META_ACCESS_TOKEN  (초기 long-lived 토큰)
 *   - CRON_SECRET
 *
 * 실패 시: Slack 알림 (향후) 또는 로그만. 사장님 수동 개입 필요.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { invalidateMetaTokenCache } from '@/lib/meta-token-resolver';
import { withCronLogging } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const maxDuration = 60;

const REFRESH_THRESHOLD_DAYS = 5;  // 만료 5일 전부터 refresh 시도

interface DebugTokenResponse {
  data?: {
    app_id?: string;
    type?: string;
    application?: string;
    expires_at?: number;            // unix sec. 0 이면 영구
    is_valid?: boolean;
    issued_at?: number;
    scopes?: string[];
  };
}

async function runMetaTokenRefresh(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const summary = {
    checked: 0,
    refreshed: 0,
    skipped_still_valid: 0,
    skipped_no_config: 0,
    errors: [] as string[],
    new_expires_at: null as string | null,
  };

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    summary.skipped_no_config += 1;
    summary.errors.push('META_APP_ID 또는 META_APP_SECRET 미설정');
    return summary;
  }

  // 우선순위: DB에 저장된 토큰 > env
  let currentToken: string | null = null;
  let tokenSource: 'db' | 'env' = 'env';
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin
      .from('system_secrets')
      .select('value, updated_at')
      .eq('key', 'META_ACCESS_TOKEN')
      .maybeSingle();
    if (data?.value) {
      currentToken = data.value as string;
      tokenSource = 'db';
    }
  }
  if (!currentToken) currentToken = process.env.META_ACCESS_TOKEN ?? null;
  if (!currentToken) {
    summary.skipped_no_config += 1;
    summary.errors.push('META_ACCESS_TOKEN 소스 없음 (DB/env 모두)');
    return summary;
  }

  summary.checked = 1;

  try {
    // 1. debug_token 으로 만료 확인
    const debugUrl = `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(currentToken)}&access_token=${appId}|${appSecret}`;
    const debugRes = await fetch(debugUrl);
    if (!debugRes.ok) {
      summary.errors.push(`debug_token HTTP ${debugRes.status}`);
      return summary;
    }
    const debug = (await debugRes.json()) as DebugTokenResponse;
    const expiresAt = debug.data?.expires_at ?? 0;  // 0 = 영구
    const nowSec = Math.floor(Date.now() / 1000);
    const daysUntilExpiry = expiresAt > 0 ? (expiresAt - nowSec) / 86400 : Infinity;

    console.log(`[meta-token-refresh] source=${tokenSource}, expires_in_days=${daysUntilExpiry.toFixed(1)}`);

    if (daysUntilExpiry > REFRESH_THRESHOLD_DAYS) {
      summary.skipped_still_valid += 1;
      return summary;
    }

    // 2. 새 long-lived 토큰 발급
    // Meta 는 "기존 토큰으로 exchange" 방식 제공:
    //   GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...
    const refreshUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(currentToken)}`;
    const refreshRes = await fetch(refreshUrl);
    const refreshData = await refreshRes.json();
    if (!refreshRes.ok || !refreshData.access_token) {
      const msg = refreshData?.error?.message || JSON.stringify(refreshData);
      summary.errors.push(`refresh 실패: ${msg}`);
      // 만료 임박 상태에서 refresh 실패 → 사장님 개입 필요. Slack 즉시 알림.
      await sendSlackAlert(
        `🚨 Meta 토큰 자동 갱신 실패 (${daysUntilExpiry.toFixed(1)}일 후 만료) — 수동 개입 필요`,
        { error: msg, source: tokenSource },
      );
      return summary;
    }
    const newToken = refreshData.access_token as string;
    const newExpiresIn = Number(refreshData.expires_in ?? 0);  // 초
    const newExpiresAt = newExpiresIn > 0 ? new Date(Date.now() + newExpiresIn * 1000).toISOString() : null;

    // 3. DB 저장 (env 업데이트 불가능하므로 폴백 테이블)
    if (isSupabaseConfigured) {
      await supabaseAdmin
        .from('system_secrets')
        .upsert({
          key: 'META_ACCESS_TOKEN',
          value: newToken,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        } as never, { onConflict: 'key' });
    }
    // 캐시 무효화 — publisher 가 새 토큰 즉시 사용
    invalidateMetaTokenCache('META_ACCESS_TOKEN');

    summary.refreshed += 1;
    summary.new_expires_at = newExpiresAt;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`unexpected: ${errMsg}`);
    await sendSlackAlert('🚨 Meta 토큰 refresh 크론 예외', { error: errMsg });
  }

  return summary;
}

export const GET = withCronLogging('meta-token-refresh', runMetaTokenRefresh);
