/**
 * X4-3 박제 (2026-05-15): 어드민 attraction 정확/부정확 1-click 피드백 API.
 *
 * 사장님 도메인 전문성으로 자동 시드 결과 검증.
 *   - accurate: confidence_score +0.1 (cap 1.0)
 *   - inaccurate: confidence_score -0.2 + is_active=false (자동 비활성)
 *
 * Reflexion 인프라 일부 — 시드 패턴 학습 (다음 PR 에서 강화).
 */

import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { revalidatePath } from 'next/cache';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const POST = withAdminGuard(async (req: NextRequest, ctx?: { params?: Promise<{ id: string }> }) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'no_db' }, { status: 503 });
  const params = await ctx?.params;
  const id = params?.id;
  if (!id) return apiResponse({ error: 'missing_id' }, { status: 400 });

  let body: { verdict?: string; note?: string };
  try { body = await req.json(); }
  catch { return apiResponse({ error: 'invalid_json' }, { status: 400 }); }

  if (body.verdict !== 'accurate' && body.verdict !== 'inaccurate') {
    return apiResponse({ error: 'verdict must be accurate|inaccurate' }, { status: 400 });
  }

  // 1) 현재 attraction 조회
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('attractions')
    .select('id, name, confidence_score')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !existing) return apiResponse({ error: 'not_found' }, { status: 404 });

  // 2) feedback row INSERT (audit trail)
  await supabaseAdmin.from('attraction_feedback').insert({
    attraction_id: id,
    verdict: body.verdict,
    note: body.note ?? null,
  });

  // 3) confidence_score + is_active 갱신
  const prevConf = ((existing as { confidence_score?: number }).confidence_score ?? 0.5);
  let nextConf = prevConf;
  let nextActive: boolean | undefined;

  if (body.verdict === 'accurate') {
    nextConf = Math.min(1.0, prevConf + 0.1);
  } else {
    nextConf = Math.max(0, prevConf - 0.2);
    if (nextConf < 0.3) nextActive = false; // 신뢰도 0.3 미만 자동 비활성
  }

  const updatePayload: Record<string, unknown> = { confidence_score: nextConf };
  if (nextActive !== undefined) updatePayload.is_active = nextActive;

  const { error: upErr } = await supabaseAdmin
    .from('attractions')
    .update(updatePayload)
    .eq('id', id);
  if (upErr) return apiResponse({ error: sanitizeDbError(upErr) }, { status: 500 });

  revalidatePath('/packages', 'layout');
  return apiResponse({
    ok: true,
    verdict: body.verdict,
    confidence_score: nextConf,
    is_active: nextActive ?? true,
    message: body.verdict === 'accurate'
      ? `정확 표시 — confidence ${(prevConf * 100).toFixed(0)}% → ${(nextConf * 100).toFixed(0)}%`
      : nextActive === false
        ? `부정확 표시 — confidence ${(prevConf * 100).toFixed(0)}% → ${(nextConf * 100).toFixed(0)}% (30% 미만으로 자동 비활성)`
        : `부정확 표시 — confidence ${(prevConf * 100).toFixed(0)}% → ${(nextConf * 100).toFixed(0)}%`,
  });
});
