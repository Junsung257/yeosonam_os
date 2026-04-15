/**
 * @file /api/products/review/route.ts
 * @description Phase 3 — 상품 검수 관제탑 API
 *
 * GET  → 검수 대기 상품 목록 (DRAFT / REVIEW_NEEDED / draft)
 * POST → action=approve | reject | faq | images | marketing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { searchPexelsPhotos } from '@/lib/pexels';
import { generateAdVariants } from '@/lib/ai';
import { checkAiCopyConsistency } from '@/lib/ai-consistency-checker';

// ─── VA 검수 체크리스트 계산 ──────────────────────────────────────────────
// 각 상품이 ACTIVE 진입해도 안전한지 자동 검증

interface VAChecklist {
  price_range_ok: boolean;         // 1만원 ~ 5천만원
  raw_text_attached: boolean;      // 원문 200자 이상
  ai_copy_consistent: boolean;     // 원문 vs highlights 모순 없음
  highlights_present: boolean;     // 핵심 특전 1개 이상
  has_prices: boolean;             // product_prices 1건 이상
  all_passed: boolean;
  failures: string[];
}

function computeVAChecklist(p: {
  net_price?: number | null;
  raw_extracted_text?: string | null;
  highlights?: string[] | null;
  product_prices?: Array<unknown> | null;
}): VAChecklist {
  const failures: string[] = [];

  const price_range_ok = typeof p.net_price === 'number' && p.net_price >= 10_000 && p.net_price <= 50_000_000;
  if (!price_range_ok) failures.push('가격이 1만원~5천만원 범위 밖');

  const raw_text_attached = typeof p.raw_extracted_text === 'string' && p.raw_extracted_text.length >= 200;
  if (!raw_text_attached) failures.push('원문 텍스트 200자 미만');

  const highlightsArr = Array.isArray(p.highlights) ? p.highlights : [];
  const highlights_present = highlightsArr.length > 0;
  if (!highlights_present) failures.push('highlights(특전) 누락');

  const has_prices = Array.isArray(p.product_prices) && p.product_prices.length > 0;
  if (!has_prices) failures.push('product_prices 행 0건');

  // AI 카피 일관성: highlights 합성 문자열 vs raw_extracted_text
  let ai_copy_consistent = true;
  if (highlights_present && raw_text_attached) {
    const result = checkAiCopyConsistency({
      generatedCopy: highlightsArr.join('\n'),
      rawText: p.raw_extracted_text ?? '',
      minPrice: p.net_price ?? null,
    });
    if (result.severity === 'high') {
      ai_copy_consistent = false;
      failures.push(`AI 카피 모순: ${result.conflicts[0]?.rule ?? 'unknown'}`);
    }
  }

  const all_passed = price_range_ok && raw_text_attached && highlights_present && has_prices && ai_copy_consistent;

  return { price_range_ok, raw_text_attached, ai_copy_consistent, highlights_present, has_prices, all_passed, failures };
}

// ─── GET: 검수 대기 상품 목록 (체크리스트 포함) ────────────────────────────

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(`
        internal_code, display_name, departure_region, departure_region_code,
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

    // 각 상품마다 VA 체크리스트 계산
    type ReviewProductRow = Parameters<typeof computeVAChecklist>[0] & Record<string, unknown>;
    const products = (data ?? []).map((p: ReviewProductRow) => ({
      ...p,
      va_checklist: computeVAChecklist(p),
    }));

    return NextResponse.json({ products });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─── POST: 액션 라우터 ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  try {
    const body = await req.json();

    switch (action) {
      case 'approve':  return handleApprove(body);
      case 'reject':   return handleReject(body);
      case 'faq':      return handleFaq(body);
      case 'images':   return handleImages(body);
      case 'marketing':return handleMarketing(body);
      default:
        return NextResponse.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── 승인 ─────────────────────────────────────────────────────────────────────

async function handleApprove(body: {
  product_id: string;
  selected_image_url?: string | null;
  faq?: { q: string; a: string }[];
  confidence_before?: number | null;
  resolved_supplier_id?: string | null;
  resolved_supplier_name?: string | null;
  resolved_supplier_code?: string | null;
  /** 체크리스트 실패 시에도 관리자 권한으로 강제 승인 */
  force_approve?: boolean;
}) {
  const {
    product_id, selected_image_url, faq, confidence_before,
    resolved_supplier_id, resolved_supplier_name, resolved_supplier_code,
    force_approve = false,
  } = body;
  if (!product_id) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });

  // ── VA 체크리스트 게이트 ──
  if (!force_approve) {
    const { data: prodCheck } = await supabaseAdmin
      .from('products')
      .select('net_price, raw_extracted_text, highlights, product_prices(id)')
      .eq('internal_code', product_id)
      .maybeSingle();

    if (prodCheck) {
      const checklist = computeVAChecklist(prodCheck as Parameters<typeof computeVAChecklist>[0]);
      if (!checklist.all_passed) {
        return NextResponse.json({
          error: 'VA 체크리스트 실패',
          failures: checklist.failures,
          hint: '강제 승인하려면 force_approve:true 로 재요청',
        }, { status: 422 });
      }
    }
  }

  // 1. products: status → ACTIVE + thumbnail + (optional) supplier 업데이트
  const updatePayload: Record<string, unknown> = {
    status: 'ACTIVE',
    thumbnail_urls: selected_image_url ? [selected_image_url] : [],
    updated_at: new Date().toISOString(),
  };
  if (resolved_supplier_id && resolved_supplier_name) {
    updatePayload.supplier_name    = resolved_supplier_name;
    updatePayload.land_operator_id = resolved_supplier_id;
    if (resolved_supplier_code) updatePayload.supplier_code = resolved_supplier_code;
  }

  const { error: prodErr } = await supabaseAdmin
    .from('products')
    .update(updatePayload)
    .eq('internal_code', product_id);

  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  // 2. travel_packages: status → approved (랜딩페이지 활성화)
  await supabaseAdmin
    .from('travel_packages')
    .update({ status: 'approved' })
    .eq('internal_code', product_id);

  // 3. ai_training_logs: 플라이휠 기록 (실패해도 무시)
  const flywheelJson: Record<string, unknown> = faq ? { faq_approved: faq } : {};
  const correctionDiff: Record<string, unknown> | null =
    (resolved_supplier_id && resolved_supplier_name && !resolved_supplier_id.startsWith('default-'))
      ? { supplier_code: { to: resolved_supplier_code ?? 'ETC' }, land_operator_id: { from: null, to: resolved_supplier_id } }
      : null;

  // 랜드사 수동 지정 시 text_fingerprint도 함께 기록 (Phase 2 RAG 학습)
  if (correctionDiff) {
    try {
      const { data: prod } = await supabaseAdmin
        .from('products')
        .select('raw_extracted_text')
        .eq('internal_code', product_id)
        .maybeSingle();
      const rawText = (prod as any)?.raw_extracted_text ?? '';
      if (rawText) {
        const fingerprint = createHash('sha256').update(rawText.slice(0, 500)).digest('hex');
        flywheelJson.text_fingerprint     = fingerprint;
        flywheelJson.supplier_inferred    = 'ETC';
        flywheelJson.supplier_name        = resolved_supplier_name;
        flywheelJson.land_operator_id     = resolved_supplier_id;
      }
    } catch (e) {
      console.warn('[handleApprove] fingerprint 계산 실패:', e);
    }
  }

  await supabaseAdmin
    .from('ai_training_logs')
    .insert({
      product_id,
      human_corrected_json: Object.keys(flywheelJson).length ? flywheelJson : null,
      correction_diff:      correctionDiff,
      confidence_before:    confidence_before ?? null,
      confidence_after:     100,
      ai_model_used:        'human_review',
    });

  return NextResponse.json({
    success: true,
    landing_url: `/packages/${product_id}`,
  });
}

