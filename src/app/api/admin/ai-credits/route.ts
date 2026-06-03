import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { withAdminGuard } from '@/lib/admin-guard';

const CNY_TO_USD = 0.138;

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

type ProviderId = 'deepseek' | 'gemini' | 'anthropic';

async function getMonthUsageByProvider(): Promise<Record<ProviderId, { cost_usd: number; calls: number }>> {
  const empty = {
    deepseek: { cost_usd: 0, calls: 0 },
    gemini: { cost_usd: 0, calls: 0 },
    anthropic: { cost_usd: 0, calls: 0 },
  };
  if (!isSupabaseConfigured) return empty;
  try {
    const since = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString();
    const { data, error } = await supabaseAdmin
      .from('jarvis_cost_ledger')
      .select('model, cost_usd')
      .gte('created_at', since)
      .or('model.like.deepseek%,model.like.gemini%,model.like.claude%');
    if (error) return empty;

    const out = { ...empty };
    for (const row of (data ?? []) as Array<{ model: string | null; cost_usd: number | null }>) {
      const model = row.model ?? '';
      const provider: ProviderId | null =
        model.startsWith('deepseek') ? 'deepseek'
          : model.startsWith('gemini') ? 'gemini'
            : model.startsWith('claude') ? 'anthropic'
              : null;
      if (!provider) continue;
      out[provider].calls += 1;
      out[provider].cost_usd += Number(row.cost_usd) || 0;
    }
    return out;
  } catch {
    return empty;
  }
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
  const { searchParams } = new URL(request.url);
  const includeLiveBalance = searchParams.get('live_balance') !== '0';

  const [deepseekBalance, usageByProvider] = await Promise.all([
    includeLiveBalance ? fetchDeepSeekBalance() : Promise.resolve(null),
    getMonthUsageByProvider(),
  ]);
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

  return apiResponse({ credits, updated_at: new Date().toISOString() });
};

export const GET = withAdminGuard(getHandler);
