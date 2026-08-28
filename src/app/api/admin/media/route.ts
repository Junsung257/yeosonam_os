import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured } from '@/lib/supabase';
import {
  listMediaAssets,
  type MediaAssetStatus,
  type MediaPurpose,
} from '@/lib/media-generation';

const STATUSES = new Set<MediaAssetStatus>(['pending', 'generating', 'pending_review', 'approved', 'rejected', 'failed', 'superseded']);
const PURPOSES = new Set<MediaPurpose>([
  'blog_cover',
  'blog_inline_summary',
  'blog_inline_cta',
  'home_campaign_hero',
  'card_news_background',
  'social_og',
  'brand_fallback',
]);

async function getHandler(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const rawStatus = request.nextUrl.searchParams.get('status');
  const rawPurpose = request.nextUrl.searchParams.get('purpose');
  const status = rawStatus && STATUSES.has(rawStatus as MediaAssetStatus)
    ? rawStatus as MediaAssetStatus
    : undefined;
  const purpose = rawPurpose && PURPOSES.has(rawPurpose as MediaPurpose)
    ? rawPurpose as MediaPurpose
    : undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  try {
    const assets = await listMediaAssets({ status, purpose, limit });
    return apiResponse({ assets });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '미디어 자산 조회 실패') },
      { status: 500 },
    );
  }
}

export const GET = withAdminGuard(getHandler);
