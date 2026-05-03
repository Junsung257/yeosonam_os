import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const maxDuration = 120;

// ── 마크업 규칙 (우선순위 내림차순) ─────────────────────────────
const MARKUP_RULES = [
  {
    id: 'scarcity-extreme',
    markup: 0.12,
    reason: '잔여석 2석 이하',
    check: (filled: number, quota: number, _spike: number) =>
      quota > 0 && quota - filled <= 2,
  },
  {
    id: 'scarcity-high',
    markup: 0.08,
    reason: '소진율 80%+',
    check: (filled: number, quota: number, _spike: number) =>
      quota > 0 && filled / quota >= 0.8,
  },
  {
    id: 'demand-spike',
    markup: 0.05,
    reason: '조회수 주간 300%+ 급등',
    check: (_f: number, _q: number, spike: number) => spike >= 3.0,
  },
] as const;

const LEAD_DAYS = 90; // 출발 D-90 이내 패키지만 대상

interface PkgRow {
  id: string;
  title: string;
  destination: string;
  hard_block_quota: number | null;
  view_count: number;
  view_count_weekly_snap: number;
  view_count_snap_at: string | null;
  price_dates: Array<{ date: string }> | null;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });

  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date();
    const cutoff = new Date(today.getTime() + LEAD_DAYS * 86400_000);
    const oneWeekAgo = new Date(today.getTime() - 7 * 86400_000);

    // 1. 활성 패키지 조회
    const { data: packages, error: pkgErr } = await supabaseAdmin
      .from('travel_packages')
      .select(
        'id, title, destination, hard_block_quota, view_count, view_count_weekly_snap, view_count_snap_at, price_dates',
      )
      .eq('status', 'approved');

    if (pkgErr) throw pkgErr;
    if (!packages?.length) return NextResponse.json({ processed: 0 });

    // 2. D-90 이내 출발 패키지 필터
    const upcoming = (packages as PkgRow[]).filter((pkg) =>
      (pkg.price_dates ?? []).some((pd) => {
        const dt = new Date(pd.date + 'T00:00:00');
        return dt >= today && dt <= cutoff;
      }),
    );

    // 3. 패키지별 확정 예약 수 조회
    const pkgIds = upcoming.map((p) => p.id);
    const { data: bookings, error: bkErr } = await supabaseAdmin
      .from('bookings')
      .select('package_id, headcount')
      .in('package_id', pkgIds)
      .in('status', ['deposit_paid', 'waiting_balance', 'fully_paid']);

    if (bkErr) throw bkErr;

    const filledMap: Record<string, number> = {};
    for (const b of bookings ?? []) {
      filledMap[b.package_id] =
        (filledMap[b.package_id] ?? 0) + (b.headcount ?? 1);
    }

    // 4. 각 패키지에 마크업 규칙 적용
    type UpdateRow = {
      id: string;
      price_markup_rate: number;
      dp_reason: string | null;
      dp_triggered_at: string | null;
      view_count_weekly_snap: number;
      view_count_snap_at: string;
    };

    const updates: UpdateRow[] = [];
    const applied: string[] = [];
    const reset: string[] = [];

    for (const pkg of upcoming) {
      const filled = filledMap[pkg.id] ?? 0;
      const quota = pkg.hard_block_quota ?? 0;

      // 주간 스냅샷 기준 조회수 증가율 계산
      const snapOutdated =
        !pkg.view_count_snap_at ||
        new Date(pkg.view_count_snap_at) < oneWeekAgo;
      const snapViews = snapOutdated ? 0 : pkg.view_count_weekly_snap;
      const viewsDelta = pkg.view_count - snapViews;
      const spikeRatio =
        snapViews > 10 ? viewsDelta / snapViews : 0;

      // 첫 번째 매칭 규칙 적용
      const matched = MARKUP_RULES.find((rule) =>
        rule.check(filled, quota, spikeRatio),
      );

      const nowIso = today.toISOString();

      if (matched) {
        updates.push({
          id: pkg.id,
          price_markup_rate: matched.markup,
          dp_reason: matched.reason,
          dp_triggered_at: nowIso,
          view_count_weekly_snap: snapOutdated ? pkg.view_count : pkg.view_count_weekly_snap,
          view_count_snap_at: snapOutdated ? nowIso : pkg.view_count_snap_at!,
        });
        applied.push(`${pkg.title}(${pkg.destination}) +${Math.round(matched.markup * 100)}% [${matched.reason}]`);
      } else {
        // 조건 해소 시 마크업 초기화
        updates.push({
          id: pkg.id,
          price_markup_rate: 0,
          dp_reason: null,
          dp_triggered_at: null,
          view_count_weekly_snap: snapOutdated ? pkg.view_count : pkg.view_count_weekly_snap,
          view_count_snap_at: snapOutdated ? nowIso : (pkg.view_count_snap_at ?? nowIso),
        });
        if (snapOutdated) reset.push(pkg.id);
      }
    }

    // 5. Bulk update (배치 10개씩)
    const CHUNK = 10;
    const updateErrors: string[] = [];
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      for (const row of chunk) {
        const { error: updateErr } = await supabaseAdmin
          .from('travel_packages')
          .update({
            price_markup_rate: row.price_markup_rate,
            dp_reason: row.dp_reason,
            dp_triggered_at: row.dp_triggered_at,
            view_count_weekly_snap: row.view_count_weekly_snap,
            view_count_snap_at: row.view_count_snap_at,
          })
          .eq('id', row.id);
        if (updateErr) updateErrors.push(`${row.id}: ${updateErr.message}`);
      }
    }
    if (updateErrors.length > 0) {
      await sendSlackAlert(`[dynamic-pricing] 업데이트 실패 ${updateErrors.length}건`, { errors: updateErrors });
    }

    // 6. Slack 리포트 (마크업 적용 건 있을 때만)
    if (applied.length > 0) {
      await sendSlackAlert(
        `📈 [Dynamic Pricing] 마크업 적용 ${applied.length}건`,
        { applied, checkedAt: today.toISOString() },
      );
    }

    return NextResponse.json({
      checked: packages.length,
      upcoming: upcoming.length,
      markupApplied: applied.length,
      snapReset: reset.length,
      applied,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendSlackAlert(`[dynamic-pricing] 크론 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
