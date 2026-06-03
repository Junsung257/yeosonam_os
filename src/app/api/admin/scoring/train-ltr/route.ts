import { apiResponse } from '@/lib/api-response';
import { postAlert } from '@/lib/admin-alerts';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { logError } from '@/lib/sentry-logger';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

const postHandler = async () => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { count, error: countError } = await supabaseAdmin
    .from('v_ltr_signals')
    .select('*', { count: 'exact', head: true })
    .gte('label_relevant', 0);

  if (countError) return apiResponse({ error: sanitizeDbError(countError) }, { status: 500 });

  const samples = count ?? 0;
  if (samples < 1000) {
    return apiResponse({
      error: 'LTR_TRAINING_SAMPLES_INSUFFICIENT',
      have: samples,
      need: 1000,
      message: 'LTR training requires at least 1000 labeled samples.',
    }, { status: 400 });
  }

  const { data: signals, error: signalsError } = await supabaseAdmin
    .from('v_ltr_signals')
    .select('package_id, intent, recommended_rank, label_relevant, label_booking, list_price, effective_price, group_size, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, topsis_score')
    .order('recommended_at', { ascending: false })
    .limit(50000);

  if (signalsError) return apiResponse({ error: sanitizeDbError(signalsError) }, { status: 500 });

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

      if (!res.ok) throw new Error(`LTR_TRAINING_SERVICE_FAILED_${res.status}`);

      const result = await res.json() as { weights?: Record<string, number>; auc?: number };
      if (result.weights) {
        const newVersion = `ltr-v${Date.now()}`;
        const { data: created, error: createError } = await supabaseAdmin.from('scoring_policies').insert({
          version: newVersion,
          is_active: false,
          weights: result.weights,
          hotel_premium: {},
          flight_premium: { direct: 50000, transit: 0 },
          hedonic_coefs: {},
          market_rates: {},
          fallback_rules: {},
          notes: `LTR training samples ${samples}, AUC ${result.auc ?? 'N/A'}`,
        }).select('id, version').single();

        if (createError) return apiResponse({ error: sanitizeDbError(createError) }, { status: 500 });

        await postAlert({
          category: 'general',
          severity: 'warning',
          title: `LTR training complete: ${newVersion}`,
          message: `${samples} samples trained. AUC ${result.auc ?? 'N/A'}. Review and activate from /admin/scoring.`,
          ref_type: 'policy',
          ref_id: created?.id ?? '',
          meta: { samples, auc: result.auc, weights: result.weights },
        });

        return apiResponse({ ok: true, samples, new_policy: created, auc: result.auc });
      }

      return apiResponse({ ok: true, samples, result });
    } catch (e) {
      logError('[admin/scoring/train-ltr] training failed', e);
      return apiResponse({ error: sanitizeDbError(e), samples }, { status: 500 });
    }
  }

  return apiResponse({
    ok: true,
    stub: true,
    samples,
    message: 'LTR_TRAINING_SERVICE_URL is not configured; returning exported training data preview only.',
    signals_preview: (signals ?? []).slice(0, 5),
  });
};

export const POST = withAdminGuard(postHandler);
