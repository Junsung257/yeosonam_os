import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { isAdminRequest } from '@/lib/admin-guard';
import { errorResponse } from '@/lib/api-response';
import { authAffiliate } from '@/lib/affiliate/auth-service';
import { SettlementPdfDocument } from '@/lib/affiliate/settlement-pdf';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

interface FrozenSettlementLine {
  product_name: string;
  traveler_count: number;
  commission_base_krw: number | null;
  line_amount_krw: number;
  departure_date: string | null;
  return_date: string | null;
  line_snapshot: Record<string, unknown>;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseAdminConfigured) return errorResponse('SERVICE_UNAVAILABLE', 'DB 미설정', 503);
  const { id } = await context.params;
  if (!isValidUuid(id)) return errorResponse('INVALID_SETTLEMENT_ID', '잘못된 정산 ID입니다.', 400);

  const isAdmin = await isAdminRequest(request);
  let partnerAffiliateId: string | null = null;
  if (!isAdmin) {
    const auth = await authAffiliate(request);
    if (!auth.ok) return errorResponse(auth.code, auth.error, auth.status);
    partnerAffiliateId = String(auth.affiliate.id);
  }

  const { data: settlement, error } = await supabaseAdmin
    .from('settlement_runs')
    .select('id, affiliate_id, settlement_period, status, gross_commission_krw, adjustment_krw, withholding_krw, net_payout_krw, calculation_trace_id, created_at, affiliates(name, phone, referral_code, payout_type)')
    .eq('id', id)
    .maybeSingle();
  if (error) return errorResponse('SETTLEMENT_UNAVAILABLE', '정산을 불러올 수 없습니다.', 503);
  if (!settlement) return errorResponse('NOT_FOUND', '정산을 찾을 수 없습니다.', 404);
  if (!isAdmin && settlement.affiliate_id !== partnerAffiliateId) {
    return errorResponse('FORBIDDEN', '권한 없음', 403);
  }

  const { data: lineRows, error: linesError } = await supabaseAdmin
    .from('settlement_lines')
    .select('id, booking_no, product_name, traveler_count, commission_base_krw, commission_rate, policy_set_version, line_type, line_amount_krw, departure_date, return_date, customer_masked, calculation_trace_id, line_snapshot, created_at')
    .eq('settlement_run_id', id)
    .order('created_at', { ascending: true });
  if (linesError) return errorResponse('SETTLEMENT_LINES_UNAVAILABLE', '정산 상세를 불러올 수 없습니다.', 503);

  const affiliates = settlement.affiliates as unknown;
  const affiliate = (Array.isArray(affiliates) ? affiliates[0] : affiliates) as {
    name: string;
    phone: string | null;
    referral_code: string;
    payout_type: string;
  } | null;
  if (!affiliate) return errorResponse('AFFILIATE_NOT_FOUND', '파트너 정보를 찾을 수 없습니다.', 404);

  const lines = (lineRows || []) as unknown as FrozenSettlementLine[];
  const breakdownTotals = lines.reduce(
    (totals, line) => {
      const ledger = line.line_snapshot?.ledger_entry as Record<string, unknown> | undefined;
      const breakdown = ledger?.commission_breakdown as {
        base?: number;
        tier?: number;
        campaigns?: Array<{ rate?: number }>;
        capped?: boolean;
      } | undefined;
      const baseAmount = Number(line.commission_base_krw || 0);
      if (line.line_amount_krw > 0 && breakdown && typeof breakdown.base === 'number') {
        totals.base += Math.round(baseAmount * breakdown.base);
        totals.tier += Math.round(baseAmount * Number(breakdown.tier || 0));
        totals.campaigns += Math.round(
          baseAmount * (breakdown.campaigns || []).reduce((sum, campaign) => sum + Number(campaign.rate || 0), 0),
        );
        if (breakdown.capped) totals.capped += 1;
      } else {
        totals.base += line.line_amount_krw;
      }
      return totals;
    },
    { base: 0, tier: 0, campaigns: 0, capped: 0 },
  );
  const pdfLines = lines.map(line => ({
    package_title: line.product_name,
    pax: Number(line.traveler_count || 0),
    base_amount: Number(line.commission_base_krw || 0),
    commission: Number(line.line_amount_krw),
    departure_date: line.departure_date || '',
    return_date: line.return_date,
  }));
  const [year, month] = settlement.settlement_period.split('-');
  const finalTotal = Number(settlement.gross_commission_krw || 0) + Number(settlement.adjustment_krw || 0);

  try {
    const document = React.createElement(SettlementPdfDocument, {
      affiliateName: affiliate.name,
      referralCode: affiliate.referral_code,
      phone: affiliate.phone,
      payoutType: affiliate.payout_type,
      year,
      month,
      periodLabel: `${year}년 ${Number(month)}월`,
      bookings: pdfLines,
      breakdownTotals,
      totalAmount: Number(settlement.gross_commission_krw || 0),
      adjustmentAmount: Number(settlement.adjustment_krw || 0),
      finalTotal,
      taxDeduction: Number(settlement.withholding_krw || 0),
      finalPayout: Number(settlement.net_payout_krw || 0),
    });
    const stream = await renderToStream(document as unknown as React.ReactElement);
    const filename = encodeURIComponent(`여소남_정산내역서_${affiliate.name}_${year}년${Number(month)}월.pdf`);
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Cache-Control': 'private, no-store',
        'X-Settlement-Contract': 'settlement-lines-v2',
      },
    });
  } catch (renderError) {
    console.error('[Settlement PDF V2]', renderError instanceof Error ? renderError.message : renderError);
    return errorResponse('PDF_GENERATION_FAILED', 'PDF 생성 중 오류가 발생했습니다.', 500);
  }
}
