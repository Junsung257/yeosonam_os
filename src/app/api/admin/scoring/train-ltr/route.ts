/**
 * POST /api/admin/scoring/train-ltr
 *
 * LTR (Learning to Rank) 학습 트리거.
 *
 * Phase 3 (목표): v_ltr_signals → LightFM/XGBoost listwise rerank 학습 → scoring_policies row 추가
 *
 * 외부 서비스 연동 옵션:
 *   1) **Vercel Sandbox** (추천) — Firecracker microVM에서 Python LightFM 실행
 *   2) **Vercel Workflow** — 학습 작업 durable orchestration
 *   3) **AWS SageMaker** — 본격 ML 인프라
 *   4) **Modal/Replicate** — Python 함수 SaaS
 *
 * 현재 stub — env LTR_TRAINING_SERVICE_URL 있으면 외부 호출, 없으면 데이터만 export.
 */
import { NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { postAlert } from '@/lib/admin-alerts';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'supabase 미설정' }, { status: 503 });

  // 학습 데이터 양 체크
  const { count } = await supabaseAdmin
    .from('v_ltr_signals')
    .select('*', { count: 'exact', head: true })
    .gte('label_relevant', 0);

  const samples = count ?? 0;
  if (samples < 1000) {
    return NextResponse.json({
      error: 'LTR 학습 샘플 부족',
      have: samples,
      need: 1000,
      message: '자비스/카드/뱃지 노출이 더 누적되어야 학습 가능. 매주 v_recommendation_funnel 모니터링.',
    }, { status: 400 });
  }

  // 학습 데이터 export (LATERAL join으로 가벼운 셈플링)
  const { data: signals } = await supabaseAdmin
    .from('v_ltr_signals')
    .select('package_id, intent, recommended_rank, label_relevant, label_booking, list_price, effective_price, group_size, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, topsis_score')
    .order('recommended_at', { ascending: false })
    .limit(50000);

  // 외부 학습 서비스 연동 (env 있을 때만)
  const serviceUrl = process.env.LTR_TRAINING_SERVICE_URL;
  const ltrTrainingSecret = getSecret('LTR_TRAINING_SECRET');
  if (serviceUrl) {
    try {
      const res = await fetch(serviceUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(ltrTrainingSecret ? { authorization: `Bearer ${ltrTrainingSecret}` } : {}),
        },
        body: JSON.stringify({ signals: signals ?? [], target: 'lightfm' }),
      });
      if (!res.ok) throw new Error(`LTR service ${res.status}: ${await res.text()}`);
      const result = await res.json() as { weights?: Record<string, number>; auc?: number };
      // 학습된 가중치를 새 정책 row로 박제 (사장님이 활성 전환 결정)
      if (result.weights) {
        const newVersion = `ltr-v${Date.now()}`;
        const { data: created } = await supabaseAdmin.from('scoring_policies').insert({
          version: newVersion, is_active: false,
          weights: result.weights,
          // base 정책의 hotel_premium 등 복사
          hotel_premium: {}, flight_premium: { direct: 50000, transit: 0 },
          hedonic_coefs: {}, market_rates: {}, fallback_rules: {},
          notes: `LTR 학습 — samples ${samples}, AUC ${result.auc ?? 'N/A'}`,
        }).select('id, version').single();
        await postAlert({
          category: 'general', severity: 'warning',
          title: `LTR 학습 완료: ${newVersion}`,
          message: `${samples}건 학습. AUC ${result.auc ?? 'N/A'}. /admin/scoring 에서 검토 후 활성 전환.`,
          ref_type: 'policy', ref_id: created?.id ?? '',
          meta: { samples, auc: result.auc, weights: result.weights },
        });
        return NextResponse.json({ ok: true, samples, new_policy: created, auc: result.auc });
      }
      return NextResponse.json({ ok: true, samples, result });
    } catch (e) {
      console.error('[ltr-train]', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'failed', samples },
        { status: 500 },
      );
    }
  }

  // 외부 서비스 미설정 — export only
  return NextResponse.json({
    ok: true,
    stub: true,
    samples,
    message: 'LTR_TRAINING_SERVICE_URL 미설정 — 학습 데이터 export만 반환. Vercel Sandbox/Workflow에 LightFM 서비스 띄우고 env 설정 시 자동 학습.',
    signals_preview: (signals ?? []).slice(0, 5),
  });
}
