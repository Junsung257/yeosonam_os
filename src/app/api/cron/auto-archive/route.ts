import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 자동 아카이브 크론 — 매일 새벽 1시 실행
 *
 * 조건 (OR):
 * 1. 발권기한(ticketing_deadline)이 지난 상품
 * 2. 등록 후 30일 이상 경과한 상품 (created_at + 30d < today) — 사장님 정책 2026-04-27
 * 3. 마지막 출발일(price_dates / price_tiers)이 모두 지난 상품
 *
 * 대상: status가 approved, active, pending, pending_review, draft 인 상품만
 */
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let archivedCount = 0;

  try {
    // 판매 중/승인/검토 대기 상품만 조회
    const { data: packages, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id, ticketing_deadline, price_tiers, price_dates, created_at')
      .in('status', ['approved', 'active', 'pending', 'pending_review', 'draft']);

    if (error) throw error;
    if (!packages || packages.length === 0) {
      return NextResponse.json({ archivedCount: 0, message: '대상 상품 없음' });
    }

    const toArchive: string[] = [];

    for (const pkg of packages) {
      let shouldArchive = false;

      // 조건 1: 발권기한 만료
      if (pkg.ticketing_deadline && pkg.ticketing_deadline < today) {
        shouldArchive = true;
      }

      // 조건 2: 등록 후 30일 이상 경과 (모든 상품 무조건 적용 — 사장님 정책 2026-04-27)
      if (!shouldArchive && pkg.created_at) {
        const created = new Date(pkg.created_at);
        const expiry = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (expiry.toISOString().split('T')[0] < today) {
          shouldArchive = true;
        }
      }

      // 조건 3: 모든 출발일이 지남 — price_dates 우선, price_tiers 폴백
      if (!shouldArchive) {
        const priceDates = (pkg.price_dates || []) as { date: string }[];

        if (priceDates.length > 0) {
          const latestDate = priceDates.map(pd => pd.date).sort().pop()!;
          if (latestDate < today) {
            shouldArchive = true;
          }
        } else if (pkg.price_tiers && Array.isArray(pkg.price_tiers)) {
          const allDates = (pkg.price_tiers as any[])
            .flatMap(t => t.departure_dates || [])
            .filter(Boolean);

          const allEndDates = (pkg.price_tiers as any[])
            .map(t => t.date_range?.end)
            .filter(Boolean);

          const allRelevantDates = [...allDates, ...allEndDates];

          if (allRelevantDates.length > 0) {
            const latestDate = allRelevantDates.sort().pop()!;
            if (latestDate < today) {
              shouldArchive = true;
            }
          }
        }
      }

      if (shouldArchive) {
        toArchive.push(pkg.id);
      }
    }

    if (toArchive.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .in('id', toArchive);

      if (updateError) throw updateError;
      archivedCount = toArchive.length;
    }

    console.log(`[auto-archive] ${archivedCount}개 상품 아카이브 완료`);
    return NextResponse.json({ archivedCount, message: `${archivedCount}개 상품 아카이브` });

  } catch (err) {
    console.error('[auto-archive] 오류:', err);
    return NextResponse.json({ error: '자동 아카이브 실패' }, { status: 500 });
  }
}
