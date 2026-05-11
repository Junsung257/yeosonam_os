/**
 * GET /api/admin/badge-counts
 *
 * AdminLayout 사이드바 배지 통합 엔드포인트.
 * 기존: 마운트마다 5개 fetch (unmatched / agent-actions / ledger / packages / blog).
 * 신규: 단일 RPC 1 round-trip + 30초 브라우저 캐시 + 60초 CDN 캐시.
 *
 * 감사: docs/audits/2026-05-11-admin-perf-audit.md
 * 마이그레이션: 20260518000000_admin_perf_summary_rpcs.sql
 *
 * 응답:
 *   {
 *     pendingActions:  number,
 *     unmatchedPending: number,
 *     pendingPackages: number,
 *     // 무거운 RPC(reconcile) 는 별도 lazy fetch — 0 으로 두고 클라이언트에서
 *     // /api/admin/ledger/reconcile-status 직접 호출 시점은 사용자 액션 또는 페이지 마운트.
 *     ledgerDrift:     number,
 *     blogQueue:       number,
 *     computedAt:      string,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_CACHE } from '@/lib/admin-cache';

export const runtime = 'nodejs';
// 동적이지만 응답 캐시 헤더로 CDN/브라우저 캐시 활용
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({
      pendingActions: 0,
      unmatchedPending: 0,
      pendingPackages: 0,
      ledgerDrift: 0,
      blogQueue: 0,
      computedAt: new Date().toISOString(),
    });
  }

  const { data, error } = await supabaseAdmin.rpc('get_admin_badge_counts');

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 },
    );
  }

  const counts = (data ?? {}) as {
    pending_actions?: number;
    unmatched_pending?: number;
    pending_packages?: number;
    computed_at?: string;
  };

  return NextResponse.json(
    {
      pendingActions:   counts.pending_actions   ?? 0,
      unmatchedPending: counts.unmatched_pending ?? 0,
      pendingPackages:  counts.pending_packages  ?? 0,
      // 무거운 RPC(reconcile)·blog_queue 는 별도 lazy fetch — 통합 RPC 에서 제외.
      ledgerDrift: 0,
      blogQueue:   0,
      computedAt:  counts.computed_at ?? new Date().toISOString(),
    },
    { headers: ADMIN_CACHE.hot },
  );
}
