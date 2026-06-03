import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { requireAuthenticatedRoute } from '@/lib/session-guard';
import { verifyInfluencerPinForReferral } from '@/lib/affiliate-influencer-auth';
import { verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';
import { SettlementPdfDocument } from '@/lib/affiliate/settlement-pdf';
import { errorResponse } from '@/lib/api-response';

// GET /api/settlements/[id]/pdf — 정산 내역서 PDF 다운로드
// 인증: (1) 어드민 Supabase 세션 또는
//       (2) JWT 쿠키(inf_token) 또는
//       (3) 헤더 x-referral-code + x-pin(4자리) — 하위호환
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) return errorResponse('SERVICE_UNAVAILABLE', 'DB 미설정', 503);

  const { id } = params;

  const guard = await requireAuthenticatedRoute(request);
  const isAdmin = !(guard instanceof NextResponse);
  let pinAffiliateId: string | null = null;

  if (!isAdmin) {
    // (A) JWT 쿠키 우선 확인
    const token = request.cookies.get('inf_token')?.value;
    if (token) {
      const jwtResult = await verifyAffiliateToken(token);
      if (jwtResult.ok) {
        pinAffiliateId = jwtResult.affiliateId;
      }
    }

    // (B) JWT 없으면 PIN 헤더 확인 (하위호환)
    if (!pinAffiliateId) {
      const code = request.headers.get('x-referral-code')?.trim() || '';
      const pin = request.headers.get('x-pin')?.trim() || '';
      if (!code || !/^\d{4}$/.test(pin)) {
        return errorResponse('UNAUTHORIZED', '어드민 로그인 또는 파트너 인증이 필요합니다.', 401);
      }
      const v = await verifyInfluencerPinForReferral(code, pin);
      if (!v.ok) return errorResponse('AUTH_FAILED', '파트너 인증 실패', 401);
      pinAffiliateId = v.affiliateId;
    }
  }

  // 정산 + 어필리에이트 조회
  const { data: settlement, error } = await supabaseAdmin
    .from('settlements')
    .select('*, affiliates(name, phone, referral_code, payout_type, encrypted_bank_info, commission_rate)')
    .eq('id', id)
    .single();

  if (error || !settlement) {
    return errorResponse('NOT_FOUND', '정산을 찾을 수 없습니다.', 404);
  }

  if (!isAdmin) {
    if (!pinAffiliateId || (settlement as { affiliate_id: string }).affiliate_id !== pinAffiliateId) {
      return errorResponse('FORBIDDEN', '권한 없음', 403);
    }
  }

  try {
    const affRaw = (settlement as { affiliates: unknown }).affiliates;
    if (!affRaw) {
      console.error('[정산 PDF] affiliates가 null입니다 — settlement_id:', id);
      return errorResponse('NOT_FOUND', '제휴사 정보를 찾을 수 없습니다.', 404);
    }
    const aff = affRaw as { name: string; phone: string | null; referral_code: string; payout_type: string };
    const [year, month] = settlement.settlement_period.split('-');

    // 해당 정산 기간의 귀속 예약 조회
    const periodStart = `${year}-${month}-01`;
    const periodEnd = new Date(+year, +month, 0).toISOString().split('T')[0];

    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('id, package_title, adult_count, adult_price, child_count, child_price, influencer_commission, applied_total_commission_rate, commission_breakdown, return_date, departure_date, dispute_flag')
      .eq('affiliate_id', settlement.affiliate_id)
      .in('status', ['confirmed', 'completed', 'fully_paid'])
      .gte('return_date', periodStart)
      .lte('return_date', periodEnd)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .order('return_date', { ascending: true });

    const qualifiedBookings = (bookings || []).filter((b: Record<string, unknown>) => !b.dispute_flag);

    // 커미션 분해 합계 (스냅샷 기반)
    const breakdownTotals = qualifiedBookings.reduce(
      (acc: { base: number; tier: number; campaigns: number; capped: number }, b: Record<string, unknown>) => {
        const bdRaw = b.commission_breakdown as
          | { base?: number; tier?: number; campaigns?: { rate?: number }[]; capped?: boolean }
          | null
          | undefined;
        const bd = bdRaw ?? null;
        const adultCnt = (b.adult_count as number) || 0;
        const adultPr = (b.adult_price as number) || 0;
        const childCnt = (b.child_count as number) || 0;
        const childPr = (b.child_price as number) || 0;
        const base = adultCnt * adultPr + childCnt * childPr;
        if (bd && typeof bd.base === 'number') {
          acc.base += Math.round(base * bd.base);
          acc.tier += Math.round(base * (bd.tier || 0));
          const camp = (bd.campaigns || []).reduce((s: number, c) => s + (c.rate || 0), 0);
          acc.campaigns += Math.round(base * camp);
          if (bd.capped) acc.capped += 1;
        } else {
          acc.base += (b.influencer_commission as number) || 0;
        }
        return acc;
      },
      { base: 0, tier: 0, campaigns: 0, capped: 0 },
    );

    const pdfBookings: Array<{
      package_title: string;
      pax: number;
      base_amount: number;
      commission: number;
      departure_date: string;
      return_date: string | null;
    }> = qualifiedBookings.map((b: Record<string, unknown>) => ({
      package_title: (b.package_title as string) || '',
      pax: ((b.adult_count as number) || 0) + ((b.child_count as number) || 0),
      base_amount: ((b.adult_count as number) || 0) * ((b.adult_price as number) || 0) + ((b.child_count as number) || 0) * ((b.child_price as number) || 0),
      commission: (b.influencer_commission as number) || 0,
      departure_date: (b.departure_date as string) || '',
      return_date: (b.return_date as string) || null,
    }));
    // PDF 문서 생성
    const pdfDoc = React.createElement(SettlementPdfDocument, {
      affiliateName: aff.name,
      referralCode: aff.referral_code,
      phone: aff.phone || null,
      payoutType: aff.payout_type,
      year: String(year),
      month: String(month),
      periodLabel: `${year}년 ${+month}월`,
      bookings: pdfBookings,
      breakdownTotals,
      totalAmount: settlement.total_amount || 0,
      carryoverBalance: settlement.carryover_balance || 0,
      finalTotal: settlement.final_total || 0,
      taxDeduction: settlement.tax_deduction || 0,
      finalPayout: settlement.final_payout || 0,
    });

    const stream = await renderToStream(pdfDoc as unknown as React.ReactElement);

    const fileName = encodeURIComponent(`여소남_정산내역서_${aff.name}_${year}년${+month}월.pdf`);

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${fileName}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[정산 PDF] 생성 실패:', err);
    return errorResponse('PDF_GENERATION_FAILED', 'PDF 생성 중 오류가 발생했습니다.', 500);
  }
}
