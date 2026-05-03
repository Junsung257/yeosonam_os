/**
 * GET /api/admin/free-travel/experiments
 *
 * 자유여행 패키지 크로스셀 A/B(recommendation_outcomes), 가이드북 클릭, 카카오 템플릿 진단.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getKakaoAlimtalkDiagnostics } from '@/lib/kakao-diagnostics';

export const runtime = 'nodejs';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? 30)));
  /** 기간 내 최대 적재 행 (초과 시 truncated, 페이지당 1000건 조회) */
  const maxRows = Math.min(50_000, Math.max(1_000, Number(req.nextUrl.searchParams.get('maxRows') ?? 20_000)));
  const since = daysAgoIso(days);
  const kakao = getKakaoAlimtalkDiagnostics();
  const PAGE = 1000;

  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({
      since,
      days,
      crosssell: null,
      guidebook: null,
      kakao,
      message: 'Supabase 미설정',
    });
  }

  type RecRow = { outcome: string | null; notes: string | null; session_id: string | null };

  const recRows: RecRow[] = [];
  let recErrMsg: string | null = null;
  let crosssellTruncated = false;
  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('recommendation_outcomes')
      .select('outcome, notes, session_id')
      .eq('source', 'list_badge')
      .gte('created_at', since)
      .ilike('notes', '%crosssell%')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      recErrMsg = error.message;
      console.error('[experiments] recommendation_outcomes', error);
      break;
    }
    const chunk = (data ?? []) as RecRow[];
    recRows.push(...chunk);
    if (chunk.length < PAGE) break;
    if (recRows.length >= maxRows) {
      crosssellTruncated = true;
      break;
    }
  }

  const gbRows: { action: string }[] = [];
  let gbErrMsg: string | null = null;
  let guidebookTruncated = false;
  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('guidebook_events')
      .select('action')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      gbErrMsg = error.message;
      console.error('[experiments] guidebook_events', error);
      break;
    }
    const chunk = (data ?? []) as { action: string }[];
    gbRows.push(...chunk);
    if (chunk.length < PAGE) break;
    if (gbRows.length >= maxRows) {
      guidebookTruncated = true;
      break;
    }
  }

  const variant = (notes: string | null): 'A' | 'B' | '?' => {
    if (!notes) return '?';
    if (notes.includes('_variant_A')) return 'A';
    if (notes.includes('_variant_B')) return 'B';
    return '?';
  };

  const crosssell = {
    days,
    exposure: { A: 0, B: 0, unknown: 0 },
    clicks: { A: 0, B: 0, unknown: 0 },
  };

  const exposedSessions = {
    A: new Set<string>(),
    B: new Set<string>(),
    unknown: new Set<string>(),
  };
  const clickedSessions = {
    A: new Set<string>(),
    B: new Set<string>(),
    unknown: new Set<string>(),
  };
  let skippedExposureNoSession = 0;
  let skippedClickNoSession = 0;

  for (const row of recRows) {
    const n = row.notes ?? '';
    const v = variant(row.notes);
    const sid = row.session_id?.trim() || null;

    if (n.includes('crosssell_exposure')) {
      if (v === 'A') crosssell.exposure.A++;
      else if (v === 'B') crosssell.exposure.B++;
      else crosssell.exposure.unknown++;

      if (sid) {
        if (v === 'A') exposedSessions.A.add(sid);
        else if (v === 'B') exposedSessions.B.add(sid);
        else exposedSessions.unknown.add(sid);
      } else {
        skippedExposureNoSession++;
      }
    }
    if (n.includes('crosssell_click') && row.outcome === 'click') {
      if (v === 'A') crosssell.clicks.A++;
      else if (v === 'B') crosssell.clicks.B++;
      else crosssell.clicks.unknown++;

      if (sid) {
        if (v === 'A') clickedSessions.A.add(sid);
        else if (v === 'B') clickedSessions.B.add(sid);
        else clickedSessions.unknown.add(sid);
      } else {
        skippedClickNoSession++;
      }
    }
  }

  const expA = exposedSessions.A.size;
  const expB = exposedSessions.B.size;
  const clkA = clickedSessions.A.size;
  const clkB = clickedSessions.B.size;

  const guidebookByAction: Record<string, number> = {};
  for (const r of gbRows) {
    guidebookByAction[r.action] = (guidebookByAction[r.action] ?? 0) + 1;
  }

  const exposureRowsApprox = crosssell.exposure.A + crosssell.exposure.B + crosssell.exposure.unknown;
  const clickRows = crosssell.clicks.A + crosssell.clicks.B + crosssell.clicks.unknown;

  return NextResponse.json({
    since,
    days,
    maxRows,
    truncated: { crosssell: crosssellTruncated, guidebook: guidebookTruncated },
    queryErrors: { crosssell: recErrMsg, guidebook: gbErrMsg },
    crosssell: {
      exposure: crosssell.exposure,
      clicks: crosssell.clicks,
      ctrApprox: {
        A:
          crosssell.exposure.A > 0
            ? Math.round((crosssell.clicks.A / crosssell.exposure.A) * 1000) / 1000
            : null,
        B:
          crosssell.exposure.B > 0
            ? Math.round((crosssell.clicks.B / crosssell.exposure.B) * 1000) / 1000
            : null,
      },
      ctrPercent: {
        A:
          crosssell.exposure.A > 0
            ? Math.round((crosssell.clicks.A / crosssell.exposure.A) * 1000) / 10
            : null,
        B:
          crosssell.exposure.B > 0
            ? Math.round((crosssell.clicks.B / crosssell.exposure.B) * 1000) / 10
            : null,
      },
      bySession: {
        exposureSessions: { A: expA, B: expB, unknown: exposedSessions.unknown.size },
        clickSessions: { A: clkA, B: clkB, unknown: clickedSessions.unknown.size },
        ctrPercentBySession: {
          A: expA > 0 ? Math.round((clkA / expA) * 1000) / 10 : null,
          B: expB > 0 ? Math.round((clkB / expB) * 1000) / 10 : null,
        },
        skippedRowsWithoutSessionId: {
          exposure: skippedExposureNoSession,
          click: skippedClickNoSession,
        },
      },
      rowCounts: { exposuresAndClicks: recRows.length, exposureRowsApprox, clickRows },
    },
    guidebook: {
      total: gbRows.length,
      byAction: guidebookByAction,
      tableMissing: !!gbErrMsg,
    },
    kakao,
  });
}
