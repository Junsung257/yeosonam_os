/**
 * GET /api/admin/ai-credits
 *
 * DeepSeek · Gemini · Claude 3개 프로바이더의 잔여 크레딧 · 사용량 통합 조회.
 *
 * - DeepSeek: Balance API (https://api.deepseek.com/user/balance) → CNY/USD 잔액
 * - Gemini: Google AI API는 잔여 크레딧 조회 미지원 → ledger 기반 사용량만 표시
 * - Claude/Anthropic: Anthropic API는 key-level 크레딧 조회 미지원 → ledger 기반 사용량만 표시
 *
 * 각 프로바이더별 이번달 사용량은 jarvis_cost_ledger에서 model 이름으로 구분.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const CNY_TO_USD = 0.138; // 고정환율 — 표시용 근사값

interface ProviderCredit {
  /** 잔여 크레딧 조회 가능 여부 */
  balance_available: boolean;
  /** 잔여 크레딧 (해당 통화) */
  balance_raw?: number;
  balance_currency?: string;
  /** USD 환산 잔여 크레딧 */
  balance_usd?: number;
  /** 이번달 누적 비용 (USD, ledger 기반) */
  month_cost_usd: number;
  /** 이번달 호출 횟수 */
  month_calls: number;
  /** API 키 설정 여부 */
  key_configured: boolean;
  /** 잔여 크레딧 미지원 시 안내 메시지 */
  note?: string;
  error?: string;
}

type ProviderId = 'deepseek' | 'gemini' | 'anthropic';

async function getMonthUsageFromLedger(
  modelPrefix: string,
): Promise<{ cost_usd: number; calls: number }> {
  if (!isSupabaseConfigured) return { cost_usd: 0, calls: 0 };
  try {
    const since = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString();
    const { data, error } = await supabaseAdmin
      .from('jarvis_cost_ledger')
      .select('cost_usd')
      .gte('created_at', since)
      .like('model', `${modelPrefix}%`);
    if (error) return { cost_usd: 0, calls: 0 };
    const rows = (data ?? []) as { cost_usd: number }[];
    return {
      cost_usd: rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
      calls: rows.length,
    };
  } catch {
    return { cost_usd: 0, calls: 0 };
  }
}

async function fetchDeepSeekBalance(): Promise<{
  balance_cny: number;
  balance_usd: number;
  available: boolean;
} | null> {
  const key = process.env.DEEPSEEK_API_KEY;
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

export async function GET() {
  // 병렬 조회
  const [deepseekBalance, dsUsage, geminiUsage, claudeUsage] = await Promise.all([
    fetchDeepSeekBalance(),
    getMonthUsageFromLedger('deepseek'),
    getMonthUsageFromLedger('gemini'),
    getMonthUsageFromLedger('claude'),
  ]);

  const credits: Record<ProviderId, ProviderCredit> = {
    deepseek: {
      key_configured: !!process.env.DEEPSEEK_API_KEY,
      balance_available: deepseekBalance !== null,
      balance_raw: deepseekBalance?.balance_cny,
      balance_currency: 'CNY',
      balance_usd: deepseekBalance?.balance_usd,
      month_cost_usd: Math.round(dsUsage.cost_usd * 1000000) / 1000000,
      month_calls: dsUsage.calls,
      ...(!deepseekBalance && { note: 'Balance API 조회 실패 또는 키 미설정' }),
    },
    gemini: {
      key_configured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
      balance_available: false,
      month_cost_usd: Math.round(geminiUsage.cost_usd * 1000000) / 1000000,
      month_calls: geminiUsage.calls,
      note: 'Google AI API는 잔여 크레딧 조회 미지원 — GCP 콘솔(console.cloud.google.com/billing)에서 확인',
    },
    anthropic: {
      key_configured: !!process.env.ANTHROPIC_API_KEY,
      balance_available: false,
      month_cost_usd: Math.round(claudeUsage.cost_usd * 1000000) / 1000000,
      month_calls: claudeUsage.calls,
      note: claudeUsage.calls === 0
        ? 'LLM Gateway V3에서 DeepSeek으로 전환됨 — 직접 호출 없음'
        : 'Anthropic API는 key-level 크레딧 조회 미지원 — console.anthropic.com에서 확인',
    },
  };

  return NextResponse.json({ credits, updated_at: new Date().toISOString() });
}
