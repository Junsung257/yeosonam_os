/**
 * POST /api/orchestrator/auto-publish-top — 점수 1위 패키지 자동 batch 발행 (v3.9)
 *
 * 전제: 점수 시스템 v3 + getTopRecommendedPackages
 * 목적: 매일/매주 상위 패키지를 자동으로 골라 콘텐츠 자동 발행 → 광고 ROAS ↑
 *
 * Body: {
 *   limit?: number (기본 5),
 *   destination?: string,
 *   departureFrom?, departureTo?: string,
 *   maxRank?: number (기본 1),
 *   platforms?: Platform[] (auto-publish forwards),
 *   dryRun?: boolean
 * }
 *
 * 동작:
 *   1. getTopRecommendedPackages() — 조건에 맞는 1위 패키지 N개
 *   2. 각 package_id 마다 /api/orchestrator/auto-publish 호출
 *   3. 결과 모두 합쳐 응답
 *
 * 사장님 활용:
 *   - "다음주 다낭 광고 자동 발행" — destination='다낭' + departureFrom 설정
 *   - "이번 달 모든 destination 1위 자동 발행" — limit=10
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getTopRecommendedPackages } from '@/lib/scoring/top-recommended';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface Body {
  limit?: number;
  destination?: string;
  departureFrom?: string;
  departureTo?: string;
  maxRank?: number;
  platforms?: string[];
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'supabase 미설정' }, { status: 503 });
  try {
    const body = await req.json() as Body;
    const tops = await getTopRecommendedPackages({
      limit: body.limit ?? 5,
      destination: body.destination,
      departureFrom: body.departureFrom,
      departureTo: body.departureTo,
      maxRank: body.maxRank ?? 1,
      dedupePackage: true,
    });

    if (tops.length === 0) {
      return NextResponse.json({ ok: true, picked: 0, message: '조건에 맞는 1위 패키지 없음' });
    }

    if (body.dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true, picked: tops.length,
        packages: tops.map(t => ({ package_id: t.package_id, destination: t.destination, departure_date: t.departure_date })),
      });
    }

    // 각 패키지마다 auto-publish 호출 (병렬, 실패 격리)
    const baseUrl = req.nextUrl.origin;
    const results = await Promise.allSettled(tops.map(async (top) => {
      const res = await fetch(`${baseUrl}/api/orchestrator/auto-publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(req.headers.get('cookie') ? { cookie: req.headers.get('cookie')! } : {}),
        },
        body: JSON.stringify({
          product_id: top.package_id,
          platforms: body.platforms,
          publishNow: false,
          triggerCardNewsVariants: false,
        }),
      });
      if (!res.ok) throw new Error(`auto-publish ${res.status}`);
      return { package_id: top.package_id, destination: top.destination, status: res.status };
    }));

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return NextResponse.json({
      ok: true,
      picked: tops.length,
      succeeded,
      failed,
      details: results.map((r, i) => r.status === 'fulfilled'
        ? { ...r.value, ok: true }
        : { package_id: tops[i].package_id, ok: false, error: String((r as PromiseRejectedResult).reason) }
      ),
    });
  } catch (e) {
    console.error('[auto-publish-top]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
