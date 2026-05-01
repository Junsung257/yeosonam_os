import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { recomputeGroupScores, recomputeGroupForPackage } from '@/lib/scoring/recommend';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 그룹 단위 즉시 재계산 — 패키지 등록 직후 호출용 (1~2초).
 *
 * Body 형식 1: { package_id: "uuid" } — 패키지 ID로 자동 그룹 추론
 * Body 형식 2: { destination: "다낭", departure_date: "2026-04-20" }
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  let body: { package_id?: string; destination?: string; departure_date?: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    let result;
    if (body.package_id) {
      result = await recomputeGroupForPackage(body.package_id);
    } else if (body.destination) {
      result = await recomputeGroupScores(body.destination, body.departure_date ?? null);
    } else {
      return NextResponse.json({ error: 'package_id 또는 destination 필수' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
