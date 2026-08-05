import { NextResponse, type NextRequest } from 'next/server';

import { getAdminContext } from '@/lib/admin-context';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin } from '@/lib/supabase';

export async function requireSuperAdminRequest(request: NextRequest): Promise<NextResponse | null> {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const context = getAdminContext(request);
  if (!context.userId) {
    return NextResponse.json({ error: '최고 관리자 로그인 정보가 필요합니다.' }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('role')
    .eq('user_id', context.userId)
    .limit(1);
  if (error) return NextResponse.json({ error: '관리자 권한을 확인하지 못했습니다.' }, { status: 500 });
  if (data?.[0]?.role !== 'super_admin') {
    return NextResponse.json({ error: '월 마감 재개방은 최고 관리자만 할 수 있습니다.' }, { status: 403 });
  }
  return null;
}
