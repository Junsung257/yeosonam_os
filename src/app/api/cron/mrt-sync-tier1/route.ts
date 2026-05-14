/**
 * MRT 3-Tier Hybrid — Tier 1 Eager Pre-Sync (2026-05-14 박제)
 *
 * 주력 30 destination 의 MRT TNA/attractions 를 주 1회 sync 하여 attractions 테이블에
 * mrt_gid canonical 을 미리 박아둠. 사장님 등록 시 즉시 fast match.
 *
 * 스케줄 (vercel.json 또는 외부 cron 에서):
 *   weekly: 매주 월요일 새벽 (예: 0 18 * * 0 UTC = 한국 월 03:00)
 *
 * GET /api/cron/mrt-sync-tier1?secret=CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { spawn } from 'node:child_process';
import path from 'node:path';

// 사장님 주력 destination — 누적 등록 빈도 + MRT 카테고리 coverage 기준.
// 신규 추가 시 여기에 한 줄. 너무 많으면 일 cron 으로 분산.
const TIER1_DESTINATIONS = [
  '다낭', '하노이', '호치민', '나트랑', '푸꾸옥', '하노이/하롱베이',
  '오사카', '도쿄', '후쿠오카', '삿포로', '오키나와',
  '서안', '장가계', '북경', '상해', '계림', '황산',
  '방콕', '치앙마이', '푸켓', '싱가포르',
  '세부', '보라카이', '마닐라', '보홀',
  '대만', '타이베이', '가오슝',
  '발리', '코타키나발루',
  '괌', '사이판',
];

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, message: 'DB 미설정' });
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const startedAt = new Date().toISOString();
  const url = new URL(request.url);
  // dryRun=1 → 실제 sync 안 하고 대상만 리포트
  const dryRun = url.searchParams.get('dryRun') === '1';
  // limit 으로 한 번에 처리할 destination 수 제한 (기본 8개 — Vercel 5분 제한 고려)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '8', 10) || 8, 1), 32);

  try {
    // 1) 각 destination 의 현재 MRT canonical attraction 수 점검 → 부족한 destination 우선
    const stats: Array<{ destination: string; current: number; needs_sync: boolean }> = [];
    for (const dest of TIER1_DESTINATIONS) {
      const { count } = await supabaseAdmin
        .from('attractions')
        .select('id', { count: 'exact', head: true })
        .not('mrt_gid', 'is', null)
        .or(`region.ilike.%${dest}%,name.ilike.%${dest}%`);
      const cur = count ?? 0;
      stats.push({ destination: dest, current: cur, needs_sync: cur < 10 });
    }

    // 우선순위: needs_sync 먼저, 그 후 current 낮은 순
    stats.sort((a, b) => {
      if (a.needs_sync !== b.needs_sync) return a.needs_sync ? -1 : 1;
      return a.current - b.current;
    });
    const targets = stats.slice(0, limit);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        startedAt,
        targets,
        totalDestinations: TIER1_DESTINATIONS.length,
      });
    }

    // 2) sync 시도 (Vercel/serverless 면 sync_mrt_attractions.js spawn 불가 — 시도만 기록)
    const isServerless = process.env.NODE_ENV === 'production' && !!process.env.VERCEL;
    const triggered: string[] = [];
    const queuedOnly: string[] = [];

    for (const t of targets) {
      // 시도 기록
      await supabaseAdmin
        .from('mrt_sync_attempts')
        .insert({
          destination: t.destination,
          attempted_at: new Date().toISOString(),
          status: isServerless ? 'queued' : 'spawned',
        })
        .then(undefined, () => {});

      if (isServerless) {
        queuedOnly.push(t.destination);
        continue;
      }

      try {
        const scriptPath = path.resolve(process.cwd(), 'db', 'sync_mrt_attractions.js');
        const proc = spawn('node', [scriptPath, '--destination', t.destination], {
          detached: true,
          stdio: 'ignore',
        });
        proc.unref();
        triggered.push(t.destination);
      } catch (e) {
        console.warn(`[MRT-Tier1] ${t.destination} spawn 실패:`, e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      isServerless,
      triggered_count: triggered.length,
      triggered,
      queued_only: queuedOnly,
      remaining_in_tier1: stats.length - targets.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '에러' },
      { status: 500 },
    );
  }
}
