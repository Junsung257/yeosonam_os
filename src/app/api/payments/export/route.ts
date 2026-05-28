import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * GET /api/payments/export?type=settlements&from=YYYY-MM-DD&to=YYYY-MM-DD&status=all
 *
 * 정산 묶음 → CSV 다운로드 (회계사 보고용).
 * UTF-8 BOM 포함 — Excel 한글 호환.
 *
 * 1 settlement → N booking rows (booking 별 1줄). 합계 메타는 모든 row 에 반복.
 */

const HEADERS = [
  '생성일',
  '랜드사',
  '거래처',
  '환불여부',
  '출금액',
  '묶음합계',
  '수수료',
  '상태',
  '메모',
  'booking_no',
  '고객명',
  '출발일',
  '정산금',
  '확정시각',
  '확정자',
  'reverse사유',
] as const;

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const type = req.nextUrl.searchParams.get('type') ?? 'settlements';
  if (type !== 'settlements') {
    return NextResponse.json({ error: 'type 은 settlements 만 지원' }, { status: 400 });
  }

  const status = req.nextUrl.searchParams.get('status') ?? 'all';
  const from = req.nextUrl.searchParams.get('from'); // YYYY-MM-DD
  const to = req.nextUrl.searchParams.get('to');

  try {
    let query = supabaseAdmin
      .from('land_settlements')
      .select(
        'id, total_amount, bundled_total, fee_amount, is_refund, status, notes, created_at, confirmed_at, confirmed_by, reversal_reason, ' +
          'land_operators!land_operator_id(name), ' +
          'bank_transactions!bank_transaction_id(counterparty_name), ' +
          'land_settlement_bookings(amount, bookings!booking_id(booking_no, departure_date, customers!lead_customer_id(name)))',
      )
      .order('created_at', { ascending: false })
      .limit(2000);

    if (status !== 'all') query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', `${to}T23:59:59`);

    const { data, error } = await query;
    if (error) throw error;

    type Embed1 = { name?: string | null } | { name?: string | null }[] | null;
    type TxEmbed =
      | { counterparty_name?: string | null }
      | { counterparty_name?: string | null }[]
      | null;
    const pickName = (v: Embed1): string => {
      if (!v) return '';
      if (Array.isArray(v)) return v[0]?.name ?? '';
      return v.name ?? '';
    };
    const pickCp = (v: TxEmbed): string => {
      if (!v) return '';
      if (Array.isArray(v)) return v[0]?.counterparty_name ?? '';
      return v.counterparty_name ?? '';
    };

    const rows: string[][] = [HEADERS.slice() as unknown as string[]];

    interface ExportSettlementRow {
      id: string;
      created_at: string | null;
      total_amount: number;
      bundled_total: number;
      fee_amount: number;
      is_refund: boolean;
      status: string;
      notes: string | null;
      confirmed_at: string | null;
      confirmed_by: string | null;
      reversal_reason: string | null;
      land_operators: Embed1;
      bank_transactions: TxEmbed;
      land_settlement_bookings: Array<{
        amount: number;
        bookings: {
          booking_no: string | null;
          departure_date: string | null;
          customers: Embed1;
        } | null;
      }> | null;
    }

    for (const s of (data ?? []) as unknown as ExportSettlementRow[]) {
      const operatorName = pickName(s.land_operators);
      const counterparty = pickCp(s.bank_transactions);
      const lsb = s.land_settlement_bookings ?? [];
      if (lsb.length === 0) {
        rows.push([
          s.created_at?.slice(0, 10) ?? '',
          operatorName,
          counterparty,
          s.is_refund ? '환불' : '송금',
          String(s.total_amount ?? 0),
          String(s.bundled_total ?? 0),
          String(s.fee_amount ?? 0),
          s.status ?? '',
          s.notes ?? '',
          '',
          '',
          '',
          '',
          s.confirmed_at ?? '',
          s.confirmed_by ?? '',
          s.reversal_reason ?? '',
        ]);
      } else {
        for (const j of lsb) {
          const b = j.bookings;
          rows.push([
            s.created_at?.slice(0, 10) ?? '',
            operatorName,
            counterparty,
            s.is_refund ? '환불' : '송금',
            String(s.total_amount ?? 0),
            String(s.bundled_total ?? 0),
            String(s.fee_amount ?? 0),
            s.status ?? '',
            s.notes ?? '',
            b?.booking_no ?? '',
            pickName(b?.customers ?? null),
            b?.departure_date ?? '',
            String(j.amount ?? 0),
            s.confirmed_at ?? '',
            s.confirmed_by ?? '',
            s.reversal_reason ?? '',
          ]);
        }
      }
    }

    const csv = '﻿' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
    const filename = buildFilename(from, to, status);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'export 실패' },
      { status: 500 },
    );
  }
}

function csvEscape(s: string): string {
  if (s == null) return '';
  const t = String(s);
  if (/[",\r\n]/.test(t)) {
    return `"${t.replace(/"/g, '""')}"`;
  }
  return t;
}

function buildFilename(from: string | null, to: string | null, status: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const range = from && to ? `${from}_${to}` : from ? `from-${from}` : to ? `to-${to}` : today;
  return `settlements_${status}_${range}.csv`;
}
