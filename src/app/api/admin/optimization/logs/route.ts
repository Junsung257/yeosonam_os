import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isAdminRequest } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';

export const dynamic = 'force-dynamic';

type OptimizationLogRow = {
  id: string;
  action: string;
  platform: string;
  keyword_text: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  triggered_by: string | null;
  executed_at: string | null;
  success: boolean | null;
  error_message: string | null;
};

type OptimizationLogSummary = {
  id: string;
  ran_at: string;
  platform: string;
  status: 'success' | 'partial' | 'error';
  keywords_analyzed: number;
  bids_adjusted: number;
  negative_keywords_added: number;
  suggestions_added: number;
  total_spend_before: number;
  total_spend_after: number;
  errors: string[] | null;
  duration_ms: number;
  created_at: string;
};

type LegacyOptimizationLogRow = Partial<OptimizationLogSummary> & {
  created_at?: string | null;
  error?: string | null;
};

function parseAmount(value: string | null): number {
  if (!value) return 0;
  const normalized = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(normalized) ? normalized : 0;
}

function summarizeLog(row: OptimizationLogRow): OptimizationLogSummary {
  const ranAt = row.executed_at ?? new Date(0).toISOString();
  const isBidAction = row.action === 'bid_increase' || row.action === 'bid_decrease';
  const isNegativeAction = row.action === 'add_negative';
  const isSuggestionAction = row.action === 'add_keyword';
  const errors = row.error_message ? [row.error_message] : null;

  return {
    id: row.id,
    ran_at: ranAt,
    platform: row.platform,
    status: row.success === false ? 'error' : errors ? 'partial' : 'success',
    keywords_analyzed: row.keyword_text ? 1 : 0,
    bids_adjusted: isBidAction ? 1 : 0,
    negative_keywords_added: isNegativeAction ? 1 : 0,
    suggestions_added: isSuggestionAction ? 1 : 0,
    total_spend_before: parseAmount(row.old_value),
    total_spend_after: parseAmount(row.new_value),
    errors,
    duration_ms: 0,
    created_at: ranAt,
  };
}

function toNumber(value: unknown): number {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeStatus(value: unknown): OptimizationLogSummary['status'] {
  return value === 'partial' || value === 'error' || value === 'success' ? value : 'success';
}

function summarizeLegacyLog(row: LegacyOptimizationLogRow, index: number): OptimizationLogSummary {
  const ranAt = row.ran_at ?? row.created_at ?? new Date(0).toISOString();
  const errorList = Array.isArray(row.errors)
    ? row.errors.filter((error): error is string => typeof error === 'string' && error.length > 0)
    : typeof row.error === 'string' && row.error.length > 0
      ? [row.error]
      : null;

  return {
    id: typeof row.id === 'string' ? row.id : `legacy-${index}`,
    ran_at: ranAt,
    platform: typeof row.platform === 'string' ? row.platform : 'unknown',
    status: normalizeStatus(row.status),
    keywords_analyzed: toNumber(row.keywords_analyzed),
    bids_adjusted: toNumber(row.bids_adjusted),
    negative_keywords_added: toNumber(row.negative_keywords_added),
    suggestions_added: toNumber(row.suggestions_added),
    total_spend_before: toNumber(row.total_spend_before),
    total_spend_after: toNumber(row.total_spend_after),
    errors: errorList && errorList.length > 0 ? errorList : null,
    duration_ms: toNumber(row.duration_ms),
    created_at: row.created_at ?? ranAt,
  };
}

function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST205' || /Could not find the table|relation .* does not exist/i.test(error?.message ?? '');
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = getSecret('CRON_SECRET');
  const serviceKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  const isBearerAuthorized =
    authHeader.startsWith('Bearer ') &&
    (safeEqualString(authHeader.slice(7), cronSecret) || safeEqualString(authHeader.slice(7), serviceKey));

  if (!isBearerAuthorized && !(await isAdminRequest(request))) {
    return apiResponse({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');
  const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 200);

  try {
    const url = getSecret('NEXT_PUBLIC_SUPABASE_URL');
    const key = getSecret('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
    }

    const supabase = createClient(url, key);
    let query = supabase
      .from('optimization_log')
      .select('id, action, platform, keyword_text, old_value, new_value, reason, triggered_by, executed_at, success, error_message')
      .order('executed_at', { ascending: false })
      .limit(limit);

    if (platform && platform !== 'all') {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;
    if (isMissingRelationError(error)) {
      const legacyQuery = supabase
        .from('optimization_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      const legacyResult = platform && platform !== 'all'
        ? await legacyQuery.eq('platform', platform)
        : await legacyQuery;

      if (isMissingRelationError(legacyResult.error)) {
        return apiResponse([]);
      }
      if (legacyResult.error) {
        return apiResponse({ error: sanitizeDbError(legacyResult.error) }, { status: 500 });
      }

      const legacyRows = (legacyResult.data ?? []) as unknown as LegacyOptimizationLogRow[];
      return apiResponse(legacyRows.map(summarizeLegacyLog));
    }
    if (error) {
      return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as OptimizationLogRow[];
    return apiResponse(rows.map(summarizeLog));
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
}
