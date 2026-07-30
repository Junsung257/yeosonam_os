import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

const CNY_TO_USD = 0.138;
const AI_USAGE_RPC_TIMEOUT_MS = 2500;

function withTimeout<T>(query: T): T {
  const candidate = query as T & { abortSignal?: (signal: AbortSignal) => T };
  return typeof candidate.abortSignal === 'function' && typeof AbortSignal?.timeout === 'function'
    ? candidate.abortSignal(AbortSignal.timeout(AI_USAGE_RPC_TIMEOUT_MS))
    : query;
}

interface ProviderCredit {
  balance_available: boolean;
  balance_raw?: number;
  balance_currency?: string;
  balance_usd?: number;
  month_cost_usd: number;
  month_calls: number;
  key_configured: boolean;
  note?: string;
  error?: string;
}

function unavailableCredits(detail: string) {
  const provider = (note: string): ProviderCredit => ({
    balance_available: false,
    month_cost_usd: 0,
    month_calls: 0,
    key_configured: false,
    note,
  });
  return {
    credits: {
      deepseek: provider(detail),
      gemini: provider(detail),
      anthropic: provider(detail),
    },
    data_status: 'unavailable' as const,
    status_detail: detail,
    updated_at: new Date().toISOString(),
  };
}

type ProviderId = 'deepseek' | 'gemini' | 'anthropic';

async function getMonthUsageByProvider(): Promise<Record<ProviderId, { cost_usd: number; calls: number }>> {
  const empty = {
    deepseek: { cost_usd: 0, calls: 0 },
    gemini: { cost_usd: 0, calls: 0 },
    anthropic: { cost_usd: 0, calls: 0 },
  };
  const { data, error } = await withTimeout(
    supabaseAdmin.rpc('get_admin_ai_month_usage_by_provider'),
  );
  if (error) throw error;

  const out = { ...empty };
  for (const row of (data ?? []) as Array<{ provider: string; cost_usd: number | null; calls: number | null }>) {
    if (row.provider !== 'deepseek' && row.provider !== 'gemini' && row.provider !== 'anthropic') continue;
    out[row.provider] = {
      cost_usd: Number(row.cost_usd) || 0,
      calls: Number(row.calls) || 0,
    };
  }
  return out;
}

async function fetchDeepSeekBalance(): Promise<{
  balance_cny: number;
  balance_usd: number;
  available: boolean;
} | null> {
  const key = getSecret('DEEPSEEK_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const info = json?.balance_infos?.[0];
    if (!info) return null;
    const cny = parseFloat(info.total_balance ?? '0');
    return {
      balance_cny: cny,
      balance_usd: Math.round(cny * CNY_TO_USD * 100) / 100,
      available: json.is_available ?? true,
    };
  } catch {
    return null;
  }
}

const getHandler = async (request: Request) => {
  if (!isSupabaseAdminConfigured) {
    return apiResponse(
      { error: 'Supabase admin connection is not configured.' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const includeLiveBalance = searchParams.get('live_balance') !== '0';

  let deepseekBalance: Awaited<ReturnType<typeof fetchDeepSeekBalance>>;
  let usageByProvider: Awaited<ReturnType<typeof getMonthUsageByProvider>>;
  try {
    [deepseekBalance, usageByProvider] = await Promise.all([
      includeLiveBalance ? fetchDeepSeekBalance() : Promise.resolve(null),
      getMonthUsageByProvider(),
    ]);
  } catch (error) {
    return apiResponse(
      unavailableCredits(`AI 사용량 원천을 조회할 수 없습니다: ${sanitizeDbError(error)}`),
      { status: 206 },
    );
  }
  const dsUsage = usageByProvider.deepseek;
  const geminiUsage = usageByProvider.gemini;
  const claudeUsage = usageByProvider.anthropic;

  const credits: Record<ProviderId, ProviderCredit> = {
    deepseek: {
      key_configured: !!getSecret('DEEPSEEK_API_KEY'),
      balance_available: deepseekBalance !== null,
      balance_raw: deepseekBalance?.balance_cny,
      balance_currency: 'CNY',
      balance_usd: deepseekBalance?.balance_usd,
      month_cost_usd: Math.round(dsUsage.cost_usd * 1000000) / 1000000,
      month_calls: dsUsage.calls,
      ...(!deepseekBalance && { note: 'Balance API unavailable or key not configured' }),
    },
    gemini: {
      key_configured: !!(getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_AI_API_KEY')),
      balance_available: false,
      month_cost_usd: Math.round(geminiUsage.cost_usd * 1000000) / 1000000,
      month_calls: geminiUsage.calls,
      note: 'Google AI API balance lookup is unavailable; check GCP billing console.',
    },
    anthropic: {
      key_configured: !!getSecret('ANTHROPIC_API_KEY'),
      balance_available: false,
      month_cost_usd: Math.round(claudeUsage.cost_usd * 1000000) / 1000000,
      month_calls: claudeUsage.calls,
      note: claudeUsage.calls === 0
        ? 'No direct Anthropic calls recorded this month.'
        : 'Anthropic key-level balance lookup is unavailable; check console.anthropic.com.',
    },
  };

  return apiResponse({ credits, data_status: 'ok' as const, updated_at: new Date().toISOString() });
};

export const GET = withAdminGuard(getHandler);
