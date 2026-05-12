/**
 * @file src/app/api/card-news/variants/[group_id]/decide-winner/route.ts
 *
 * 변형 그룹의 winner 즉시 결정 (수동 트리거).
 *
 * 발행 후 24h+ 경과한 카드들의 engagement 비교 → 최고 점수 winner 결정 → 나머지 archive (옵션).
 *
 * Body:
 *   {
 *     archiveLosers?: boolean = false,
 *     dryRun?: boolean = false
 *   }
 *
 * Response: WinnerDecisionReport
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectVariantWinner } from '@/lib/card-news-html/winner-detector';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: { group_id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const groupId = params.group_id;
  if (!groupId) {
    return NextResponse.json({ error: 'group_id 필요' }, { status: 400 });
  }

  let body: { archiveLosers?: boolean; dryRun?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // body 없어도 OK
  }

  try {
    const report = await detectVariantWinner({
      variantGroupId: groupId,
      archiveLosers: body.archiveLosers ?? false,
      dryRun: body.dryRun ?? false,
    });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'winner 결정 실패' },
      { status: 500 },
    );
  }
}
