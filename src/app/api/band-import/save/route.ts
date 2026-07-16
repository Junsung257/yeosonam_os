/**
 * POST /api/band-import/save
 *
 * AI 추출 미리보기 → products 테이블 INSERT + band_import_log 기록
 * 저장 성공 시 auto-content-trigger 호출 (Phase 3에서 연결)
 */

import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import { BAND_SUPPLIER_CODE, DEFAULT_MARGIN_RATE } from '@/lib/band-ai-analyzer';
import { persistBandImportedProduct } from '@/lib/band-import-persistence';
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
    if (!Number.isFinite(preview.net_price) || (preview.net_price ?? 0) <= 0) {
      return apiResponse({ error: '상품 원가가 필요합니다.' }, { status: 400 });
    }

    const productInternalCode = await persistBandImportedProduct({
      internalCode: preview.internal_code,
      displayName: preview.display_name,
      departureRegion: preview.departure_region,
      supplierCode: BAND_SUPPLIER_CODE,
      departureDate: preview.departure_date,
      netPrice: preview.net_price,
      marginRate: DEFAULT_MARGIN_RATE,
      aiTags: preview.ai_tags,
      sourceFilename: preview.source,
      postUrl: preview.band_post_url,
      postTitle: preview.display_name,
      rawText: safeRawTextExcerpt(rawText, 2000),
    });

    return apiResponse({ productInternalCode, ok: true }, { status: 201 });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return apiResponse({ error: '이미 등록된 상품 코드 또는 Band 게시글입니다.' }, { status: 409 });
    }
    return apiResponse(
      { error: sanitizeDbError(err, '저장 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
