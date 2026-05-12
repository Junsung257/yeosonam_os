/**
 * GET /api/cron/magic-tokens-cleanup — 매직링크 토큰 + 감사 로그 청소.
 *
 * 동작:
 *   - magic_action_tokens: expires_at + retention_days(기본 30) 지난 행 삭제
 *   - magic_link_audit: occurred_at 90일 지난 행 삭제
 *
 * 인증: withCronGuard (CRON_SECRET Bearer)
 * 실행 주기: 일 1회 권장 (vercel.json 또는 vercel.ts crons 에 추가)
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronGuard } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getHandler = async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .rpc('cleanup_expired_magic_tokens', { retention_days: 30 } as never);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    // RPC returns table — supabase JS wraps as array of rows
    const row = Array.isArray(data) ? data[0] : data;
    const r = row as { deleted_tokens?: number; archived_audit?: number } | null;

    return NextResponse.json({
      ok: true,
      deletedTokens: Number(r?.deleted_tokens ?? 0),
      archivedAudit: Number(r?.archived_audit ?? 0),
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'cleanup_failed' },
      { status: 500 },
    );
  }
};

export const GET = withCronGuard(getHandler);
