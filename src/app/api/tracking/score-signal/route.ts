import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set([
  'view',
  'click',
  'booking',
  'recommend_badge_view',
  'recommend_reason_open',
  'comparison_open',
  'intent_chip_select',
  'lead_sheet_open',
]);

interface ScoreSignalBody {
  package_id?: string;
  signal_type?: string;
  group_key?: string;
  rank?: number;
  score?: number;
  session_id?: string;
}

/**
 * Collects package scoring signals for LTR learning.
 * Insert failures remain silent 200s to protect client UX.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ ok: false }, { status: 200 });

  let body: ScoreSignalBody;
  try {
    body = await req.json() as ScoreSignalBody;
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.package_id || !body.signal_type) {
    return apiResponse({ error: 'package_id and signal_type are required' }, { status: 400 });
  }
  if (!VALID_TYPES.has(body.signal_type)) {
    return apiResponse({ error: 'unsupported signal_type' }, { status: 400 });
  }

  const sessionId = body.session_id ?? req.cookies.get('ys_session_id')?.value ?? null;

  const { error } = await supabaseAdmin
    .from('package_score_signals')
    .insert({
      package_id: body.package_id,
      signal_type: body.signal_type,
      group_key: body.group_key ?? null,
      rank_at_signal: body.rank ?? null,
      topsis_score_at_signal: body.score ?? null,
      session_id: sessionId,
    });

  if (error) {
    console.error('[tracking/score-signal] insert failed:', sanitizeDbError(error));
    return apiResponse({ ok: false }, { status: 200 });
  }

  return apiResponse({ ok: true });
}
