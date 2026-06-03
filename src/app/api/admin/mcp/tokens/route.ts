import { createHash, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { invalidateMcpAuthCache } from '@/lib/jarvis/mcp-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateMcpKey(): string {
  const raw = randomBytes(32).toString('hex');
  return `sk-mcp-${raw}`;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function requirePlatformAdmin(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;

  const { data: profile, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (error || !profile || profile.role !== 'platform_admin') return null;
  return user;
}

export async function GET(request: NextRequest) {
  const user = await requirePlatformAdmin(request);
  if (!user) {
    return apiResponse({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('tenant_tokens')
    .select('id, label, token_prefix, role, is_active, last_used_at, created_at')
    .eq('provider', 'mcp')
    .order('created_at', { ascending: false });

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({ tokens: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await requirePlatformAdmin(request);
  if (!user) {
    return apiResponse({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: { label?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) {
    return apiResponse({ error: 'LABEL_REQUIRED' }, { status: 400 });
  }

  const validRoles = ['tenant_staff', 'tenant_admin', 'platform_admin'] as const;
  const role = typeof body.role === 'string' ? body.role : undefined;
  if (role && !validRoles.includes(role as typeof validRoles[number])) {
    return apiResponse({ error: 'INVALID_ROLE' }, { status: 400 });
  }

  const rawKey = generateMcpKey();
  const keyHash = hashKey(rawKey);
  const prefix = rawKey.substring(0, 12);
  const tokenRole = role ?? 'tenant_staff';

  const { data, error } = await supabaseAdmin
    .from('tenant_tokens')
    .insert({
      provider: 'mcp',
      label,
      token_prefix: prefix,
      access_token: keyHash,
      role: tokenRole,
      is_active: true,
      scopes: [],
    })
    .select('id')
    .single();

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({
    id: data.id,
    token: rawKey,
    label,
    role: tokenRole,
  });
}

export async function DELETE(request: NextRequest) {
  const user = await requirePlatformAdmin(request);
  if (!user) {
    return apiResponse({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return apiResponse({ error: 'ID_REQUIRED' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('tenant_tokens')
    .update({ is_active: false })
    .eq('id', id)
    .eq('provider', 'mcp');

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  invalidateMcpAuthCache();

  return apiResponse({ success: true });
}
