import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const maxDuration = 60;

const FILL_RATE_THRESHOLD = 0.5; // 50% 미만이면 경고
const LEAD_DAYS = 60;            // 출발 D-60 이내 패키지만 감지

interface PackageRow {
  id: string;
  title: string;
  destination: string;
  hard_block_quota: number;
  price_dates: Array<{ date: string; price: number; confirmed: boolean }> | null;
}

interface AlertItem {
  id: string;
  title: string;
  destination: string;
  quota: number;
  filled: number;
  fillRate: number;
  nextDeparture: string;
  daysUntilDeparture: number;
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
    // 1. 하드블럭 설정된 활성 패키지 조회
    const { data: packages, error: pkgErr } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, hard_block_quota, price_dates')
      .eq('status', 'approved')
      .not('hard_block_quota', 'is', null)
      .gt('hard_block_quota', 0);

    if (pkgErr) throw pkgErr;
    if (!packages?.length) {
      return NextResponse.json({ checked: 0, upcomingCount: 0, alerts: 0 });
    }

    // 2. price_dates JSONB에서 D-60 이내 출발일이 있는 패키지만 추출
    const today = new Date();
    const cutoff = new Date(today.getTime() + LEAD_DAYS * 24 * 60 * 60 * 1000);

    type UpcomingPkg = PackageRow & { nextDeparture: string; daysUntilDeparture: number };

    const upcoming: UpcomingPkg[] = (packages as PackageRow[])
      .flatMap((pkg) => {
        const futureDates = (pkg.price_dates ?? [])
          .map((pd) => pd.date)
          .filter((d) => {
            const dt = new Date(d + 'T00:00:00');
            return dt >= today && dt <= cutoff;
          })
          .sort();

        if (!futureDates.length) return [];

        const nextDeparture = futureDates[0];
        const daysUntilDeparture = Math.ceil(
          (new Date(nextDeparture + 'T00:00:00').getTime() - today.getTime()) /
            (24 * 60 * 60 * 1000),
        );
        return [{ ...pkg, nextDeparture, daysUntilDeparture }];
      });

    if (!upcoming.length) {
      return NextResponse.json({
        checked: packages.length,
        upcomingCount: 0,
        alerts: 0,
      });
    }

    // 3. 패키지별 확정 예약 headcount 합산
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

    // 4. 소진율 threshold 미만 패키지 필터 (출발일 임박 순 정렬)
    const alertItems: AlertItem[] = upcoming
      .map((pkg) => {
        const filled = filledMap[pkg.id] ?? 0;
        const fillRate = filled / pkg.hard_block_quota;
        return {
          id: pkg.id,
          title: pkg.title,
          destination: pkg.destination,
          quota: pkg.hard_block_quota,
          filled,
          fillRate,
          nextDeparture: pkg.nextDeparture,
          daysUntilDeparture: pkg.daysUntilDeparture,
        };
      })
      .filter((item) => item.fillRate < FILL_RATE_THRESHOLD)
      .sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture);

    // 5. Slack 경고 발송
    if (alertItems.length > 0) {
      const lines = alertItems.map(
        (item) =>
          `• *${item.title}* (${item.destination}) D-${item.daysUntilDeparture}` +
          ` — ${item.filled}/${item.quota}석 소진 (${Math.round(item.fillRate * 100)}%)` +
          ` 출발 ${item.nextDeparture}`,
      );

      await sendSlackAlert(
        `🚨 [하드블럭 경고] D-${LEAD_DAYS} 이내 소진율 50% 미만 ${alertItems.length}건`,
        {
          items: lines,
          action: '👉 타임세일 카드뉴스 발행 → /admin/packages',
          checkedAt: new Date().toISOString(),
        },
      );
    }

    return NextResponse.json({
      checked: packages.length,
      upcomingCount: upcoming.length,
      alerts: alertItems.length,
      alertItems,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendSlackAlert(`[hard-block-alert] 크론 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
