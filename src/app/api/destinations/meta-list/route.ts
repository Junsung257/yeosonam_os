import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET /api/destinations/meta-list — 전체 destination_metadata 목록 */
const getHandler = async () => {
  const privateHeaders = { 'Cache-Control': 'private, no-store' };
  if (!isSupabaseConfigured) {
    return apiResponse({ data: [] }, { headers: privateHeaders });
  }

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .select(
      'destination, tagline, hero_tagline, hero_image_url, hero_image_provider, hero_image_pexels_id, hero_image_source_page_url, hero_image_source_file_title, hero_image_license, hero_image_license_url, hero_photographer, photo_approved, photo_approved_at, photo_approval_source, photo_quality_score',
    )
    .order('destination');

  if (error) {
    if (error.message?.includes('does not exist') || error.message?.includes('schema cache')) {
      return apiResponse({ data: [] }, { headers: privateHeaders });
    }
    return apiResponse(
      { error: '목적지 후보 목록을 불러오지 못했습니다.' },
      { status: 500, headers: privateHeaders },
    );
  }

  return apiResponse({ data }, { headers: privateHeaders });
};

export const GET = withAdminGuard(getHandler);
