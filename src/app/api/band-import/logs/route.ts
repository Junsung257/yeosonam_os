import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const getHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ logs: [] });

  const { data, error } = await supabaseAdmin
    .from('band_import_log')
    .select('id, post_url, post_title, status, imported_at, product_id')
    .order('imported_at', { ascending: false })
    .limit(50);

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ logs: data ?? [] });
};

export const GET = withAdminGuard(getHandler);
