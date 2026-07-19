import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSupabase } from '@/lib/supabase';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

function normalizePhoneForCustomerLookup(phone: string | null | undefined) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  return phone;
}

export async function GET() {
  const sb = getSupabase();
  if (!sb) {
    return apiResponse(
      { histories: [], error: 'TRAVEL_HISTORY_UNAVAILABLE' },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      return apiResponse({ histories: [] }, { headers: PRIVATE_NO_STORE_HEADERS });
    }

    let customerId: string | null = null;
    const phone = normalizePhoneForCustomerLookup(user.phone);

    if (phone) {
      const { data: customer, error: customerError } = await sb
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .limit(1);
      if (customerError) throw customerError;

      customerId =
        ((customer as unknown as Array<Record<string, unknown>>)?.[0]?.id as string) ?? null;
    }

    if (!customerId && user.email) {
      const { data: customerByEmail, error: customerByEmailError } = await sb
        .from('customers')
        .select('id')
        .eq('email', user.email)
        .limit(1);
      if (customerByEmailError) throw customerByEmailError;

      customerId =
        ((customerByEmail as unknown as Array<Record<string, unknown>>)?.[0]?.id as string) ?? null;
    }

    if (!customerId) {
      return apiResponse({ histories: [] }, { headers: PRIVATE_NO_STORE_HEADERS });
    }

    const { data, error } = await sb
      .from('user_travel_histories')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return apiResponse({ histories: data ?? [] }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error('[travel-history] lookup failed:', sanitizeDbError(error));
    return apiResponse(
      { histories: [], error: 'TRAVEL_HISTORY_LOOKUP_FAILED' },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
