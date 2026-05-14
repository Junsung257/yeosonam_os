/**
 * @file POST /api/admin/attractions/retry-unmatched
 *
 * unmatched_activities 의 pending 항목을 새 Hangul fuzzy + MRT canonical 매칭기로 retry.
 * 매칭 성공 시:
 *   - unmatched_activities.status = 'resolved'
 *   - attractions_aliases 자동 누적 (matcher 내부에서 fire-and-forget)
 *
 * 2026-05-14 Sprint 1 후속 — 누적된 537건의 unmatched 를 새 매칭기로 자동 해소.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { matchAttraction, type AttractionData } from '@/lib/attraction-matcher';

interface UnmatchedRow {
  id: number;
  activity: string;
  country: string | null;
  region: string | null;
  status: string;
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const limit = Math.min(Math.max(parseInt(limitParam ?? '600', 10) || 600, 1), 2000);

    // 1) attractions 전체 로드 (matcher 인덱스에 mrt_gid 포함)
    const attractions: AttractionData[] = [];
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from('attractions')
        .select('id, name, country, region, aliases, mrt_gid')
        .eq('is_active', true)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      attractions.push(...(data as unknown as AttractionData[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // 2) unmatched_activities pending 로드
    const { data: unmatched, error: unErr } = await supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, country, region, status')
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(limit);
    if (unErr) throw unErr;

    const rows = (unmatched ?? []) as UnmatchedRow[];

    let resolved = 0;
    const skipped: string[] = [];
    const sampleMatches: { activity: string; canonical: string; mrt: boolean }[] = [];

    for (const row of rows) {
      const dest = row.region || row.country || '';
      const match = matchAttraction(row.activity, attractions, dest);
      if (!match) {
        skipped.push(row.activity);
        continue;
      }
      // resolved 처리
      await supabaseAdmin
        .from('unmatched_activities')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: 'hangul-fuzzy-retry',
          resolved_attraction_id: match.id ?? null,
          resolved_kind: match.mrt_gid ? 'mrt-canonical' : 'hangul-fuzzy',
        })
        .eq('id', row.id)
        .then(undefined, () => {});
      resolved++;
      if (sampleMatches.length < 20) {
        sampleMatches.push({
          activity: row.activity,
          canonical: match.name,
          mrt: !!match.mrt_gid,
        });
      }
    }

    return NextResponse.json({
      attractions_loaded: attractions.length,
      unmatched_processed: rows.length,
      resolved,
      remaining_pending: rows.length - resolved,
      sample_matches: sampleMatches,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '검토 실패' },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
