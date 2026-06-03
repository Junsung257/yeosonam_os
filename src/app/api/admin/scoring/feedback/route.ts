import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEEDBACK_OUTCOME: Record<string, string | null> = {
  good_fit: null,
  bad_fit: 'cancelled',
  customer_selected: 'inquiry',
  customer_rejected: 'cancelled',
  needs_hotel_check: null,
};

const FEEDBACK_LABEL: Record<string, string> = {
  good_fit: '상담 적합',
  bad_fit: '추천 부적합',
  customer_selected: '고객 선택',
  customer_rejected: '고객 거절',
  needs_hotel_check: '호텔 재확인',
};

type OutcomeRow = {
  id: number;
  package_id: string;
  source: string;
  intent: string | null;
  recommended_rank: number | null;
  outcome: string | null;
  outcome_at: string | null;
  outcome_value: number | null;
  notes: string | null;
  recommended_at: string;
  session_id: string | null;
};

function appendFeedbackNote(existing: string | null, feedback: string, memo: string | null) {
  const label = FEEDBACK_LABEL[feedback] ?? feedback;
  const line = `[recommendation-feedback] ${label}${memo ? `: ${memo.slice(0, 300)}` : ''}`;
  return [existing, line].filter(Boolean).join('\n').slice(0, 2000);
}

const getHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ configured: false, rows: [], summary: null });

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 40), 1), 100);
  const { data, error } = await supabaseAdmin
    .from('recommendation_outcomes')
    .select('id,package_id,source,intent,recommended_rank,outcome,outcome_at,outcome_value,notes,recommended_at,session_id')
    .order('recommended_at', { ascending: false })
    .limit(limit);

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  const rows = (data ?? []) as OutcomeRow[];
  const packageIds = Array.from(new Set(rows.map((row) => row.package_id).filter(Boolean)));
  const packageMap = new Map<string, { title: string | null; destination: string | null }>();

  if (packageIds.length > 0) {
    const { data: packages } = await supabaseAdmin
      .from('travel_packages')
      .select('id,title,destination')
      .in('id', packageIds);
    for (const pkg of packages ?? []) {
      const row = pkg as { id: string; title: string | null; destination: string | null };
      packageMap.set(row.id, { title: row.title, destination: row.destination });
    }
  }

  const withPackage = rows.map((row) => ({
    ...row,
    package_title: packageMap.get(row.package_id)?.title ?? null,
    destination: packageMap.get(row.package_id)?.destination ?? null,
    has_feedback: Boolean(row.notes?.includes('[recommendation-feedback]')),
  }));

  return apiResponse({
    configured: true,
    rows: withPackage,
    summary: {
      total: withPackage.length,
      feedbackRows: withPackage.filter((row) => row.has_feedback).length,
      selectedRows: withPackage.filter((row) => row.notes?.includes('고객 선택')).length,
      rejectedRows: withPackage.filter((row) => row.notes?.includes('고객 거절') || row.notes?.includes('추천 부적합')).length,
      hotelCheckRows: withPackage.filter((row) => row.notes?.includes('호텔 재확인')).length,
    },
  });
};

const postHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ configured: false });

  let body: { id?: number; feedback?: string; memo?: string | null };
  try {
    body = await req.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body.id || !body.feedback || !(body.feedback in FEEDBACK_OUTCOME)) {
    return apiResponse({ error: 'INVALID_FEEDBACK_REQUEST' }, { status: 400 });
  }

  const { data: current, error: readError } = await supabaseAdmin
    .from('recommendation_outcomes')
    .select('id,notes,outcome')
    .eq('id', body.id)
    .single();
  if (readError) return apiResponse({ error: sanitizeDbError(readError) }, { status: 500 });

  const outcome = FEEDBACK_OUTCOME[body.feedback];
  const update: Record<string, unknown> = {
    notes: appendFeedbackNote((current as { notes: string | null }).notes, body.feedback, body.memo ?? null),
  };
  if (outcome) {
    update.outcome = outcome;
    update.outcome_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('recommendation_outcomes')
    .update(update)
    .eq('id', body.id)
    .select('id,package_id,source,intent,recommended_rank,outcome,outcome_at,notes,recommended_at')
    .single();

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ ok: true, row: data });
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
