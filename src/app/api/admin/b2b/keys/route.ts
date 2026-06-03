import { NextRequest } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { withAdminGuard } from '@/lib/admin-guard';

async function requireAdmin(request: NextRequest): Promise<string | null> {
  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  return userData?.user?.id ?? null;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ data: [] });
  }

  const userId = await requireAdmin(request);
  if (!userId) {
    return apiResponse({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('b2b_api_keys')
      .select(
        'id, label, is_active, rate_limit_per_hour, allowed_ips, created_at, last_used_at, total_calls, key_hash',
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    const masked = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      key_hash: `${(row.key_hash as string).slice(0, 8)}...`,
    }));

    return apiResponse({ data: masked });
  } catch (err) {
    return apiResponse({ error: logAndSanitize('admin-b2b-keys', err) }, { status: 500 });
  }
};

interface KeyCreateBody {
  label: string;
  rate_limit_per_hour?: number;
  allowed_ips?: string[];
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }

  const userId = await requireAdmin(request);
  if (!userId) {
    return apiResponse({ error: 'Authentication required' }, { status: 401 });
  }

  let body: KeyCreateBody;
  try {
    body = await request.json() as KeyCreateBody;
  } catch {
    return apiResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.label || typeof body.label !== 'string' || body.label.trim().length === 0) {
    return apiResponse({ error: 'label is required' }, { status: 400 });
  }

  const rawKey = randomUUID();
  const keyHash = hashKey(rawKey);

  try {
    const { data, error } = await supabaseAdmin
      .from('b2b_api_keys')
      .insert({
        key_hash: keyHash,
        label: body.label.trim(),
        rate_limit_per_hour: body.rate_limit_per_hour ?? 100,
        allowed_ips: body.allowed_ips ?? null,
      })
      .select('id, label, is_active, rate_limit_per_hour, allowed_ips, created_at')
      .single();

    if (error) throw error;

    return apiResponse(
      {
        ok: true,
        raw_key: rawKey,
        note: 'This key is shown only once. Store it securely.',
        key: data,
      },
      { status: 201 },
    );
  } catch (err) {
    return apiResponse({ error: logAndSanitize('admin-b2b-keys', err) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
