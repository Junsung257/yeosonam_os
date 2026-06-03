/**
 * POST /api/admin/rbac/check
 *
 * Body: { path: '/admin/...' }
 *
 * 현재 사용자의 role을 조회한 뒤, 해당 path에 대한 접근 가능 여부를 반환한다.
 */

import { type NextRequest, type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { hasPermission, getMenuForRole, type AdminRole } from '@/lib/admin-rbac';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

const ADMIN_ROLES: AdminRole[] = ['super_admin', 'cs_agent', 'marketer', 'finance'];

const postHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ role: 'cs_agent', allowed: false, menu: [] });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const path = typeof body?.path === 'string' ? body.path : '';
    const token =
      request.cookies.get('sb-access-token')?.value ??
      request.headers.get('Authorization')?.replace('Bearer ', '');

    let userId: string | null = null;
    if (token) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    if (!userId) {
      return apiResponse(
        { error: '인증되지 않은 요청입니다' },
        { status: 401 },
      );
    }

    const { data: adminRow, error: adminError } = await supabaseAdmin
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .limit(1);

    if (adminError) throw adminError;

    const rawRole = adminRow?.[0]?.role as string | undefined;
    const role: AdminRole = rawRole && ADMIN_ROLES.includes(rawRole as AdminRole)
      ? rawRole as AdminRole
      : 'cs_agent';
    const allowed = path ? hasPermission(role, path) : false;
    const menu = getMenuForRole(role);

    return apiResponse({ role, allowed, menu });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, '처리 실패') },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
