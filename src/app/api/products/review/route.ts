/**
 * Legacy review queue reader.
 * Mutable approve/reject/copy/media actions were retired when registration
 * authority moved to immutable revisions and CAS publication.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { checkAiCopyConsistency } from '@/lib/ai-consistency-checker';
import { withAdminGuard } from '@/lib/admin-guard';
import { supabaseAdmin } from '@/lib/supabase';

interface VAChecklist {
  price_range_ok: boolean;
  raw_text_attached: boolean;
  ai_copy_consistent: boolean;
  highlights_present: boolean;
  has_prices: boolean;
  all_passed: boolean;
  failures: string[];
}

function computeVAChecklist(product: {
  net_price?: number | null;
  raw_extracted_text?: string | null;
  highlights?: string[] | null;
  product_prices?: Array<unknown> | null;
}): VAChecklist {
  const failures: string[] = [];
  const priceRangeOk = typeof product.net_price === 'number'
    && product.net_price >= 10_000
    && product.net_price <= 50_000_000;
  if (!priceRangeOk) failures.push('가격이 1만원~5천만원 범위 밖');
  const rawTextAttached = typeof product.raw_extracted_text === 'string'
    && product.raw_extracted_text.length >= 200;
  if (!rawTextAttached) failures.push('원문 텍스트 200자 미만');
  const highlights = Array.isArray(product.highlights) ? product.highlights : [];
  const highlightsPresent = highlights.length > 0;
  if (!highlightsPresent) failures.push('highlights(특전) 누락');
  const hasPrices = Array.isArray(product.product_prices) && product.product_prices.length > 0;
  if (!hasPrices) failures.push('product_prices 행 0건');
  let copyConsistent = true;
  if (highlightsPresent && rawTextAttached) {
    const result = checkAiCopyConsistency({
      generatedCopy: highlights.join('\n'),
      rawText: product.raw_extracted_text ?? '',
      minPrice: product.net_price ?? null,
    });
    if (result.severity === 'high') {
      copyConsistent = false;
      failures.push(`AI 카피 모순: ${result.conflicts[0]?.rule ?? 'unknown'}`);
    }
  }
  return {
    price_range_ok: priceRangeOk,
    raw_text_attached: rawTextAttached,
    ai_copy_consistent: copyConsistent,
    highlights_present: highlightsPresent,
    has_prices: hasPrices,
    all_passed: priceRangeOk && rawTextAttached && copyConsistent && highlightsPresent && hasPrices,
    failures,
  };
}

async function getHandler() {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(`
        internal_code, display_name, departure_region,
        supplier_name, supplier_code, destination, destination_code,
        duration_days, net_price, margin_rate, discount_amount,
        ai_tags, theme_tags, status, source_filename,
        land_operator_id, departing_location_id,
        ai_confidence_score, selling_points, flight_info,
        raw_extracted_text, thumbnail_urls,
        highlights, b2b_notes, public_itinerary,
        internal_memo, created_at, updated_at,
        product_prices (
          id, target_date, day_of_week, net_price,
          adult_selling_price, child_price, note
        )
      `)
      .in('status', ['DRAFT', 'REVIEW_NEEDED', 'draft'])
      .order('ai_confidence_score', { ascending: true, nullsFirst: true })
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    type ReviewProduct = Parameters<typeof computeVAChecklist>[0]
      & Record<string, unknown>
      & { internal_code: string };
    const products = (data ?? []) as ReviewProduct[];
    const codes = products.map(product => product.internal_code).filter(Boolean);
    const qualityMap = new Map<string, Record<string, unknown>>();
    if (codes.length > 0) {
      const { data: qualityRows } = await supabaseAdmin
        .from('ai_quality_log')
        .select('internal_code, confidence, fill_score, xvalid_score, leak_score, auto_gate, failed_checks, leak_incidents, cove_warnings, created_at')
        .in('internal_code', codes)
        .order('created_at', { ascending: false });
      for (const row of qualityRows ?? []) {
        const record = row as Record<string, unknown> & { internal_code: string };
        if (!qualityMap.has(record.internal_code)) qualityMap.set(record.internal_code, record);
      }
    }
    return NextResponse.json({
      products: products.map(product => ({
        ...product,
        va_checklist: computeVAChecklist(product),
        v2_quality: qualityMap.get(product.internal_code) ?? null,
        mutation_retired: true,
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function postHandler(_request: NextRequest) {
  return NextResponse.json({
    error: '기존 검수 화면의 강제 승인·반려·사진·문구 직접 수정은 종료되었습니다. 자동 workflow 결과와 correction revision을 사용해 주세요.',
    code: 'LEGACY_PRODUCT_REVIEW_MUTATION_RETIRED',
    next: '/admin/product-registration',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
