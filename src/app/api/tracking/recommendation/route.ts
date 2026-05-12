/**
 * POST /api/tracking/recommendation
 *
 * 자비스/카드/리스트 뱃지가 추천 노출/클릭 시 호출.
 * `recommendation_outcomes` 테이블에 누적 → LTR 학습 ground truth + 정책 A/B.
 *
 * 사용 예:
 *   - 자비스가 N개 추천 도구 호출 후: outcome=null, source=jarvis (노출)
 *   - 사용자가 카드 클릭 시: outcome=click
 *   - 예약 완성 시: outcome=booking, outcome_value=금액
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

interface Payload {
  package_id: string;
  source: 'jarvis' | 'mobile_card' | 'list_badge' | 'admin';
  recommended_rank?: number;
  policy_id?: string;
  intent?: string;                  // family/couple/filial/budget/no-option 등
  session_id?: string;
  user_id?: string | null;
  outcome?: 'click' | 'inquiry' | 'booking' | 'cancelled' | null;
  outcome_value?: number;
  notes?: string;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });
  try {
    const body = await req.json() as Payload;
    if (!body.package_id || !body.source) {
      return NextResponse.json({ error: 'package_id, source 필수' }, { status: 400 });
    }
    const row = {
      package_id: body.package_id,
      source: body.source,
      recommended_rank: body.recommended_rank ?? null,
      policy_id: body.policy_id ?? null,
      intent: body.intent ?? null,
      session_id: body.session_id ?? null,
      user_id: body.user_id ?? null,
      outcome: body.outcome ?? null,
      outcome_at: body.outcome ? new Date().toISOString() : null,
      outcome_value: body.outcome_value ?? null,
      notes: body.notes ?? null,
    };
    const { data, error } = await supabaseAdmin
      .from('recommendation_outcomes')
      .insert(row)
      .select('id')
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    console.error('[recommendation tracking]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}

/**
 * PATCH — 기존 노출 row의 outcome 업데이트 (예약 완료 시 등).
 * 같은 (package_id, session_id) 의 가장 최근 row를 찾아 outcome 박음.
 */
export async function PATCH(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });
  try {
    const body = await req.json() as Payload;
    if (!body.package_id || !body.outcome) {
      return NextResponse.json({ error: 'package_id, outcome 필수' }, { status: 400 });
    }
    let q = supabaseAdmin.from('recommendation_outcomes')
      .update({
        outcome: body.outcome,
        outcome_at: new Date().toISOString(),
        outcome_value: body.outcome_value ?? null,
      })
      .eq('package_id', body.package_id)
      .is('outcome', null);
    if (body.session_id) q = q.eq('session_id', body.session_id);
    if (body.user_id) q = q.eq('user_id', body.user_id);

    const { data, error } = await q.select('id');
    if (error) throw error;
    return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
  } catch (e) {
    console.error('[recommendation update]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
