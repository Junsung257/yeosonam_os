/**
 * GET /api/cron/mrt-hotel-ranking
 *
 * 주 1회 실행 — 인기 도시 × 2 티어(luxury/mid) 호텔 랭킹 블로그 자동 생성.
 * POST /api/blog/mrt-hotel-ranking 를 도시별 순차 호출.
 * Vercel cron: 매주 월요일 11:00 KST (02:00 UTC)
 */

import { NextResponse } from 'next/server';

const TOP_CITIES = [
  '다낭', '나트랑', '방콕', '도쿄', '오사카',
  '싱가포르', '발리', '세부', '코타키나발루', '후쿠오카',
];
const TIERS = ['luxury', 'mid'] as const;

export const maxDuration = 300;

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(request.url).origin;
  const results: { city: string; tier: string; ok: boolean; slug?: string; error?: string }[] = [];

  for (const city of TOP_CITIES) {
    for (const tier of TIERS) {
      try {
        const res = await fetch(`${baseUrl}/api/blog/mrt-hotel-ranking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city, tier, count: 5, publish: true }),
        });
        const json = await res.json() as { ok?: boolean; slug?: string; error?: string };
        results.push({ city, tier, ok: !!json.ok, slug: json.slug, error: json.error });
      } catch (err) {
        results.push({ city, tier, ok: false, error: err instanceof Error ? err.message : '실패' });
      }
      // Rate limit 방어
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const ok  = results.filter(r => r.ok).length;
  const err = results.filter(r => !r.ok).length;

  return NextResponse.json({ ok, err, results });
}
