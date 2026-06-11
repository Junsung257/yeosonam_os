/**
 * POST /api/band-import/save
 *
 * AI 추출 미리보기 → products 테이블 INSERT + band_import_log 기록
 * 저장 성공 시 auto-content-trigger 호출 (Phase 3에서 연결)
 */

import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { triggerContentGeneration } from '@/lib/auto-content-trigger';
import { BAND_SUPPLIER_CODE, DEFAULT_MARGIN_RATE } from '@/lib/band-ai-analyzer';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { withAdminGuard } from '@/lib/admin-guard';

interface Preview {
  internal_code: string;
  display_name: string;
  destination: string;
  destination_code: string;
  departure_region: string;
  departure_region_code: string;
  duration_days: number;
  departure_date: string | null;
  net_price: number | null;
  ai_tags: string[];
  source: string;
  band_post_url: string | null;
}

async function postHandler(request: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { preview, rawText } = await request.json() as { preview: Preview; rawText?: string };

    if (!preview?.internal_code) {
      return apiResponse({ error: 'preview 데이터 누락' }, { status: 400 });
    }

    // products INSERT
    const { data: product, error: insertErr } = await supabaseAdmin
      .from('products')
      .insert({
        internal_code:         preview.internal_code,
        display_name:          preview.display_name,
        departure_region:      preview.departure_region,
        departure_region_code: preview.departure_region_code,
        supplier_code:         BAND_SUPPLIER_CODE,
        destination:           preview.destination,
        destination_code:      preview.destination_code,
        duration_days:         preview.duration_days,
        departure_date:        preview.departure_date,
        net_price:             preview.net_price ?? 0,
        margin_rate:           DEFAULT_MARGIN_RATE,
        discount_amount:       0,
        ai_tags:               preview.ai_tags,
        status:                'DRAFT',
        source_filename:       preview.source,
      })
      .select('id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return apiResponse(
          { error: `이미 존재하는 상품 코드: ${preview.internal_code}` },
          { status: 409 },
        );
      }
      throw insertErr;
    }
    const productId = (product as { id: string }).id;

    // band_import_log INSERT
    if (preview.band_post_url) {
      await supabaseAdmin.from('band_import_log').insert({
        post_url:    preview.band_post_url,
        post_title:  preview.display_name,
        raw_text:    safeRawTextExcerpt(rawText, 2000),
        product_id:  productId,
        status:      'imported',
      });
    }

    // 콘텐츠 자동 생성 큐 등록 (실패해도 저장 결과에 영향 없음)
    void triggerContentGeneration({
      productId,
      displayName: preview.display_name,
      destination: preview.destination,
      destinationCode: preview.destination_code,
    });

    return apiResponse({ productId, ok: true }, { status: 201 });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, '저장 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
