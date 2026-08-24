import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { dispatchProductRegistrationPublicationRequests } from '@/lib/product-registration-authority/publication-dispatch';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const handler = async () => {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return apiResponse(
      { success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const publicBaseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || 'https://www.yeosonam.com'
  ).replace(/\/$/u, '');
  const results = await dispatchProductRegistrationPublicationRequests({
    supabase,
    limit: 10,
    requestBaseUrl: publicBaseUrl,
    publicBaseUrl,
  });
  return apiResponse(
    { success: true, checked: results.length, results },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};

export const GET = withCronGuard(handler);
