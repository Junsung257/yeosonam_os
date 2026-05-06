/**
 * POST /api/admin/invoice/parse
 *
 * 랜드사 인보이스 이미지를 Gemini Vision으로 파싱하고
 * 최근 30일 ledger_entries와 불일치 항목을 대조해 반환.
 *
 * Request: multipart/form-data
 *   - file: 이미지 파일 (image/jpeg, image/png, image/webp 등)
 *   - land_operator_id (optional): 특정 랜드사 필터
 *
 * Response:
 *   {
 *     parsed: {
 *       vendor: string,
 *       invoice_date: string | null,
 *       currency: string,
 *       amount_krw: number | null,
 *       amount_usd: number | null,
 *       items: [{ description: string, amount: number }],
 *       total: number | null,
 *     },
 *     ledger_entries: [...],
 *     discrepancies: [{ type, description, invoice_amount, ledger_amount }],
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InvoiceItem {
  description: string;
  amount: number;
}

interface ParsedInvoice {
  vendor: string;
  invoice_date: string | null;
  currency: string;
  amount_krw: number | null;
  amount_usd: number | null;
  items: InvoiceItem[];
  total: number | null;
}

interface Discrepancy {
  type: string;
  description: string;
  invoice_amount: number | null;
  ledger_amount: number | null;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  if (!userData?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  const geminiApiKey = getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_AI_API_KEY');
  if (!geminiApiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY 또는 GOOGLE_AI_API_KEY가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const landOperatorId = formData.get('land_operator_id') as string | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다. file 필드에 이미지를 첨부해주세요.' }, { status: 400 });
    }

    // 파일을 Base64로 변환
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = (file.type || 'image/jpeg') as string;

    // Gemini Vision으로 인보이스 파싱
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `이 청구서(인보이스) 이미지를 분석해서 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "vendor": "공급업체명 또는 랜드사명",
  "invoice_date": "YYYY-MM-DD 형식 또는 null",
  "currency": "KRW 또는 USD 또는 기타 통화코드",
  "amount_krw": 원화 금액(숫자) 또는 null,
  "amount_usd": 달러 금액(숫자) 또는 null,
  "items": [
    { "description": "항목 설명", "amount": 금액(숫자) }
  ],
  "total": 합계금액(숫자) 또는 null
}

규칙:
- 금액은 쉼표 없는 순수 숫자로
- 날짜가 없으면 invoice_date는 null
- 항목이 없으면 items는 빈 배열 []
- 반드시 valid JSON만 반환`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const responseText = result.response.text().trim();

    // JSON 파싱 (마크다운 코드블록 제거)
    let parsed: ParsedInvoice;
    try {
      const cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned) as ParsedInvoice;
    } catch {
      return NextResponse.json(
        { error: 'AI 파싱 실패 — 이미지를 인식하지 못했습니다.', raw: responseText },
        { status: 422 },
      );
    }

    // 최근 30일 ledger_entries 조회
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabaseAdmin
      .from('ledger_entries')
      .select('id, created_at, account, entry_type, amount, source, memo')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);

    if (landOperatorId) {
      // land_operator_id 연결은 booking → package → land_operator_id 경로라서
      // 직접 필터 대신 memo 기반 soft 필터 (추후 FK 추가 시 개선)
      query = query.ilike('memo', `%${landOperatorId}%`);
    }

    const { data: ledgerEntries, error: ledgerError } = await query;
    if (ledgerError) throw ledgerError;

    // 불일치 탐지
    const discrepancies: Discrepancy[] = [];
    const invoiceTotal = parsed.total ?? parsed.amount_krw ?? parsed.amount_usd ?? null;

    if (invoiceTotal !== null && ledgerEntries && ledgerEntries.length > 0) {
      // 최근 30일 지출(payout) 합계
      const ledgerPayoutSum = ledgerEntries
        .filter((e: any) => e.account === 'total_paid_out' || e.entry_type === 'payout')
        .reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);

      if (Math.abs(invoiceTotal - ledgerPayoutSum) > 1000) {
        discrepancies.push({
          type: 'AMOUNT_MISMATCH',
          description: `인보이스 합계(${invoiceTotal.toLocaleString()}원)와 원장 지출 합계(${ledgerPayoutSum.toLocaleString()}원)가 불일치합니다.`,
          invoice_amount: invoiceTotal,
          ledger_amount: ledgerPayoutSum,
        });
      }
    }

    // 인보이스 항목별 원장 대조
    for (const item of parsed.items ?? []) {
      const matchedEntry = (ledgerEntries ?? []).find(
        (e: any) => e.memo && e.memo.includes(item.description),
      );
      if (!matchedEntry && item.amount > 0) {
        discrepancies.push({
          type: 'ITEM_NOT_IN_LEDGER',
          description: `인보이스 항목 "${item.description}"(${item.amount.toLocaleString()}원)에 해당하는 원장 항목이 없습니다.`,
          invoice_amount: item.amount,
          ledger_amount: null,
        });
      }
    }

    return NextResponse.json({
      parsed,
      ledger_entries: ledgerEntries ?? [],
      discrepancies,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
