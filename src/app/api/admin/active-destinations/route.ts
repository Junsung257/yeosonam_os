import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

const getHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ data: [] });

  const { data, error } = await supabaseAdmin
    .from('active_destinations')
    .select('destination, package_count, min_price, avg_rating, total_reviews')
    .order('package_count', { ascending: false })
    .limit(200);

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ data });
};

export const GET = withAdminGuard(getHandler);
