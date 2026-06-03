import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { mintGuestPortalToken } from '@/lib/booking-guest-token';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const postHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { id: bookingId } = await params;
  if (!bookingId) {
    return apiResponse({ error: 'BOOKING_ID_REQUIRED' }, { status: 400 });
  }

  const { data: row, error } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
  if (!row) {
    return apiResponse({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });
  }

  try {
    const { portalUrl, expiresAt } = await mintGuestPortalToken(bookingId);
    return apiResponse({ portalUrl, expiresAt });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
