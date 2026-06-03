import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { invalidatePolicyCache } from '@/lib/scoring/policy';

export const dynamic = 'force-dynamic';

const ALLOWED_KEYS = new Set([
  'weights', 'hotel_premium', 'hotel_brand_max_bonus', 'flight_premium', 'market_rates',
  'fallback_rules', 'notes',
]);

const WEIGHT_KEYS = ['price', 'hotel', 'meal', 'free_options', 'shopping_avoidance', 'reliability'];

function normalizeWeights(input: unknown): Record<string, number> | null {
  if (!input || typeof input !== 'object') return null;
  const w = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  let sum = 0;
  for (const k of WEIGHT_KEYS) {
    const v = w[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    out[k] = v;
    sum += v;
  }
  if (sum === 0) return null;
  for (const k of WEIGHT_KEYS) out[k] = out[k] / sum;
  return out;
}

const getHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  const { data, error } = await supabaseAdmin
    .from('scoring_policies').select('*')
    .eq('is_active', true).limit(1);
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ policy: data?.[0] ?? null });
}

const putHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return apiResponse({ error: 'invalid json' }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (k === 'weights') {
      const norm = normalizeWeights(v);
      if (!norm) return apiResponse({ error: 'weights 형식 오류 (5개 키, 음수 불가)' }, { status: 400 });
      update.weights = norm;
    } else if (k === 'hotel_brand_max_bonus') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return apiResponse({ error: 'hotel_brand_max_bonus는 0 이상 정수' }, { status: 400 });
      update[k] = Math.round(n);
    } else {
      update[k] = v;
    }
  }
  if (Object.keys(update).length === 0) {
    return apiResponse({ error: '업데이트할 필드 없음' }, { status: 400 });
  }

  const { data: cur, error: curError } = await supabaseAdmin
    .from('scoring_policies').select('id').eq('is_active', true).limit(1);
  if (curError) return apiResponse({ error: sanitizeDbError(curError) }, { status: 500 });
  const id = cur?.[0]?.id;
  if (!id) return apiResponse({ error: '활성 정책 없음' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('scoring_policies').update(update).eq('id', id).select().limit(1);
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  invalidatePolicyCache();
  return apiResponse({ policy: data?.[0] });
}

export const GET = withAdminGuard(getHandler);

export const PUT = withAdminGuard(putHandler);
