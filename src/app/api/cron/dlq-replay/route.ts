/**
 * GET /api/cron/dlq-replay
 *
 * 🎯 목적: 파싱에 실패한 slack_raw_events 레코드를 자동 재파싱.
 *
 * 동작:
 *   - parse_status='failed' AND parse_attempts < MAX_PARSE_ATTEMPTS 인 원문 조회
 *   - 각 원문에 대해 parseRawEvent() 재호출
 *   - 성공 시 parse_status='parsed', 실패+attempts 초과 시 'dead' 로 격리
 *
 * 재시도 전략:
 *   - MAX_PARSE_ATTEMPTS (기본 5회) 지수 백오프 없이 매 1시간마다 재시도
 *   - 파서 버그가 수정되면 자동으로 복구됨
 *   - 'dead' 상태는 어드민이 수동으로 원문을 검토 (웹 UI에서)
 *
 * Vercel Cron: 매 1시간 (0 * * * *)
 *
 * 다음 주기 연쇄 보호:
 *   - 한 번에 최대 50건만 처리 → 크론 타임아웃 방지
 *   - 같은 rawEventId 는 parseRawEvent() 내에서 parse_attempts 증가로 자동 보호
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { parseRawEvent, MAX_PARSE_ATTEMPTS } from '@/lib/slack-ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const BATCH_SIZE = 50;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    picked: 0,
    recovered: 0,
    still_failed: 0,
    moved_to_dead: 0,
    errors: [] as string[],
  };

  try {
    // 실패 레코드 배치 조회 (attempts 낮은 순)
    const { data: failed, error } = await supabaseAdmin
      .from('slack_raw_events')
      .select('id, parse_attempts')
      .eq('parse_status', 'failed')
      .lt('parse_attempts', MAX_PARSE_ATTEMPTS)
      .order('parse_attempts', { ascending: true })
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;

    summary.picked = failed?.length ?? 0;

    for (const row of (failed || []) as Array<{ id: string; parse_attempts: number }>) {
      try {
        const result = await parseRawEvent(row.id, 'manual_replay');
        if (result.parseStatus === 'parsed') summary.recovered++;
        else if (result.parseStatus === 'dead') summary.moved_to_dead++;
        else summary.still_failed++;
      } catch (e: any) {
        summary.errors.push(`${row.id}: ${e?.message ?? String(e)}`);
      }
    }

    // 추가: attempts가 이미 MAX를 넘겼는데 failed로 남아있는 레코드 (마이그레이션 직후 등)
    // → dead로 격리 (0건이어도 문제 없음)
    const { data: stranded } = await supabaseAdmin
      .from('slack_raw_events')
      .select('id')
      .eq('parse_status', 'failed')
      .gte('parse_attempts', MAX_PARSE_ATTEMPTS)
      .limit(100);

    if (stranded && stranded.length > 0) {
      const ids = (stranded as Array<{ id: string }>).map(r => r.id);
      await supabaseAdmin
        .from('slack_raw_events')
        .update({ parse_status: 'dead' })
        .in('id', ids);
      summary.moved_to_dead += ids.length;
    }

    const elapsed = Date.now() - startedAt;
    console.log(
      `[dlq-replay] ${elapsed}ms — picked=${summary.picked} ` +
      `recovered=${summary.recovered} still_failed=${summary.still_failed} ` +
      `moved_to_dead=${summary.moved_to_dead}`,
    );

    return NextResponse.json({ ok: true, elapsed_ms: elapsed, ...summary });
  } catch (e: any) {
    console.error('[dlq-replay] 최상위 예외:', e?.message ?? String(e));
    return NextResponse.json({ error: e?.message ?? 'replay 실패' }, { status: 500 });
  }
}