// ── 반려 ─────────────────────────────────────────────────────────────────────

async function handleReject(body: { product_id: string; reason?: string }) {
  const { product_id, reason } = body;
  if (!product_id) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('products')
    .update({
      status: 'INACTIVE',
      internal_memo: reason ?? '검수 반려',
      updated_at: new Date().toISOString(),
    })
    .eq('internal_code', product_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// ── FAQ 생성 ──────────────────────────────────────────────────────────────────

async function handleFaq(body: { product_id: string }) {
  const { product_id } = body;
  if (!product_id) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('raw_extracted_text, destination, display_name')
    .eq('internal_code', product_id)
    .maybeSingle();

  if (!product) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

  const rawText = ((product as any).raw_extracted_text ?? '') as string;
  const snippet = rawText.slice(0, 8000);

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!apiKey) {
    // API 키 없으면 더미 FAQ 반환
    return NextResponse.json({
      faq: [
        { q: '출발일은 언제인가요?', a: '출발일은 상품 상세 페이지에서 확인해주세요.' },
        { q: '아동 요금이 있나요?', a: '아동 요금은 별도 문의 부탁드립니다.' },
        { q: '취소 수수료는 어떻게 되나요?', a: '출발 7일 전 취소 시 수수료가 발생합니다.' },
      ],
    });
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
다음 여행상품 원문을 분석하여, 고객이 자주 물어볼 질문 10개와 정확한 답변을 생성하세요.
답변은 반드시 원문에 근거하여 작성하고, 원문에 없는 내용은 "별도 문의 부탁드립니다"로 처리하세요.
원가/랜드사 등 내부 정보는 절대 포함하지 마세요.

출력 형식 (JSON 배열만, 마크다운 없이):
[{"q":"질문","a":"답변"},...]

상품명: ${(product as any).display_name ?? ''}
목적지: ${(product as any).destination ?? ''}

원문:
${snippet}
`.trim();

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('FAQ JSON 파싱 실패');
    const faq = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ faq });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── 이미지 검색 ───────────────────────────────────────────────────────────────

async function handleImages(body: { product_id: string }) {
  const { product_id } = body;
  if (!product_id) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('destination, theme_tags')
    .eq('internal_code', product_id)
    .maybeSingle();

  if (!product) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

  const destination = (product as any).destination ?? '';
  const tags: string[] = (product as any).theme_tags ?? [];
  const keyword = `${destination} ${tags.slice(0, 2).join(' ')} travel`.trim();

  try {
    const photos = await searchPexelsPhotos(keyword, 6);
    return NextResponse.json({ photos });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── 마케팅 콘텐츠 생성 ────────────────────────────────────────────────────────

async function handleMarketing(body: {
  product_id: string;
  type: 'blog' | 'instagram' | 'itinerary';
  model?: string;
}) {
  const { product_id, type } = body;
  if (!product_id) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('destination, duration_days, net_price, highlights, raw_extracted_text, selling_points, product_prices(*)')
    .eq('internal_code', product_id)
    .maybeSingle();

  if (!product) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

  const p = product as any;

  if (type === 'itinerary') {
    // 일정표는 데이터 JSON 반환 (프론트에서 렌더)
    return NextResponse.json({
      type: 'itinerary',
      data: {
        product_id,
        destination: p.destination,
        duration_days: p.duration_days,
        net_price: p.net_price,
        highlights: p.highlights ?? [],
        selling_points: p.selling_points ?? null,
        product_prices: p.product_prices ?? [],
      },
    });
  }

  // blog / instagram
  const platform = type === 'blog' ? 'blog' : 'instagram';
  try {
    const variants = await generateAdVariants(
      {
        destination: p.destination ?? '해외여행',
        price: p.net_price ?? 0,
        duration: p.duration_days ?? 3,
        product_highlights: p.highlights ?? [],
        product_summary: (p.raw_extracted_text ?? '').slice(0, 1000),
      },
      platform,
      'gemini',
    );
    const content = variants.map(v => [v.headline, v.body_copy].filter(Boolean).join('\n')).join('\n\n---\n\n');
    return NextResponse.json({ type, content });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
