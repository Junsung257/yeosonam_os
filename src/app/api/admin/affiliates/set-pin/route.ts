import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

async function postHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  let body: { affiliate_id?: unknown; pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const affiliateId = typeof body.affiliate_id === 'string' ? body.affiliate_id.trim() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

  if (!affiliateId || !/^\d{4,12}$/.test(pin)) {
    return apiResponse({ error: 'INVALID_PIN_REQUEST' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('affiliates')
    .update({ portal_pin: pin })
    .eq('id', affiliateId);

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({ success: true });
}

export const POST = withAdminGuard(postHandler);
