import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { matchPackagesToLandOperators } from '@/lib/scoring/match-land-operators';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  try {
    const result = await matchPackagesToLandOperators();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
