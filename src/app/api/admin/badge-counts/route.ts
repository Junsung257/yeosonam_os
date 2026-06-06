/**
 * GET /api/admin/badge-counts
 *
 * AdminLayout 사이드바 배지 통합 엔드포인트.
 * 기존: 마운트마다 5개 fetch (unmatched / agent-actions / ledger / packages / blog).
 * 신규: 핵심 RPC + 가벼운 head count 보정 + 30초 브라우저 캐시 + 60초 CDN 캐시.
 *
 * 감사: docs/audits/2026-05-11-admin-perf-audit.md
 * 마이그레이션: 20260518000000_admin_perf_summary_rpcs.sql
 *
 * 응답:
 *   {
 *     pendingActions:  number,
 *     unmatchedPending: number,
 *     pendingPackages: number,
 *     paymentUnmatched: number,
 *     // 무거운 RPC(reconcile) 는 별도 lazy fetch — 0 으로 두고 클라이언트에서
 *     // /api/admin/ledger/reconcile-status 직접 호출 시점은 사용자 액션 또는 페이지 마운트.
 *     ledgerDrift:     number,
 *     blogQueue:       number,
 *     computedAt:      string,
 *   }
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_CACHE } from '@/lib/admin-cache';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
// 동적이지만 응답 캐시 헤더로 CDN/브라우저 캐시 활용
export const dynamic = 'force-dynamic';

async function readOptionalCount(
  label: string,
  query: PromiseLike<{ count: number | null; error: { message?: string } | null }>,
) {
  const { count, error } = await query;
  if (error) {
    console.warn(`[badge-counts] optional count failed: ${label}`, error.message ?? error);
    return 0;
  }
  return count ?? 0;
}

const getHandler = async (_req: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({
      pendingActions: 0,
      unmatchedPending: 0,
      pendingPackages: 0,
      paymentUnmatched: 0,
      ledgerDrift: 0,
      blogQueue: 0,
      computedAt: new Date().toISOString(),
    });
  }

  const [coreResult, pendingPackageResult, paymentResult, blogResult] = await Promise.allSettled([
    supabaseAdmin.rpc('get_admin_badge_counts'),
    readOptionalCount(
      'pending_packages',
      supabaseAdmin
        .from('travel_packages')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'pending_review', 'draft']),
    ),
    readOptionalCount(
      'payment_unmatched',
      supabaseAdmin
        .from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .in('match_status', ['unmatched', 'review', 'error'])
        .neq('status', 'excluded'),
    ),
    readOptionalCount(
      'blog_queue',
      supabaseAdmin
        .from('content_creatives')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'naver_blog')
        .eq('status', 'draft'),
    ),
  ]);

  if (coreResult.status === 'rejected') {
    return apiResponse(
      { error: coreResult.reason instanceof Error ? coreResult.reason.message : 'Badge count failed' },
      { status: 500 },
    );
  }

  const { data, error } = coreResult.value;

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  const counts = (data ?? {}) as {
    pending_actions?: number;
    unmatched_pending?: number;
    pending_packages?: number;
    computed_at?: string;
  };
  const pendingPackages = pendingPackageResult.status === 'fulfilled'
    ? pendingPackageResult.value
    : counts.pending_packages ?? 0;
  const paymentUnmatched = paymentResult.status === 'fulfilled' ? paymentResult.value : 0;
  const blogQueue = blogResult.status === 'fulfilled' ? blogResult.value : 0;

  return apiResponse(
    {
      pendingActions:   counts.pending_actions   ?? 0,
      unmatchedPending: counts.unmatched_pending ?? 0,
      pendingPackages,
      paymentUnmatched,
      // 무거운 RPC(reconcile)는 별도 lazy fetch — 통합 RPC에서 제외.
      ledgerDrift: 0,
      blogQueue,
      computedAt:  counts.computed_at ?? new Date().toISOString(),
    },
    { headers: ADMIN_CACHE.hot },
  );
}

export const GET = withAdminGuard(getHandler);
