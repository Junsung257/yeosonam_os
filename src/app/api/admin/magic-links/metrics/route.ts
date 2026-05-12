/**
 * GET /api/admin/magic-links/metrics?days=7 — 매직링크 발급·전환 지표.
 *
 * 반환:
 *   - mintedCount: 발급 건수
 *   - confirmedCount: POST-confirm 클릭한 건수 (SafeLinks 우회 후 진짜 사용자 클릭)
 *   - consumedCount: 액션 완료(used_at 기록) 건수
 *   - revokedCount: 폐기 건수
 *   - expiredActive: 만료됐지만 미사용 (lost) 건수
 *   - byAction: { action_type: { minted, confirmed, consumed } }
 *   - confirmRate: confirmed / minted
 *   - consumeRate: consumed / confirmed
 *
 * 데이터: magic_action_tokens 만 사용 (created_at 기준 N일 윈도우)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { supabaseAdmin } from '@/lib/supabase';

export const GET = withAdminGuard(async (req: NextRequest) => {
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10) || 7, 1), 90);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('action_type, confirmed_at, used_at, revoked_at, expires_at, recipient_channel')
    .gte('created_at', since)
    .limit(10_000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    action_type: string;
    confirmed_at: string | null;
    used_at: string | null;
    revoked_at: string | null;
    expires_at: string;
    recipient_channel: string | null;
  };
  const rows = (data ?? []) as Row[];

  let mintedCount = 0;
  let confirmedCount = 0;
  let consumedCount = 0;
  let revokedCount = 0;
  let expiredActive = 0;
  const byAction: Record<string, { minted: number; confirmed: number; consumed: number }> = {};
  const byChannel: Record<string, number> = {};

  for (const r of rows) {
    mintedCount++;
    if (r.confirmed_at) confirmedCount++;
    if (r.used_at) consumedCount++;
    if (r.revoked_at) revokedCount++;
    if (!r.used_at && !r.revoked_at && r.expires_at < now) expiredActive++;

    if (!byAction[r.action_type]) byAction[r.action_type] = { minted: 0, confirmed: 0, consumed: 0 };
    byAction[r.action_type].minted++;
    if (r.confirmed_at) byAction[r.action_type].confirmed++;
    if (r.used_at) byAction[r.action_type].consumed++;

    const ch = r.recipient_channel ?? 'unknown';
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
  }

  return NextResponse.json({
    windowDays: days,
    since,
    mintedCount,
    confirmedCount,
    consumedCount,
    revokedCount,
    expiredActive,
    confirmRate: mintedCount ? confirmedCount / mintedCount : 0,
    consumeRate: confirmedCount ? consumedCount / confirmedCount : 0,
    byAction,
    byChannel,
  });
});
