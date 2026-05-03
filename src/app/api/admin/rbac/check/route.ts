import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { hasPermission, getMenuForRole, type AdminRole } from '@/lib/admin-rbac';

/**
 * POST /api/admin/rbac/check
 *
 * Body: { path: '/admin/...' }
 *
 * 현재 사용자의 role을 조회한 뒤, 해당 path에 대한 접근 가능 여부를 반환한다.
 *
 * Response:
 * {
 *   role: 'cs_agent',
 *   allowed: true,
 *   menu: ['/admin/bookings', ...],
 * }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ role: 'cs_agent', allowed: false, menu: [] });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const path: string = typeof body?.path === 'string' ? body.path : '';

    // ── 1. 현재 사용자 ID 추출 ─────────────────────────────────
    const token =
      request.cookies.get('sb-access-token')?.value ??
      request.headers.get('Authorization')?.replace('Bearer ', '');

    let userId: string | null = null;
    if (token) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json(
        { error: '인증되지 않은 요청입니다.' },
        { status: 401 },
      );
    }

    // ── 2. admin_users에서 role 조회 ───────────────────────────
    let role: AdminRole = 'cs_agent';

    const { data: adminRow, error: adminError } = await supabaseAdmin
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .limit(1);

    if (adminError) throw adminError;

    const rawRole = adminRow?.[0]?.role as string | undefined;
    if (
      rawRole &&
      ['super_admin', 'cs_agent', 'marketer', 'finance'].includes(rawRole)
    ) {
      role = rawRole as AdminRole;
    }

    // ── 3. 접근 가능 여부 판단 ─────────────────────────────────
    const allowed = path ? hasPermission(role, path) : false;
    const menu = getMenuForRole(role);

    return NextResponse.json({ role, allowed, menu });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
