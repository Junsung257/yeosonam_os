/**
 * Secondary session guard for API routes.
 *
 * Middleware does the first cookie/JWT check, but direct API calls and matcher
 * gaps still need a route-entry guard that verifies the Supabase access token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { apiResponse } from '@/lib/api-response';
import { getSupabasePublicConfig } from '@/lib/app-config';

export interface AuthGuardSuccess {
  userId: string;
  email: string | null;
}

function authFailure(body: { code: string; error: string }, status = 401): NextResponse {
  const response = apiResponse(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function requireAuthenticatedRoute(
  request: NextRequest,
): Promise<AuthGuardSuccess | NextResponse> {
  if (process.env.NODE_ENV !== 'production' && request.cookies.get('ys-dev-admin')?.value === '1') {
    return { userId: 'dev-admin', email: null };
  }

  const { url, anonKey: key } = getSupabasePublicConfig();

  if (!url || !key) {
    if (process.env.NODE_ENV === 'production') {
      return authFailure(
        { code: 'AUTH_CONFIG_MISSING', error: 'Authentication service unavailable' },
        500,
      );
    }
    return { userId: 'dev-bypass', email: null };
  }

  let token: string | undefined = request.cookies.get('sb-access-token')?.value;
  if (!token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return authFailure({ code: 'AUTH_TOKEN_MISSING', error: 'Authentication token required' });
  }

  try {
    const client = createClient(url, key);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      return authFailure({ code: 'AUTH_TOKEN_INVALID', error: 'Invalid or expired session' });
    }
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    return authFailure({ code: 'AUTH_CHECK_FAILED', error: 'Authentication check failed' });
  }
}
