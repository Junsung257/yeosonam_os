import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

function maskName(name: string, code: string): string {
  if (!name) return `ref_${code.slice(-4).toUpperCase()}`;
  const first = name.charAt(0);
  return `${first}${'*'.repeat(Math.max(1, name.length - 1))}`;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ data: [] });

  try {
    const { searchParams } = request.nextUrl;
    const period = searchParams.get('period') || new Date().toISOString().slice(0, 7);
    const anonymized = searchParams.get('anonymized') === 'true';
    const requestedLimit = Number(searchParams.get('limit') || '10');
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(50, Math.max(1, requestedLimit))
      : 10;

    const { data: settlements, error } = await supabaseAdmin
      .from('settlements')
      .select('affiliate_id, final_payout, qualified_booking_count, total_amount, status')
      .eq('settlement_period', period)
      .in('status', ['READY', 'COMPLETED'])
      .order('final_payout', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const affiliateIds = (settlements || []).map((s: any) => s.affiliate_id);
    const { data: affiliates, error: affiliatesError } = affiliateIds.length
      ? await supabaseAdmin
          .from('affiliates')
          .select('id, name, referral_code, grade, logo_url')
          .in('id', affiliateIds)
      : { data: [], error: null };
    if (affiliatesError) throw affiliatesError;

    const affMap = new Map<string, any>();
    (affiliates || []).forEach((a: any) => affMap.set(a.id, a));

    const rows = (settlements || []).map((s: any, idx: number) => {
      const aff = affMap.get(s.affiliate_id);
      const displayName = anonymized
        ? maskName(aff?.name || '', aff?.referral_code || '')
        : aff?.name || '-';
      return {
        rank: idx + 1,
        affiliate_id: anonymized ? null : s.affiliate_id,
        name: displayName,
        grade: aff?.grade || null,
        logo_url: anonymized ? null : aff?.logo_url || null,
        booking_count: s.qualified_booking_count,
        total_amount: s.total_amount,
        final_payout: s.final_payout,
      };
    });

    return apiResponse({ period, anonymized, data: rows });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, '조회 실패') },
      { status: 500 },
    );
  }
}
